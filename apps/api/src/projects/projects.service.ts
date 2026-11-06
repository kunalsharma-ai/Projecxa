import { EntitlementsService } from '../super-admin/entitlements';
import { BadRequestException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { WebhooksService } from '../webhooks/webhooks.service';
import { COUNTRY_RESTORABLE, ProjectHistoryService, RESTORABLE, SettingsSnapshot } from './project-history';
import { applyTemplateExtras, TemplateExtras, templateRedirects } from './project-templates';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { config } from '../common/config';
import { randomToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { defaultParamMappings, prebuiltRules, RedirectConfig } from '../redirects/redirect.types';
import { parseConfig } from '../redirects/redirects.service';
import { emptyFieldMetrics, fieldMetrics, SPEEDER_DETAIL } from './field-metrics';
import { autopilotOf } from '../monitor/monitor.rules';
import { assertPayout, launchProblems, marketKey, marketLabel, sameMarket } from './markets';
import {
  addCountrySchema,
  allocationSchema,
  bulkCountriesSchema,
  bulkStatusSchema,
  cloneCountrySchema,
  cloneProjectSchema,
  CountrySettings,
  CreateProjectInput,
  listQuerySchema,
  SECURITY_KEYS,
  updateAllocationSchema,
  updateCountrySchema,
  updateProjectSchema,
} from './projects.schemas';

const REQUIRED_COUNTRY_FIELDS = ['language', 'loiMinutes', 'irPercent', 'cpi', 'targetCompletes'] as const;

/** Merge the master project's shared settings with one country's overrides. */
export function mergeCountrySettings(defaults: CountrySettings, override: CountrySettings): CountrySettings {
  const out: CountrySettings = { ...defaults };
  for (const [k, v] of Object.entries(override)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhooksService,
    private readonly history: ProjectHistoryService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async create(u: AuthUser, input: CreateProjectInput) {
    await this.entitlements.assertProjectRoom(u.organizationId);
    const client = await this.prisma.client.findFirst({ where: { id: input.clientId, organizationId: u.organizationId } });
    if (!client) throw new BadRequestException('Client not found');
    if (input.clientContactId) {
      const c = await this.prisma.clientContact.findFirst({ where: { id: input.clientContactId, clientId: client.id } });
      if (!c) throw new BadRequestException('Client contact does not belong to this client');
    }
    for (const id of [input.salesPersonId, input.projectManagerId].filter(Boolean) as string[]) {
      const usr = await this.prisma.user.findFirst({ where: { id, organizationId: u.organizationId } });
      if (!usr) throw new BadRequestException('Unknown user');
    }

    // Resolve every country from shared defaults + overrides, and report all gaps at once.
    // The same country may be added more than once, for different target groups.
    const errors: string[] = [];
    const countries: (CountrySettings & { countryCode: string })[] = [];
    for (const c of input.countries) {
      const merged: CountrySettings & { countryCode: string } = { countryCode: c.countryCode, ...mergeCountrySettings(input.defaults, c) };
      if (input.currency) merged.currency = input.currency;
      const missing = REQUIRED_COUNTRY_FIELDS.filter((f) => merged[f] === undefined);
      if (missing.length) errors.push(`${c.countryCode}: missing ${missing.join(', ')}`);
      else if (countries.some((x) => sameMarket(x as never, merged as never)))
        errors.push(`${marketLabel(merged as never)} is listed twice. To add the same country again, give it a different target group.`);
      countries.push(merged);
    }
    if (errors.length) throw new BadRequestException({ message: 'Country configuration is incomplete', issues: errors });

    // Vendors chosen on the form go into every market; payouts above the client CPI need a confirmation.
    const vendorRows = input.vendors.length
      ? await this.prisma.vendor.findMany({ where: { organizationId: u.organizationId, id: { in: input.vendors.map((v) => v.vendorId) } }, select: { id: true, name: true } })
      : [];
    for (const v of input.vendors) {
      const vendor = vendorRows.find((x) => x.id === v.vendorId);
      if (!vendor) throw new BadRequestException('Vendor not found');
      for (const c of countries) assertPayout(v.cpi, c.cpi!, c.currency ?? 'USD', c as never, vendor.name, v.allowAboveCpi);
    }
    if (new Set(input.vendors.map((v) => v.vendorId)).size !== input.vendors.length) throw new BadRequestException('A vendor is listed twice');

    const template = input.templateId ? await this.prisma.projectTemplate.findFirst({ where: { id: input.templateId, organizationId: u.organizationId } }) : null;
    if (input.templateId && !template) throw new BadRequestException('Template not found');
    const extras = template?.extras as unknown as TemplateExtras | undefined;
    if (input.draftId && !(await this.prisma.projectDraft.count({ where: { id: input.draftId, organizationId: u.organizationId, ownerId: u.id } }))) throw new BadRequestException('Draft not found');
    let skipped: string[] = [];

    const project = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.update({
        where: { id: u.organizationId },
        data: { projectSeq: { increment: 1 }, ...(input.generateWorkOrder && !input.workOrderNo ? { workOrderSeq: { increment: 1 } } : {}) },
      });
      const projectCode = `${org.projectCodePrefix}${org.projectSeq}`;
      const workOrderNo = input.workOrderNo ?? (input.generateWorkOrder ? `${org.workOrderPrefix}${org.workOrderSeq}` : null);

      const p = await tx.project.create({
        data: {
          organizationId: u.organizationId,
          projectCode,
          workOrderNo,
          bidReference: input.bidReference,
          name: input.name,
          type: input.type,
          category: input.category,
          description: input.description,
          clientId: client.id,
          clientContactId: input.clientContactId,
          salesPersonId: input.salesPersonId,
          projectManagerId: input.projectManagerId ?? u.id,
          devices: input.devices,
          security: normalizeSecurity(input.security),
          redirectMode: input.redirectMode,
          ...(input.speederCheck ? { speederCheck: input.speederCheck } : {}),
          fieldStartAt: input.fieldStartAt ? new Date(`${input.fieldStartAt}T00:00:00Z`) : undefined,
          fieldEndAt: input.fieldEndAt ? new Date(`${input.fieldEndAt}T00:00:00Z`) : undefined,
          ...(input.gateQuestions?.length ? { gateQuestions: input.gateQuestions as Prisma.InputJsonValue } : {}),
          ...(extras
            ? {
                captchaStyle: extras.captchaStyle,
                ...(input.gateQuestions?.length ? {} : { gateQuestions: (extras.gateQuestions ?? undefined) as Prisma.InputJsonValue | undefined }),
                prescreen: (extras.prescreen ?? undefined) as Prisma.InputJsonValue | undefined,
                pageDesign: (extras.pageDesign ?? undefined) as Prisma.InputJsonValue | undefined,
                autopilot: (extras.autopilot ?? undefined) as Prisma.InputJsonValue | undefined,
              }
            : {}),
          countries: {
            create: countries.map((c) => ({
              countryCode: c.countryCode,
              language: c.language!,
              targetGroup: c.targetGroup,
              loiMinutes: c.loiMinutes!,
              irPercent: c.irPercent!,
              cpi: new Prisma.Decimal(c.cpi!),
              currency: c.currency ?? 'USD',
              targetCompletes: c.targetCompletes!,
              liveSurveyUrl: c.liveSurveyUrl,
              testSurveyUrl: c.testSurveyUrl,
              sessionTtlMinutes: c.sessionTtlMinutes,
            })),
          },
        },
      });

      // Version 1 of the redirect policy is active from the start: default UID / Vendor ID /
      // Country Code mappings, and any rules supplied at creation (validated by the redirect service on edit).
      let fromTemplate: RedirectConfig | undefined;
      if (template && extras) {
        const applied = await applyTemplateExtras(tx, u.organizationId, p.id, extras);
        skipped = applied.skipped;
        fromTemplate = templateRedirects(extras, applied.activeVendors);
        await tx.projectTemplate.update({ where: { id: template.id }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() } });
      }
      if (input.vendors.length) {
        const created = await tx.projectCountry.findMany({ where: { projectId: p.id }, select: { id: true, targetCompletes: true, allocations: { select: { vendorId: true } } } });
        for (const c of created)
          for (const v of input.vendors) {
            if (c.allocations.some((a) => a.vendorId === v.vendorId)) continue; // already there from the template
            await tx.vendorAllocation.create({
              data: { projectCountryId: c.id, vendorId: v.vendorId, cpi: new Prisma.Decimal(v.cpi), targetCompletes: c.targetCompletes, uidParam: v.uidParam, entryCode: randomToken(12), testEntryCode: randomToken(12) },
            });
          }
      }
      if (input.draftId) await tx.projectDraft.deleteMany({ where: { id: input.draftId, ownerId: u.id } });
      // Statuses the client template or organization default do not set start prebuilt for the mode:
      // they go to each vendor's own saved redirect ({vendor_redirect}). Inherited statuses keep inheriting.
      const inherited = new Set([...parseConfig(client.redirectTemplate).rules, ...parseConfig(org.defaultRedirectConfig).rules].filter((r) => !r.scope?.vendorId && !r.scope?.countryCode).map((r) => r.status));
      const initial: RedirectConfig = input.redirectConfig ?? fromTemplate ?? { rules: prebuiltRules(input.redirectMode).filter((r) => !inherited.has(r.status)), params: defaultParamMappings() };
      if (!input.redirectConfig?.params?.length) initial.params = defaultParamMappings();
      const v1 = await tx.redirectPolicyVersion.create({
        data: {
          projectId: p.id,
          version: 1,
          state: 'ACTIVE',
          mode: input.redirectMode,
          config: initial as unknown as Prisma.InputJsonValue,
          changeReason: 'Initial configuration',
          createdById: u.id,
          approvedById: u.id,
          activatedAt: new Date(),
        },
      });
      await tx.project.update({ where: { id: p.id }, data: { activeRedirectVersionId: v1.id } });
      if (input.wonBidId) {
        // A won bid becomes a project once: only a bid still waiting for setup can be claimed.
        const claimed = await tx.wonBid.updateMany({
          where: { id: input.wonBidId, organizationId: u.organizationId, status: 'NEW' },
          data: { status: 'PROJECT_CREATED', projectId: p.id },
        });
        if (!claimed.count) throw new ConflictException('This won bid already has a project or was dismissed');
        await this.audit.record(
          { organizationId: u.organizationId, actorId: u.id, action: 'won-bid.project-created', entityType: 'WonBid', entityId: input.wonBidId, detail: { projectId: p.id, projectCode } },
          tx,
        );
      }
      await this.audit.record(
        { organizationId: u.organizationId, actorId: u.id, action: 'project.create', entityType: 'Project', entityId: p.id, detail: { projectCode, countries: countries.map((c) => c.countryCode), ...(template ? { templateId: template.id, template: template.name, skipped } : {}) } },
        tx,
      );
      return p;
    });
    await this.history.record(u, project.id, null, template ? `Created from template “${template.name}”` : 'Created');
    return { ...(await this.get(u, project.id)), templateSkipped: skipped };
  }

  async list(u: AuthUser, q: z.infer<typeof listQuerySchema>) {
    const where: Prisma.ProjectWhereInput = {
      organizationId: u.organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { projectCode: { contains: q.q, mode: 'insensitive' } },
              { workOrderNo: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    // Text columns sort the way people read them (case-insensitive, numbers in order), which the
    // database's byte-order collation does not do: order the matching ids here, then load one page.
    let pageIds: string[] | null = null;
    if (q.sort === 'name' || q.sort === 'client' || q.sort === 'manager') {
      const keys = await this.prisma.project.findMany({ where, select: { id: true, createdAt: true, name: true, client: { select: { name: true } }, projectManager: { select: { name: true } } } });
      const text = (k: (typeof keys)[number]) => (q.sort === 'name' ? k.name : q.sort === 'client' ? k.client.name : k.projectManager.name);
      const f = q.dir === 'desc' ? -1 : 1;
      keys.sort((x, y) => f * text(x).localeCompare(text(y), 'en', { sensitivity: 'base', numeric: true }) || y.createdAt.getTime() - x.createdAt.getTime() || y.id.localeCompare(x.id));
      pageIds = keys.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((k) => k.id);
    }
    const [total, found] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where: pageIds ? { id: { in: pageIds }, organizationId: u.organizationId } : where,
        orderBy: projectOrder(q.sort, q.dir),
        ...(pageIds ? {} : { skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        include: {
          client: { select: { id: true, name: true } },
          projectManager: { select: { id: true, name: true } },
          salesPerson: { select: { id: true, name: true } },
          countries: { orderBy: [{ countryCode: 'asc' }, { createdAt: 'asc' }], select: { countryCode: true, targetCompletes: true, completes: true, loiMinutes: true, irPercent: true, status: true, allocations: { select: { status: true } } } },
        },
      }),
    ]);
    const rows = pageIds ? pageIds.map((id) => found.find((r) => r.id === id)!).filter(Boolean) : found;
    const [stats, metrics] = await Promise.all([this.sessionStats(rows.map((r) => r.id)), fieldMetrics(this.prisma, rows.map((r) => r.id))]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => {
        const s = stats.get(r.id) ?? emptyStats();
        const fm = metrics.get(r.id) ?? emptyFieldMetrics();
        const target = r.countries.reduce((a, c) => a + c.targetCompletes, 0);
        const live = r.countries.filter((c) => c.status === 'LIVE').length;
        return {
          id: r.id,
          projectCode: r.projectCode,
          workOrderNo: r.workOrderNo,
          name: r.name,
          status: r.status,
          category: r.category,
          type: r.type,
          client: r.client,
          projectManager: r.projectManager,
          salesPerson: r.salesPerson,
          countries: r.countries.map((c) => c.countryCode),
          liveCountries: live,
          /** Entry links that accept respondents now (active vendor link in a live market) out of all links. */
          links: {
            live: r.countries.reduce((a, c) => a + (c.status === 'LIVE' ? c.allocations.filter((x) => x.status === 'ACTIVE').length : 0), 0),
            total: r.countries.reduce((a, c) => a + c.allocations.length, 0),
          },
          targetCompletes: target,
          completes: s.COMPLETE,
          terminates: s.TERMINATE,
          overquotas: s.QUOTA_FULL,
          dropouts: s.PARTIAL,
          inProgress: s.STARTED,
          qualityFails: s.QUALITY_FAIL + s.DUPLICATE + s.SECURITY_REJECT,
          speeders: s.SPEEDER,
          /** Planned (bid) LOI and IR, averaged over the markets. */
          loiMinutes: avg(r.countries.map((c) => c.loiMinutes)),
          irPercent: avg(r.countries.map((c) => c.irPercent)),
          /** Actual, from live sessions (docs/FIELD_METRICS.md). */
          avgLoiMinutes: fm.avgLoiMinutes,
          avgIrPercent: fm.irPercent,
          redirectMode: r.redirectMode,
          fieldStartAt: r.fieldStartAt,
          fieldEndAt: r.fieldEndAt,
          createdAt: r.createdAt,
        };
      }),
    };
  }

  /** Live (non-test) session counts per project and status. */
  async sessionStats(projectIds: string[]) {
    const out = new Map<string, ReturnType<typeof emptyStats>>();
    if (!projectIds.length) return out;
    const grouped = await this.prisma.respondentSession.groupBy({
      by: ['projectId', 'status', 'statusDetail'],
      where: { projectId: { in: projectIds }, isTest: false },
      _count: { _all: true },
    });
    for (const g of grouped) {
      const s = out.get(g.projectId) ?? emptyStats();
      addStat(s, g);
      out.set(g.projectId, s);
    }
    return out;
  }

  async get(u: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({
      where: { id, organizationId: u.organizationId },
      include: {
        client: { select: { id: true, name: true, code: true } },
        clientContact: true,
        projectManager: { select: { id: true, name: true } },
        salesPerson: { select: { id: true, name: true } },
        activeRedirectVersion: { select: { id: true, version: true, mode: true, activatedAt: true } },
        countries: {
          orderBy: [{ countryCode: 'asc' }, { createdAt: 'asc' }],
          include: {
            quotas: true,
            allocations: { include: { vendor: { select: { id: true, name: true, code: true } } }, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Project not found');
    const stats = (await this.sessionStats([p.id])).get(p.id) ?? emptyStats();
    const byCountryVendor = await this.prisma.respondentSession.groupBy({
      by: ['vendorAllocationId', 'status', 'statusDetail'],
      where: { projectId: p.id, isTest: false },
      _count: { _all: true },
    });
    const allocStats = new Map<string, ReturnType<typeof emptyStats>>();
    for (const g of byCountryVendor) {
      const s = allocStats.get(g.vendorAllocationId) ?? emptyStats();
      addStat(s, g);
      allocStats.set(g.vendorAllocationId, s);
    }
    const [projectMetrics, marketMetrics] = await Promise.all([fieldMetrics(this.prisma, [p.id]), fieldMetrics(this.prisma, [p.id], 'country')]);
    const base = config.publicBaseUrl;
    const signed = !!(p.security as Record<string, boolean> | null)?.urlProtection;
    const money = await this.prisma.respondentSession.groupBy({
      by: ['projectCountryId'],
      where: { projectId: p.id, isTest: false, status: 'COMPLETE' },
      _sum: { revenue: true, payout: true },
    });
    return {
      ...p,
      stats,
      /** Actual LOI, IR and speeders from live sessions; planned values stay on each market. */
      metrics: projectMetrics.get(p.id) ?? emptyFieldMetrics(),
      finance: projectFinance(p.countries, money.map((m) => ({ countryId: m.projectCountryId, revenue: Number(m._sum.revenue ?? 0), cost: Number(m._sum.payout ?? 0) }))),
      countries: p.countries.map((c) => ({
        ...c,
        metrics: marketMetrics.get(c.id) ?? emptyFieldMetrics(),
        allocations: c.allocations.map((a) => ({
          ...a,
          // With URL protection on, vendors append sig = hex HMAC-SHA256(their signing secret, UID).
          entryLink: `${base}/s/${a.entryCode}?${encodeURIComponent(a.uidParam)}=[UID]${signed ? '&sig=[SIG]' : ''}`,
          testEntryLink: `${base}/s/${a.testEntryCode}?${encodeURIComponent(a.uidParam)}=[UID]${signed ? '&sig=[SIG]' : ''}`,
          stats: allocStats.get(a.id) ?? emptyStats(),
        })),
      })),
      outcomeEndpoints: outcomeEndpoints(),
    };
  }

  async update(u: AuthUser, id: string, body: z.infer<typeof updateProjectSchema>) {
    const p = await this.mustOwn(u, id);
    const data: Prisma.ProjectUncheckedUpdateInput = { ...body } as Prisma.ProjectUncheckedUpdateInput;
    if (body.security) data.security = normalizeSecurity(body.security);
    for (const k of ['gateQuestions', 'prescreen'] as const) {
      const v = body[k];
      if (v !== undefined) data[k] = v === null || v.length === 0 ? Prisma.DbNull : (v as Prisma.InputJsonValue);
    }
    if (body.fieldStartAt !== undefined) data.fieldStartAt = body.fieldStartAt ? new Date(`${body.fieldStartAt}T00:00:00.000Z`) : null;
    if (body.fieldEndAt !== undefined) data.fieldEndAt = body.fieldEndAt ? new Date(`${body.fieldEndAt}T23:59:59.999Z`) : null;
    // Switching the auto-pause checkpoint on again starts it afresh for every market and link.
    if (body.autopilot?.autoPause?.enabled && !autopilotOf(p.autopilot).autoPause.enabled) data.autopilotState = Prisma.DbNull;
    const launch = body.status === 'LIVE' ? await this.launchPlan(p.id) : null;
    const before = await this.history.snapshot(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data });
      // Going live opens every ready market that is still in draft or test; markets on hold stay on hold.
      if (launch?.open.length) await tx.projectCountry.updateMany({ where: { id: { in: launch.open } }, data: { status: 'LIVE' } });
    });
    await this.history.record(u, id, before);
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'project.update', entityType: 'Project', entityId: id, detail: body });
    if (body.status && body.status !== p.status) {
      await this.webhooks.emit(u.organizationId, 'project.status_changed', { project: { id, projectCode: p.projectCode, name: body.name ?? p.name }, from: p.status, to: body.status, changedBy: { name: u.name, email: u.email } });
    }
    const out = await this.get(u, id);
    return launch ? { ...out, launch: { opened: launch.open.length, notReady: launch.notReady } } : out;
  }

  /**
   * Going live needs at least one market with a live survey link and a vendor. Markets that are
   * not ready do not block the others: they stay in draft and are listed, so the person can fix them.
   */
  private async launchPlan(projectId: string) {
    const countries = await this.prisma.projectCountry.findMany({ where: { projectId }, include: { _count: { select: { allocations: true } } } });
    const candidates = countries.filter((c) => c.status !== 'CLOSED');
    const notReady = candidates
      .map((c) => ({ id: c.id, market: marketLabel(c), problems: launchProblems({ ...c, vendorCount: c._count.allocations }) }))
      .filter((c) => c.problems.length);
    const ready = candidates.filter((c) => !notReady.some((n) => n.id === c.id));
    if (!ready.length)
      throw new BadRequestException({
        message: 'Project is not ready to go live: no market has both a live survey link and a vendor',
        code: 'NOT_READY',
        issues: notReady.map((n) => `${n.market}: ${n.problems.join(' and ')}`),
      });
    return { open: ready.filter((c) => c.status === 'DRAFT' || c.status === 'TEST').map((c) => c.id), notReady };
  }

  /** Moves many projects to one status. Each is checked on its own; the result lists what happened to each. */
  async bulkStatus(u: AuthUser, body: z.infer<typeof bulkStatusSchema>) {
    const results: { id: string; projectCode?: string; ok: boolean; error?: string; issues?: string[]; notReady?: { market: string; problems: string[] }[] }[] = [];
    for (const id of [...new Set(body.ids)]) {
      try {
        const r = (await this.update(u, id, { status: body.status })) as { projectCode: string; launch?: { notReady: { market: string; problems: string[] }[] } };
        results.push({ id, projectCode: r.projectCode, ok: true, notReady: r.launch?.notReady ?? [] });
      } catch (e) {
        const resp = (e as { getResponse?: () => unknown }).getResponse?.() as { message?: string; issues?: string[] } | string | undefined;
        results.push({ id, ok: false, error: typeof resp === 'object' && resp ? resp.message : (e as Error).message, issues: typeof resp === 'object' && resp ? resp.issues : undefined });
      }
    }
    return { results, changed: results.filter((r) => r.ok).length };
  }

  /** The other markets of the project, for duplicate checks. */
  private async assertNewMarket(projectId: string, m: { countryCode: string; language: string; targetGroup?: string | null }, exceptId?: string) {
    const others = await this.prisma.projectCountry.findMany({ where: { projectId, countryCode: m.countryCode, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { countryCode: true, language: true, targetGroup: true } });
    if (others.some((o) => sameMarket(o, m)))
      throw new BadRequestException(`${marketLabel(m)} is already a market of this project. To add the same country again, give it a different target group.`);
  }

  /**
   * Adds a market to a project after it was created. Settings left out come from another market
   * (copyFromCountryId, or the first one), and the project keeps one CPI currency.
   */
  async addCountry(u: AuthUser, projectId: string, body: z.infer<typeof addCountrySchema>) {
    await this.mustOwn(u, projectId);
    const existing = await this.prisma.projectCountry.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' }, include: { allocations: true } });
    const src = body.copyFromCountryId ? existing.find((c) => c.id === body.copyFromCountryId) : existing[0];
    if (body.copyFromCountryId && !src) throw new NotFoundException('Market to copy from not found');
    const merged = {
      language: body.language ?? (src?.countryCode === body.countryCode ? src.language : undefined),
      targetGroup: body.targetGroup,
      loiMinutes: body.loiMinutes ?? src?.loiMinutes,
      irPercent: body.irPercent ?? src?.irPercent,
      cpi: body.cpi ?? (src ? Number(src.cpi) : undefined),
      currency: src?.currency ?? body.currency ?? 'USD',
      targetCompletes: body.targetCompletes ?? src?.targetCompletes,
    };
    const missing = REQUIRED_COUNTRY_FIELDS.filter((f) => merged[f] === undefined);
    if (missing.length) throw new BadRequestException(`Missing ${missing.join(', ')}`);
    await this.assertNewMarket(projectId, { countryCode: body.countryCode, language: merged.language!, targetGroup: body.targetGroup });
    const before = await this.history.snapshot(projectId);
    const c = await this.prisma.projectCountry.create({
      data: {
        projectId,
        countryCode: body.countryCode,
        language: merged.language!,
        targetGroup: body.targetGroup || null,
        loiMinutes: merged.loiMinutes!,
        irPercent: merged.irPercent!,
        cpi: new Prisma.Decimal(merged.cpi!),
        currency: merged.currency,
        targetCompletes: merged.targetCompletes!,
        liveSurveyUrl: body.liveSurveyUrl,
        testSurveyUrl: body.testSurveyUrl,
        sessionTtlMinutes: body.sessionTtlMinutes ?? src?.sessionTtlMinutes,
        allocations:
          body.copyVendors && src?.allocations.length
            ? {
                create: src.allocations.map((a) => ({
                  vendorId: a.vendorId,
                  cpi: a.cpi,
                  targetCompletes: merged.targetCompletes!,
                  uidParam: a.uidParam,
                  callbackUrlTemplate: a.callbackUrlTemplate,
                  entryCode: randomToken(12),
                  testEntryCode: randomToken(12),
                })),
              }
            : undefined,
      },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'country.add', entityType: 'Project', entityId: projectId, detail: { countryCode: c.countryCode, targetGroup: c.targetGroup } });
    await this.history.record(u, projectId, before);
    return c;
  }

  async cloneCountry(u: AuthUser, projectId: string, body: z.infer<typeof cloneCountrySchema>) {
    await this.mustOwn(u, projectId);
    const src = await this.prisma.projectCountry.findFirst({ where: { id: body.fromCountryId, projectId }, include: { allocations: true, quotas: true } });
    if (!src) throw new NotFoundException('Source country not found');
    const targetGroup = body.targetGroup !== undefined ? body.targetGroup || null : src.targetGroup;
    const language = body.language ?? src.language;
    await this.assertNewMarket(projectId, { countryCode: body.countryCode, language, targetGroup });
    const before = await this.history.snapshot(projectId);
    const created = await this.prisma.projectCountry.create({
      data: {
        projectId,
        countryCode: body.countryCode,
        language,
        targetGroup,
        loiMinutes: src.loiMinutes,
        irPercent: src.irPercent,
        cpi: src.cpi,
        currency: src.currency,
        targetCompletes: src.targetCompletes,
        // Survey links are market-specific; they are not copied.
        sessionTtlMinutes: src.sessionTtlMinutes,
        quotas: { create: src.quotas.map((q) => ({ group: q.group, name: q.name, target: q.target, isOpen: q.isOpen, sortOrder: q.sortOrder, conditions: q.conditions ?? [], criteria: q.criteria ?? undefined })) },
        allocations: body.includeVendors
          ? {
              create: src.allocations.map((a) => ({
                vendorId: a.vendorId,
                cpi: a.cpi,
                targetCompletes: a.targetCompletes,
                uidParam: a.uidParam,
                callbackUrlTemplate: a.callbackUrlTemplate,
                entryCode: randomToken(12),
                testEntryCode: randomToken(12),
              })),
            }
          : undefined,
      },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'country.clone', entityType: 'Project', entityId: projectId, detail: { from: src.countryCode, to: created.countryCode } });
    await this.history.record(u, projectId, before);
    return created;
  }

  async updateCountry(u: AuthUser, projectId: string, countryId: string, body: z.infer<typeof updateCountrySchema>) {
    const current = await this.mustOwnCountry(u, projectId, countryId);
    if (body.language !== undefined || body.targetGroup !== undefined)
      await this.assertNewMarket(projectId, { countryCode: current.countryCode, language: body.language ?? current.language, targetGroup: body.targetGroup ?? current.targetGroup }, countryId);
    if (body.status === 'LIVE' && current.status !== 'LIVE') {
      const vendorCount = await this.prisma.vendorAllocation.count({ where: { projectCountryId: countryId } });
      const problems = launchProblems({ ...current, liveSurveyUrl: body.liveSurveyUrl ?? current.liveSurveyUrl, vendorCount });
      if (problems.length)
        throw new BadRequestException({ message: `${marketLabel(current)} cannot go live: ${problems.join(' and ')}`, code: 'NOT_READY', issues: problems.map((x) => (x === 'no live survey link' ? 'Add the client live survey link first.' : 'Add at least one vendor on the Vendors & links tab.')) });
    }
    const { cpi, ...rest } = body;
    if (rest.targetGroup !== undefined) rest.targetGroup = rest.targetGroup.trim() || (null as never);
    const before = await this.history.snapshot(projectId);
    const c = await this.prisma.projectCountry.update({
      where: { id: countryId },
      data: { ...rest, ...(cpi !== undefined ? { cpi: new Prisma.Decimal(cpi) } : {}) },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'country.update', entityType: 'ProjectCountry', entityId: countryId, detail: body });
    await this.history.record(u, projectId, before);
    return c;
  }

  /**
   * "Apply to all": sets the same values on many markets of a project. Markets that cannot take a
   * change (for example going live without a survey link) are listed and left as they were.
   */
  async bulkCountries(u: AuthUser, projectId: string, body: z.infer<typeof bulkCountriesSchema>) {
    await this.mustOwn(u, projectId);
    const set = Object.fromEntries(Object.entries(body.set).filter(([, v]) => v !== undefined)) as z.infer<typeof updateCountrySchema>;
    if (!Object.keys(set).length) throw new BadRequestException('Choose at least one value to apply');
    const updated: string[] = [];
    const failed: string[] = [];
    for (const id of [...new Set(body.countryIds)]) {
      try {
        const c = await this.updateCountry(u, projectId, id, set);
        updated.push(c.id);
      } catch (e) {
        const resp = (e as { getResponse?: () => unknown }).getResponse?.() as { message?: string } | undefined;
        const c = await this.prisma.projectCountry.findFirst({ where: { id, projectId } });
        failed.push(`${c ? marketLabel(c) : id}: ${resp?.message ?? (e as Error).message}`);
      }
    }
    return { updated: updated.length, failed };
  }

  /**
   * Copies a project as a new draft: settings, markets, gate and prescreen questions, page design,
   * autopilot and the active redirect rules; optionally vendors (new entry links), quotas and survey links.
   * Nothing about respondents, completes or money is copied.
   */
  async cloneProject(u: AuthUser, id: string, body: z.infer<typeof cloneProjectSchema>) {
    await this.entitlements.assertProjectRoom(u.organizationId);
    const src = await this.prisma.project.findFirst({
      where: { id, organizationId: u.organizationId },
      include: { activeRedirectVersion: true, countries: { orderBy: [{ countryCode: 'asc' }, { createdAt: 'asc' }], include: { quotas: true, allocations: { include: { vendor: { select: { status: true } } } } } } },
    });
    if (!src) throw new NotFoundException('Project not found');
    const json = (v: Prisma.JsonValue | null) => (v === null ? undefined : (v as Prisma.InputJsonValue));
    const copy = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.update({ where: { id: u.organizationId }, data: { projectSeq: { increment: 1 } } });
      const projectCode = `${org.projectCodePrefix}${org.projectSeq}`;
      const p = await tx.project.create({
        data: {
          organizationId: u.organizationId,
          projectCode,
          name: body.name ?? `${src.name} (copy)`.slice(0, 300),
          type: src.type,
          category: src.category,
          description: src.description,
          clientId: src.clientId,
          clientContactId: src.clientContactId,
          salesPersonId: src.salesPersonId,
          projectManagerId: u.id,
          devices: src.devices as Prisma.InputJsonValue,
          security: src.security as Prisma.InputJsonValue,
          gateQuestions: json(src.gateQuestions),
          prescreen: json(src.prescreen),
          captchaStyle: src.captchaStyle,
          pageDesign: json(src.pageDesign),
          autopilot: json(src.autopilot),
          speederCheck: json(src.speederCheck),
          redirectMode: src.redirectMode,
        },
      });
      for (const c of src.countries) {
        await tx.projectCountry.create({
          data: {
            projectId: p.id,
            countryCode: c.countryCode,
            language: c.language,
            targetGroup: c.targetGroup,
            loiMinutes: c.loiMinutes,
            irPercent: c.irPercent,
            cpi: c.cpi,
            currency: c.currency,
            targetCompletes: c.targetCompletes,
            liveSurveyUrl: body.includeSurveyLinks ? c.liveSurveyUrl : null,
            testSurveyUrl: body.includeSurveyLinks ? c.testSurveyUrl : null,
            sessionTtlMinutes: c.sessionTtlMinutes,
            quotas: body.includeQuotas ? { create: c.quotas.map((q) => ({ group: q.group, name: q.name, target: q.target, isOpen: q.isOpen, sortOrder: q.sortOrder, conditions: q.conditions ?? [], criteria: q.criteria ?? undefined })) } : undefined,
            allocations: body.includeVendors
              ? {
                  create: c.allocations
                    .filter((a) => a.vendor.status === 'ACTIVE')
                    .map((a) => ({ vendorId: a.vendorId, cpi: a.cpi, targetCompletes: a.targetCompletes, uidParam: a.uidParam, callbackUrlTemplate: a.callbackUrlTemplate, uniqueLinksOnly: a.uniqueLinksOnly, entryCode: randomToken(12), testEntryCode: randomToken(12) })),
                }
              : undefined,
          },
        });
      }
      // Redirect rules scoped to a vendor only make sense when the vendors came along.
      const cfg = (src.activeRedirectVersion?.config as unknown as RedirectConfig | undefined) ?? { rules: [], params: defaultParamMappings() };
      const config: RedirectConfig = { ...cfg, rules: (cfg.rules ?? []).filter((r) => body.includeVendors || !r.scope?.vendorId) };
      const v1 = await tx.redirectPolicyVersion.create({
        data: { projectId: p.id, version: 1, state: 'ACTIVE', mode: src.redirectMode, config: config as unknown as Prisma.InputJsonValue, changeReason: `Copied from ${src.projectCode}`, createdById: u.id, approvedById: u.id, activatedAt: new Date() },
      });
      await tx.project.update({ where: { id: p.id }, data: { activeRedirectVersionId: v1.id } });
      await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'project.clone', entityType: 'Project', entityId: p.id, detail: { from: src.projectCode, projectCode, ...body } }, tx);
      return p;
    });
    await this.history.record(u, copy.id, null, `Copied from ${src.projectCode}`);
    return this.get(u, copy.id);
  }

  async addAllocation(u: AuthUser, projectId: string, countryId: string, input: Omit<z.infer<typeof allocationSchema>, 'allowAboveCpi'> & { allowAboveCpi?: boolean }) {
    const { allowAboveCpi, ...body } = input;
    const country = await this.mustOwnCountry(u, projectId, countryId);
    const vendor = await this.prisma.vendor.findFirst({ where: { id: body.vendorId, organizationId: u.organizationId } });
    if (!vendor) throw new BadRequestException('Vendor not found');
    assertPayout(body.cpi, Number(country.cpi), country.currency, country, vendor.name, allowAboveCpi);
    const exists = await this.prisma.vendorAllocation.findFirst({ where: { projectCountryId: countryId, vendorId: vendor.id } });
    if (exists) throw new BadRequestException(`${vendor.name} is already allocated to this country`);
    const a = await this.prisma.vendorAllocation.create({
      data: {
        projectCountryId: countryId,
        vendorId: vendor.id,
        cpi: new Prisma.Decimal(body.cpi),
        targetCompletes: body.targetCompletes,
        uidParam: body.uidParam,
        callbackUrlTemplate: body.callbackUrlTemplate,
        entryCode: randomToken(12),
        testEntryCode: randomToken(12),
      },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'allocation.add', entityType: 'ProjectCountry', entityId: countryId, detail: { vendorId: vendor.id } });
    return a;
  }

  async updateAllocation(u: AuthUser, projectId: string, countryId: string, allocationId: string, body: z.infer<typeof updateAllocationSchema>) {
    await this.mustOwnCountry(u, projectId, countryId);
    const country = await this.prisma.projectCountry.findUniqueOrThrow({ where: { id: countryId } });
    const found = await this.prisma.vendorAllocation.findFirst({ where: { id: allocationId, projectCountryId: countryId }, include: { vendor: { select: { name: true } } } });
    if (!found) throw new NotFoundException('Allocation not found');
    const { cpi, allowAboveCpi, ...rest } = body;
    if (cpi !== undefined) assertPayout(cpi, Number(country.cpi), country.currency, country, found.vendor.name, allowAboveCpi);
    const a = await this.prisma.vendorAllocation.update({
      where: { id: allocationId },
      data: { ...rest, ...(cpi !== undefined ? { cpi: new Prisma.Decimal(cpi) } : {}) },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'allocation.update', entityType: 'VendorAllocation', entityId: allocationId, detail: body });
    return a;
  }

  async sessions(u: AuthUser, projectId: string, opts: { includeTest: boolean; take: number }) {
    await this.mustOwn(u, projectId);
    return this.prisma.respondentSession.findMany({
      where: { projectId, ...(opts.includeTest ? {} : { isTest: false }) },
      orderBy: { startedAt: 'desc' },
      take: opts.take,
      select: {
        id: true,
        vendorRespondentId: true,
        status: true,
        statusDetail: true,
        outcomeVerified: true,
        approval: true,
        isTest: true,
        revenue: true,
        payout: true,
        startedAt: true,
        outcomeAt: true,
        projectCountry: { select: { countryCode: true } },
        vendorAllocation: { select: { vendor: { select: { name: true, code: true } } } },
        redirectVersion: { select: { version: true } },
      },
    });
  }

  async settingsHistory(u: AuthUser, projectId: string) {
    await this.mustOwn(u, projectId);
    const rows = await this.prisma.projectSettingsVersion.findMany({ where: { projectId }, orderBy: { version: 'desc' }, take: 200, include: { actor: { select: { name: true } } } });
    return rows.map((r) => ({ id: r.id, version: r.version, createdAt: r.createdAt, actor: r.actor?.name ?? null, reason: r.reason, changes: r.changes }));
  }

  /**
   * Puts the project and its markets back to the settings of an earlier version. Status, markets
   * added since, vendors, quotas and redirects are left as they are. The restore is itself a version.
   */
  async restoreVersion(u: AuthUser, projectId: string, version: number, reason?: string) {
    const p = await this.mustOwn(u, projectId);
    const v = await this.prisma.projectSettingsVersion.findUnique({ where: { projectId_version: { projectId, version } } });
    if (!v) throw new NotFoundException('Version not found');
    const snap = v.snapshot as unknown as SettingsSnapshot;
    const data: Prisma.ProjectUncheckedUpdateInput = {};
    for (const k of RESTORABLE) {
      const val = snap[k];
      // Versions saved before the speeder check existed leave the current setting alone.
      if (k === 'speederCheck' && val === undefined) continue;
      if (k === 'fieldStartAt') data.fieldStartAt = val ? new Date(`${val}T00:00:00.000Z`) : null;
      else if (k === 'fieldEndAt') data.fieldEndAt = val ? new Date(`${val}T23:59:59.999Z`) : null;
      else if (k === 'gateQuestions' || k === 'prescreen' || k === 'pageDesign' || k === 'autopilot' || k === 'speederCheck') data[k] = val == null ? Prisma.DbNull : (val as Prisma.InputJsonValue);
      else (data as Record<string, unknown>)[k] = val;
    }
    // People and contacts may have left since; keep the current ones then.
    const pm = await this.prisma.user.findFirst({ where: { id: snap.projectManagerId, organizationId: u.organizationId, active: true } });
    if (!pm) data.projectManagerId = p.projectManagerId;
    if (snap.salesPersonId && !(await this.prisma.user.count({ where: { id: snap.salesPersonId, organizationId: u.organizationId } }))) data.salesPersonId = p.salesPersonId;
    if (snap.clientContactId && !(await this.prisma.clientContact.count({ where: { id: snap.clientContactId, clientId: p.clientId } }))) data.clientContactId = p.clientContactId;
    const before = await this.history.snapshot(projectId);
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: projectId }, data });
      const countries = await tx.projectCountry.findMany({ where: { projectId } });
      for (const c of countries) {
        const s = snap.countries[marketKey(c)] ?? snap.countries[`${c.countryCode}/${c.language}`];
        if (!s) continue;
        const cd: Prisma.ProjectCountryUncheckedUpdateInput = {};
        for (const k of COUNTRY_RESTORABLE) (cd as Record<string, unknown>)[k] = k === 'cpi' ? new Prisma.Decimal(s.cpi) : s[k];
        await tx.projectCountry.update({ where: { id: c.id }, data: cd });
      }
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'project.restore-settings', entityType: 'Project', entityId: projectId, detail: { version, reason: reason ?? null } });
    const made = await this.history.record(u, projectId, before, `Restored version ${version}${reason ? `: ${reason}` : ''}`);
    return { ...(await this.get(u, projectId)), restoredVersion: made };
  }

  async auditTrail(u: AuthUser, projectId: string) {
    await this.mustOwn(u, projectId);
    return this.prisma.auditEvent.findMany({
      where: { organizationId: u.organizationId, entityId: projectId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async mustOwn(u: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  async mustOwnCountry(u: AuthUser, projectId: string, countryId: string) {
    await this.mustOwn(u, projectId);
    const c = await this.prisma.projectCountry.findFirst({ where: { id: countryId, projectId } });
    if (!c) throw new NotFoundException('Country not found');
    return c;
  }
}

/**
 * Money for the project page, per CPI currency: what the client pays per complete, what the
 * project is worth at target, and what has been earned and owed for completes so far.
 */
export function projectFinance(
  countries: { id: string; cpi: Prisma.Decimal; currency: string; targetCompletes: number; allocations: { cpi: Prisma.Decimal; targetCompletes: number }[] }[],
  actual: { countryId: string; revenue: number; cost: number }[],
) {
  const byCur = new Map<string, { currency: string; minCpi: number; maxCpi: number; plannedRevenue: number; plannedCost: number; revenue: number; cost: number; targetCompletes: number }>();
  for (const c of countries) {
    const f = byCur.get(c.currency) ?? { currency: c.currency, minCpi: Infinity, maxCpi: 0, plannedRevenue: 0, plannedCost: 0, revenue: 0, cost: 0, targetCompletes: 0 };
    const cpi = Number(c.cpi);
    f.minCpi = Math.min(f.minCpi, cpi);
    f.maxCpi = Math.max(f.maxCpi, cpi);
    f.plannedRevenue += cpi * c.targetCompletes;
    f.targetCompletes += c.targetCompletes;
    // Planned cost: vendors' payout for the completes the market needs, cheapest vendor first is unknowable,
    // so use the average payout of the market's vendors.
    if (c.allocations.length) f.plannedCost += (c.allocations.reduce((a, x) => a + Number(x.cpi), 0) / c.allocations.length) * c.targetCompletes;
    const a = actual.find((x) => x.countryId === c.id);
    if (a) {
      f.revenue += a.revenue;
      f.cost += a.cost;
    }
    byCur.set(c.currency, f);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [...byCur.values()].map((f) => ({
    currency: f.currency,
    minCpi: f.minCpi === Infinity ? 0 : f.minCpi,
    maxCpi: f.maxCpi,
    avgCpi: f.targetCompletes ? r2(f.plannedRevenue / f.targetCompletes) : 0,
    plannedRevenue: r2(f.plannedRevenue),
    plannedCost: r2(f.plannedCost),
    revenue: r2(f.revenue),
    cost: r2(f.cost),
    margin: r2(f.revenue - f.cost),
  }));
}

function normalizeSecurity(s: Record<string, boolean | undefined>) {
  return Object.fromEntries(SECURITY_KEYS.map((k) => [k, !!s[k]]));
}

export function emptyStats() {
  return {
    STARTED: 0,
    COMPLETE: 0,
    TERMINATE: 0,
    QUOTA_FULL: 0,
    QUALITY_FAIL: 0,
    DUPLICATE: 0,
    SECURITY_REJECT: 0,
    PARTIAL: 0,
    TECHNICAL_ERROR: 0,
    /** Quality fails from the speeder check; counted here and left out of QUALITY_FAIL. */
    SPEEDER: 0,
  };
}

function addStat(s: ReturnType<typeof emptyStats>, g: { status: keyof ReturnType<typeof emptyStats>; statusDetail: string | null; _count: { _all: number } }) {
  if (g.status === 'QUALITY_FAIL' && g.statusDetail === SPEEDER_DETAIL) s.SPEEDER += g._count._all;
  else s[g.status] += g._count._all;
}

function avg(xs: number[]) {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

export function outcomeEndpoints() {
  const base = config.publicBaseUrl;
  return {
    browser: `${base}/r/{status}?token={session_token}`,
    s2s: `${base}/api/v1/s2s/outcome`,
    statuses: ['complete', 'terminate', 'quota_full', 'quality_fail', 'duplicate', 'security_reject', 'partial', 'technical_error'],
  };
}

/** Sort order for the project list; ties fall back to newest first so paging stays stable. */
export function projectOrder(sort: z.infer<typeof listQuerySchema>['sort'], dir?: 'asc' | 'desc'): Prisma.ProjectOrderByWithRelationInput[] {
  const d = dir ?? (sort === 'created' ? 'desc' : 'asc');
  const orders: Record<typeof sort, Prisma.ProjectOrderByWithRelationInput> = {
    created: { createdAt: d },
    name: { name: d },
    code: { projectCode: d },
    status: { status: d },
    client: { client: { name: d } },
    manager: { projectManager: { name: d } },
    fieldEnd: { fieldEndAt: { sort: d, nulls: 'last' } },
  };
  const first = orders[sort];
  return sort === 'created' ? [first, { id: d }] : [first, { createdAt: 'desc' }, { id: 'desc' }];
}
