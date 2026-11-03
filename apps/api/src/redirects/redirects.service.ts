import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { config as appConfig } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';
import { computeRedirect } from './redirect-engine';
import { validateConfig } from './redirect-resolver';
import { OUTCOME_STATUSES, OutcomeStatus, RedirectConfig, redirectConfigSchema, RedirectModeT } from './redirect.types';

export function parseConfig(raw: unknown): RedirectConfig {
  const r = redirectConfigSchema.safeParse(raw ?? {});
  return r.success ? r.data : { rules: [], params: [] };
}

@Injectable()
export class RedirectsService {
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
    const cfg = parseConfig(v.config);
    const errors = this.validate(project, v.mode, cfg).filter((i) => i.level === 'error');
    if (errors.length) throw new BadRequestException({ message: 'Fix the redirect configuration before activating', issues: errors });

    const activated = await this.prisma.$transaction(async (tx) => {
      await tx.redirectPolicyVersion.updateMany({ where: { projectId, state: 'ACTIVE' }, data: { state: 'ARCHIVED' } });
      const a = await tx.redirectPolicyVersion.update({
        where: { id: v.id },
        data: { state: 'ACTIVE', approvedById: u.id, activatedAt: new Date() },
      });
      await tx.project.update({ where: { id: projectId }, data: { activeRedirectVersionId: a.id, redirectMode: a.mode } });
      await this.audit.record(
        { organizationId: u.organizationId, actorId: u.id, action: 'redirect.activate', entityType: 'Project', entityId: projectId, detail: { version: a.version, mode: a.mode } },
        tx,
      );
      return a;
    });
    return activated;
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
    const result = this.computeFor(project, mode, cfg, body.status, body.countryCode, alloc.vendor, uid, 'QA-SESSION-TOKEN');
    const callbackTemplate = alloc.callbackUrlTemplate ?? alloc.vendor.callbackUrlTemplate;
    return {
      input: { ...body, uid, version: versionLabel, mode },
      result,
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
