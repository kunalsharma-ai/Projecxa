import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { config as appConfig } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';
import { askApiDestination, redirectSigningSecret } from './redirect-api';
import { diffConfigs } from './redirect-diff';
import { computeRedirect, EngineResult, finishApiRedirect } from './redirect-engine';
import { validateConfig } from './redirect-resolver';
import { OUTCOME_STATUSES, OutcomeStatus, RedirectConfig, redirectConfigSchema, RedirectModeT } from './redirect.types';

export function parseConfig(raw: unknown): RedirectConfig {
  const r = redirectConfigSchema.safeParse(raw ?? {});
  return r.success ? r.data : { rules: [], params: [] };
}

@Injectable()
export class RedirectsService {
  private readonly log = new Logger(RedirectsService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async load(u: AuthUser, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: u.organizationId },
      include: {
        organization: true,
        client: true,
        countries: { include: { allocations: { include: { vendor: true } } } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private domainsFor(project: Awaited<ReturnType<RedirectsService['load']>>) {
    const vendors = new Map(project.countries.flatMap((c) => c.allocations.map((a) => [a.vendorId, a.vendor] as const)));
    return (vendorId?: string) => {
      const org = project.organization.redirectAllowedDomains;
      if (!vendorId) return org;
      // A vendor-scoped rule may use that vendor's own domains.
      return [...org, ...(vendors.get(vendorId)?.redirectAllowedDomains ?? [])];
    };
  }

  validate(project: Awaited<ReturnType<RedirectsService['load']>>, mode: RedirectModeT, config: RedirectConfig) {
    const issues = validateConfig(config, mode, {
      allowedDomainsFor: this.domainsFor(project),
      allowHttp: appConfig.allowHttpRedirects,
      selfHost: appConfig.publicHost,
    });
    const knownVendors = new Set(project.countries.flatMap((c) => c.allocations.map((a) => a.vendorId)));
    const knownCountries = new Set(project.countries.map((c) => c.countryCode));
    for (const r of config.rules) {
      if (r.scope?.vendorId && !knownVendors.has(r.scope.vendorId)) {
        issues.push({ level: 'warning', status: r.status, scope: r.scope, message: 'Vendor is not allocated to this project yet' });
      }
      if (r.scope?.countryCode && !knownCountries.has(r.scope.countryCode)) {
        issues.push({ level: 'warning', status: r.status, scope: r.scope, message: `${r.scope.countryCode} is not a country in this project` });
      }
    }
    return issues;
  }

  async getPolicy(u: AuthUser, projectId: string) {
    const project = await this.load(u, projectId);
    const versions = await this.prisma.redirectPolicyVersion.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    const active = versions.find((v) => v.id === project.activeRedirectVersionId) ?? null;
    const activeConfig = active ? parseConfig(active.config) : null;
    return {
      projectId,
      mode: project.redirectMode,
      active: active ? { ...active, config: activeConfig, issues: this.validate(project, active.mode, activeConfig!) } : null,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        state: v.state,
        mode: v.mode,
        changeReason: v.changeReason,
        createdById: v.createdById,
        approvedById: v.approvedById,
        createdAt: v.createdAt,
        activatedAt: v.activatedAt,
        scheduledAt: v.scheduledAt,
        scheduledById: v.scheduledById,
        scheduleError: v.scheduleError,
        previousVersionId: v.previousVersionId,
        config: parseConfig(v.config),
      })),
      inherited: {
        clientTemplate: project.client.redirectTemplate ? parseConfig(project.client.redirectTemplate) : null,
        organizationDefault: project.organization.defaultRedirectConfig ? parseConfig(project.organization.defaultRedirectConfig) : null,
      },
      allowedDomains: {
        organization: project.organization.redirectAllowedDomains,
        vendors: Object.fromEntries(
          project.countries.flatMap((c) => c.allocations.map((a) => [a.vendorId, { name: a.vendor.name, code: a.vendor.code, domains: a.vendor.redirectAllowedDomains }])),
        ),
      },
      countries: project.countries.map((c) => c.countryCode),
      vendors: [...new Map(project.countries.flatMap((c) => c.allocations.map((a) => [a.vendorId, { id: a.vendorId, name: a.vendor.name, code: a.vendor.code }]))).values()],
    };
  }

  async saveDraft(u: AuthUser, projectId: string, body: { mode: RedirectModeT; config: RedirectConfig; changeReason?: string }) {
    const project = await this.load(u, projectId);
    const issues = this.validate(project, body.mode, body.config);
    const created = await this.prisma.$transaction(async (tx) => {
      const last = await tx.redirectPolicyVersion.findFirst({ where: { projectId }, orderBy: { version: 'desc' } });
      return tx.redirectPolicyVersion.create({
        data: {
          projectId,
          version: (last?.version ?? 0) + 1,
          state: 'DRAFT',
          mode: body.mode,
          config: body.config as unknown as Prisma.InputJsonValue,
          changeReason: body.changeReason,
          createdById: u.id,
          previousVersionId: project.activeRedirectVersionId,
        },
      });
    });
    await this.audit.record({
      organizationId: u.organizationId,
      actorId: u.id,
      action: 'redirect.draft',
      entityType: 'Project',
      entityId: projectId,
      detail: { version: created.version, mode: body.mode, errors: issues.filter((i) => i.level === 'error').length },
    });
    return { version: created, issues };
  }

  /**
   * Activate a version (approval step). Blocks on validation errors.
   * Sessions already processed keep pointing at the version they used.
   */
  async activate(u: AuthUser, projectId: string, versionId: string) {
    const project = await this.load(u, projectId);
    const v = await this.prisma.redirectPolicyVersion.findFirst({ where: { id: versionId, projectId } });
    if (!v) throw new NotFoundException('Version not found');
    if (v.state === 'ACTIVE') return v;
    const errors = this.validate(project, v.mode, parseConfig(v.config)).filter((i) => i.level === 'error');
    if (errors.length) throw new BadRequestException({ message: 'Fix the redirect configuration before activating', issues: errors });
    const a = await this.makeActive(u, projectId, v.id, v.state, 'redirect.activate');
    if (!a) throw new BadRequestException('This version changed while you were activating it; reload and try again');
    return a;
  }

  /**
   * Moves a version to ACTIVE and archives the current one, in one transaction. The update is guarded
   * on the state the caller saw, so a manual activation and the scheduler never both win.
   */
  private async makeActive(actor: { id: string; organizationId: string }, projectId: string, versionId: string, fromState: 'DRAFT' | 'SCHEDULED' | 'ARCHIVED', action: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.redirectPolicyVersion.updateMany({
        where: { id: versionId, state: fromState },
        data: { state: 'ACTIVE', approvedById: actor.id, activatedAt: new Date(), scheduleError: null },
      });
      if (!claimed.count) return null;
      await tx.redirectPolicyVersion.updateMany({ where: { projectId, state: 'ACTIVE', id: { not: versionId } }, data: { state: 'ARCHIVED' } });
      const a = await tx.redirectPolicyVersion.findUniqueOrThrow({ where: { id: versionId } });
      await tx.project.update({ where: { id: projectId }, data: { activeRedirectVersionId: a.id, redirectMode: a.mode } });
      await this.audit.record(
        { organizationId: actor.organizationId, actorId: actor.id, action, entityType: 'Project', entityId: projectId, detail: { version: a.version, mode: a.mode, ...(fromState === 'SCHEDULED' ? { scheduledAt: a.scheduledAt } : {}) } },
        tx,
      );
      return a;
    });
  }

  /**
   * Approves a draft to go live at a set time. It is validated now and again when it goes live; if it
   * no longer passes then, it goes back to draft with the reason. One scheduled version per project.
   */
  async schedule(u: AuthUser, projectId: string, versionId: string, at: Date) {
    const project = await this.load(u, projectId);
    const v = await this.prisma.redirectPolicyVersion.findFirst({ where: { id: versionId, projectId } });
    if (!v) throw new NotFoundException('Version not found');
    if (v.state !== 'DRAFT') throw new BadRequestException('Only a draft can be scheduled');
    const now = Date.now();
    if (at.getTime() < now + 60_000) throw new BadRequestException('Pick a time at least a minute from now, or activate it now');
    if (at.getTime() > now + 90 * 86_400_000) throw new BadRequestException('Pick a time within the next 90 days');
    const errors = this.validate(project, v.mode, parseConfig(v.config)).filter((i) => i.level === 'error');
    if (errors.length) throw new BadRequestException({ message: 'Fix the redirect configuration before scheduling it', issues: errors });
    const other = await this.prisma.redirectPolicyVersion.findFirst({ where: { projectId, state: 'SCHEDULED' } });
    if (other) throw new BadRequestException(`Version ${other.version} is already scheduled; cancel it first`);
    const claimed = await this.prisma.redirectPolicyVersion.updateMany({
      where: { id: v.id, state: 'DRAFT' },
      data: { state: 'SCHEDULED', scheduledAt: at, scheduledById: u.id, scheduleError: null },
    });
    if (!claimed.count) throw new BadRequestException('This version changed; reload and try again');
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'redirect.schedule', entityType: 'Project', entityId: projectId, detail: { version: v.version, at: at.toISOString() } });
    return this.prisma.redirectPolicyVersion.findUniqueOrThrow({ where: { id: v.id } });
  }

  async cancelSchedule(u: AuthUser, projectId: string, versionId: string) {
    await this.load(u, projectId);
    const v = await this.prisma.redirectPolicyVersion.findFirst({ where: { id: versionId, projectId } });
    if (!v) throw new NotFoundException('Version not found');
    const done = await this.prisma.redirectPolicyVersion.updateMany({ where: { id: v.id, state: 'SCHEDULED' }, data: { state: 'DRAFT', scheduledAt: null, scheduledById: null } });
    if (!done.count) throw new BadRequestException('This version is not scheduled');
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'redirect.schedule-cancel', entityType: 'Project', entityId: projectId, detail: { version: v.version } });
    return this.prisma.redirectPolicyVersion.findUniqueOrThrow({ where: { id: v.id } });
  }

  @Interval(30_000)
  async tick() {
    if (!appConfig.redirectSchedulerEnabled || this.running) return;
    this.running = true;
    try {
      await this.runDue();
    } catch (e) {
      this.log.error(`Redirect scheduler failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Activates every scheduled version that is due. Returns what happened, for tests and logs. */
  async runDue(now = new Date()) {
    const due = await this.prisma.redirectPolicyVersion.findMany({
      where: { state: 'SCHEDULED', scheduledAt: { lte: now } },
      orderBy: { scheduledAt: 'asc' },
      take: 50,
      include: { project: { select: { organizationId: true } } },
    });
    const out: { versionId: string; ok: boolean; error?: string }[] = [];
    for (const v of due) {
      const actor = { id: v.scheduledById ?? v.createdById, organizationId: v.project.organizationId };
      try {
        const project = await this.load({ ...actor, role: 'ADMIN', email: '', name: '' }, v.projectId);
        const errors = this.validate(project, v.mode, parseConfig(v.config)).filter((i) => i.level === 'error');
        if (errors.length) {
          const reason = errors.map((e) => e.message).slice(0, 3).join('; ').slice(0, 500);
          const back = await this.prisma.redirectPolicyVersion.updateMany({ where: { id: v.id, state: 'SCHEDULED' }, data: { state: 'DRAFT', scheduleError: reason } });
          if (back.count) {
            await this.audit.record({ organizationId: actor.organizationId, actorId: actor.id, action: 'redirect.schedule-failed', entityType: 'Project', entityId: v.projectId, detail: { version: v.version, reason } });
          }
          out.push({ versionId: v.id, ok: false, error: reason });
          continue;
        }
        const a = await this.makeActive(actor, v.projectId, v.id, 'SCHEDULED', 'redirect.activate-scheduled');
        out.push({ versionId: v.id, ok: !!a, ...(a ? {} : { error: 'already handled' }) });
      } catch (e) {
        this.log.error(`Scheduled redirect version ${v.id} failed: ${(e as Error).message}`);
        out.push({ versionId: v.id, ok: false, error: (e as Error).message });
      }
    }
    return out;
  }

  /** What changed between two versions of a project's redirects. */
  async compare(u: AuthUser, projectId: string, fromId: string, toId: string) {
    await this.load(u, projectId);
    const [a, b] = await Promise.all([
      this.prisma.redirectPolicyVersion.findFirst({ where: { id: fromId, projectId } }),
      this.prisma.redirectPolicyVersion.findFirst({ where: { id: toId, projectId } }),
    ]);
    if (!a || !b) throw new NotFoundException('Version not found');
    return {
      from: { id: a.id, version: a.version, state: a.state, mode: a.mode },
      to: { id: b.id, version: b.version, state: b.state, mode: b.mode },
      diff: diffConfigs({ mode: a.mode, config: parseConfig(a.config) }, { mode: b.mode, config: parseConfig(b.config) }),
    };
  }

  /** Roll back by copying an earlier version into a new version and activating it, so history stays linear. */
  async rollback(u: AuthUser, projectId: string, toVersionId: string, reason?: string) {
    await this.load(u, projectId);
    const target = await this.prisma.redirectPolicyVersion.findFirst({ where: { id: toVersionId, projectId } });
    if (!target) throw new NotFoundException('Version not found');
    if (!target.approvedById) throw new BadRequestException('Only previously approved versions can be restored');
    const { version } = await this.saveDraft(u, projectId, {
      mode: target.mode,
      config: parseConfig(target.config),
      changeReason: reason ?? `Rollback to version ${target.version}`,
    });
    return this.activate(u, projectId, version.id);
  }

  /** Effective rule for every country × vendor × status in the active (or given) version, with its source. */
  async effectiveMatrix(u: AuthUser, projectId: string, versionId?: string) {
    const project = await this.load(u, projectId);
    const v = await this.prisma.redirectPolicyVersion.findFirst({
      where: { projectId, ...(versionId ? { id: versionId } : { id: project.activeRedirectVersionId ?? '__none__' }) },
    });
    if (!v) throw new NotFoundException('Version not found');
    const cfg = parseConfig(v.config);
    const rows = [];
    for (const c of project.countries) {
      for (const a of c.allocations) {
        for (const status of OUTCOME_STATUSES) {
          const r = this.computeFor(project, v.mode, cfg, status, c.countryCode, a.vendor, 'SAMPLE-UID', 'SAMPLE-TOKEN');
          rows.push({
            countryCode: c.countryCode,
            vendor: { id: a.vendorId, name: a.vendor.name, code: a.vendor.code },
            status,
            source: r.ruleSource ?? null,
            type: r.ruleType ?? null,
            destination: r.destination,
            usedFallback: r.usedFallback,
            blockedReason: r.blockedReason ?? null,
            callbackRequired: r.callbackRequired,
            apiEndpoint: r.api?.endpoint ?? null,
          });
        }
      }
    }
    return { version: v.version, mode: v.mode, rows };
  }

  /** QA studio: simulate an outcome without creating sessions, events or financial records. */
  async simulate(
    u: AuthUser,
    projectId: string,
    body: { status: OutcomeStatus; countryCode: string; vendorId: string; uid?: string; versionId?: string; mode?: RedirectModeT; config?: RedirectConfig },
  ) {
    const started = Date.now();
    const project = await this.load(u, projectId);
    const country = project.countries.find((c) => c.countryCode === body.countryCode);
    if (!country) throw new BadRequestException(`${body.countryCode} is not in this project`);
    const alloc = country.allocations.find((a) => a.vendorId === body.vendorId);
    if (!alloc) throw new BadRequestException('Vendor is not allocated to this country');

    let mode: RedirectModeT;
    let cfg: RedirectConfig;
    let versionLabel: string;
    if (body.config) {
      mode = body.mode ?? project.redirectMode;
      cfg = body.config;
      versionLabel = 'unsaved changes';
    } else {
      const v = await this.prisma.redirectPolicyVersion.findFirst({
        where: { projectId, id: body.versionId ?? project.activeRedirectVersionId ?? '__none__' },
      });
      if (!v) throw new NotFoundException('Version not found');
      mode = v.mode;
      cfg = parseConfig(v.config);
      versionLabel = `version ${v.version}`;
    }
    const uid = body.uid ?? `QA-${Math.random().toString(36).slice(2, 10)}`;
    let result: EngineResult = this.computeFor(project, mode, cfg, body.status, body.countryCode, alloc.vendor, uid, 'QA-SESSION-TOKEN');
    let api: { endpoint: string; ms: number; answered: string | null; error: string | null } | null = null;
    if (result.api) {
      // QA asks the real endpoint, marked as a test so it can answer without counting anything.
      const secret = await redirectSigningSecret(this.prisma, u.organizationId);
      const answer = await askApiDestination(result.api.endpoint, { ...result.api.payload, test: true }, secret, result.api.timeoutMs);
      api = { endpoint: result.api.endpoint, ms: answer.ms, answered: answer.url ?? null, error: answer.error ?? null };
      result = finishApiRedirect(result, answer, { publicBaseUrl: appConfig.publicBaseUrl, allowHttp: appConfig.allowHttpRedirects });
    }
    const callbackTemplate = alloc.callbackUrlTemplate ?? alloc.vendor.callbackUrlTemplate;
    return {
      input: { ...body, uid, version: versionLabel, mode },
      result: { ...result, api: undefined },
      api,
      callbackPreview:
        result.callbackRequired && callbackTemplate
          ? { url: fillCallbackTemplate(callbackTemplate, { uid, status: body.status, vendorCode: alloc.vendor.code, countryCode: body.countryCode, projectCode: project.projectCode }) }
          : null,
      billable: false,
      durationMs: Date.now() - started,
    };
  }

  computeFor(
    project: Awaited<ReturnType<RedirectsService['load']>>,
    mode: RedirectModeT,
    cfg: RedirectConfig,
    status: OutcomeStatus,
    countryCode: string,
    vendor: { id: string; code: string; redirectAllowedDomains: string[] },
    uid: string,
    token: string,
  ) {
    return computeRedirect({
      status,
      countryCode,
      vendor,
      projectCode: project.projectCode,
      vendorRespondentId: uid,
      sessionToken: token,
      mode,
      config: cfg,
      clientTemplate: project.client.redirectTemplate ? parseConfig(project.client.redirectTemplate) : null,
      organizationDefault: project.organization.defaultRedirectConfig ? parseConfig(project.organization.defaultRedirectConfig) : null,
      organizationDomains: project.organization.redirectAllowedDomains,
      organizationFallbackUrl: project.organization.fallbackRedirectUrl,
      publicBaseUrl: appConfig.publicBaseUrl,
      allowHttp: appConfig.allowHttpRedirects,
    });
  }
}

/** Callback URL templates support {uid}, {status}, {vendor_id}, {country_code}, {project_code}. */
export function fillCallbackTemplate(
  template: string,
  v: { uid: string; status: string; vendorCode: string; countryCode: string; projectCode: string },
) {
  const map: Record<string, string> = {
    uid: v.uid,
    respondent_uid: v.uid,
    status: v.status.toLowerCase(),
    vendor_id: v.vendorCode,
    country_code: v.countryCode,
    project_code: v.projectCode,
  };
  return template.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in map ? encodeURIComponent(map[k]) : m));
}
