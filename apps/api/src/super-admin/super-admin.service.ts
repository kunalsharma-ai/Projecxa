/**
 * Super Admin (docs/SUPER_ADMIN.md): the person who runs this SampTrek server registers
 * organisations, gives them a plan (a feature package they pay for in billing/, docs/SUBSCRIPTION_PAYMENTS.md), switches any feature
 * on or off for an organisation or one person, on the web and in the mobile app, sees what every
 * admin and user does, and controls every organisation's integrations.
 */
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrgStatus, Prisma, Role, SubscriptionStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import { randomToken } from '../common/crypto';
import { CATALOG } from '../integrations/catalog';
import { IntegrationsService } from '../integrations/integrations.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { cleanLimitsJson, LIMITS } from './limits';
import { EntitlementsService, ORG_FEATURES_INCLUDE, orgFeatures, readFeatureAccess, subscriptionLive, userFeatures } from './entitlements';
import { FEATURES, FEATURE_KEYS, featureDef, MOBILE_FEATURE_KEYS } from './features';
import { createManySkipDuplicates } from '../prisma/mongo-compat';
import { aggregate, mdate, numOut } from '../prisma/agg';

const STAFF: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER'];
const DAY = 86_400_000;
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface PlatformSettings { registrationOpen: boolean; defaultPlanCode: string | null; trialDays: number }
const DEFAULT_SETTINGS: PlatformSettings = { registrationOpen: false, defaultPlanCode: 'starter', trialDays: 14 };

const workspace = ['dashboard', 'tasks', 'requests', 'notifications', 'projects', 'projects.create', 'won_bids', 'reports', 'data_processing', 'analytics', 'clients', 'vendors', 'portal_access', 'team', 'settings', 'integrations', 'portal.client', 'portal.vendor', 'integration.smtp', 'collaboration', 'client_dashboards', 'languages'];
/** Made the first time plans are listed, so the Super Admin has something to start from. */
export const STARTER_PLANS = [
  { code: 'starter', name: 'Starter', description: 'Projects, links, reports and portals for a small team.', priceLabel: null, sortOrder: 1, maxUsers: 5, maxProjects: 50,
    limits: { clients: 25, vendors: 25, portalUsers: 20, clicksPerMonth: 20_000, completesPerMonth: 5_000, scheduledReports: 5, trafficAction: 'stop' },
    features: workspace, mobileFeatures: workspace.filter((k) => MOBILE_FEATURE_KEYS.includes(k)) },
  { code: 'professional', name: 'Professional', description: 'Adds monitoring, finance, AI and accounting.', priceLabel: null, sortOrder: 2, maxUsers: 25, maxProjects: null,
    limits: { clients: 250, vendors: 250, portalUsers: 250, clicksPerMonth: 250_000, completesPerMonth: 50_000, scheduledReports: 25, apiKeys: 5, trafficAction: 'stop' },
    features: [...workspace, 'copilot', 'chat', 'chat.general', 'chat.project_rooms', 'chat.groups', 'chat.direct', 'monitor', 'forecasting', 'vendor_routing', 'fraud_checks', 'redirect_health', 'invoices', 'payables', 'accounting', 'privacy', 'integration.sso_google', 'integration.sso_microsoft', 'integration.sso_zoho', 'integration.gemini', 'integration.zoho_books', 'integration.bidzo'],
    mobileFeatures: [...workspace, 'copilot', 'monitor', 'forecasting', 'redirect_health', 'invoices', 'payables'].filter((k) => MOBILE_FEATURE_KEYS.includes(k)) },
  { code: 'enterprise', name: 'Enterprise', description: 'Everything, including API, branding and all integrations.', priceLabel: null, sortOrder: 3, maxUsers: null, maxProjects: null, limits: {},
    features: FEATURE_KEYS, mobileFeatures: MOBILE_FEATURE_KEYS },
];

export interface OrgInput { name: string; slug?: string; adminName: string; adminEmail: string; planCode?: string | null; trialDays?: number | null; status?: 'ACTIVE' | 'PENDING'; registration?: Record<string, unknown> }
export interface SubscriptionInput {
  planCode: string; status: SubscriptionStatus; startsAt?: Date | null; endsAt?: Date | null; trialEndsAt?: Date | null;
  maxUsers?: number | null; maxProjects?: number | null; limits?: Record<string, unknown> | null; mobileEnabled?: boolean; notes?: string | null;
}

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';

/** Hooks the automation engine plugs into (set by AutomationService, so there is no import cycle). */
export type OrgEvent = 'org.registered' | 'org.created' | 'payment.received' | 'payment.submitted';
export type OrgEventHandler = (event: OrgEvent, orgId: string, vars?: Record<string, string>, key?: string) => Promise<void>;

@Injectable()
export class SuperAdminService {
  private readonly log = new Logger(SuperAdminService.name);
  onEvent: OrgEventHandler = async () => undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly integrations: IntegrationsService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
  ) {}

  // ───────────── Platform settings ─────────────

  async ownerId() {
    const id = await this.integrations.ownerId();
    if (!id) throw new NotFoundException('No organisation runs this server yet');
    return id;
  }

  async settings(): Promise<PlatformSettings> {
    const id = await this.integrations.ownerId();
    if (!id) return DEFAULT_SETTINGS;
    const o = await this.prisma.organization.findUnique({ where: { id }, select: { platformSettings: true } });
    return { ...DEFAULT_SETTINGS, ...((o?.platformSettings ?? {}) as Partial<PlatformSettings>) };
  }

  async saveSettings(u: AuthUser, body: Partial<PlatformSettings>) {
    if (body.defaultPlanCode) await this.plan(body.defaultPlanCode);
    const next = { ...(await this.settings()), ...body };
    await this.prisma.organization.update({ where: { id: await this.ownerId() }, data: { platformSettings: next as unknown as Prisma.InputJsonValue } });
    await this.record(u, await this.ownerId(), 'superadmin.settings', 'Platform', 'settings', body);
    return next;
  }

  private record(u: AuthUser | null, organizationId: string, action: string, entityType: string, entityId: string, detail?: unknown) {
    return this.audit.record({ organizationId, actorId: u?.id ?? null, action, entityType, entityId, detail: { ...(detail as object), bySuperAdmin: u ? u.name : 'automation' } });
  }

  // ───────────── Plans ─────────────

  async plans() {
    if ((await this.prisma.plan.count()) === 0) {
      await createManySkipDuplicates(this.prisma.plan, 'Plan', STARTER_PLANS);
    }
    const plans = await this.prisma.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { subscriptions: true } } } });
    return plans.map(({ _count, ...p }) => ({ ...p, organizations: _count.subscriptions }));
  }

  async plan(code: string) {
    const p = await this.prisma.plan.findUnique({ where: { code } });
    if (!p) throw new BadRequestException(`There is no plan "${code}"`);
    return p;
  }

  private cleanFeatures(features?: string[], mobile?: string[]) {
    const bad = [...(features ?? []), ...(mobile ?? [])].filter((k) => !featureDef(k));
    if (bad.length) throw new BadRequestException(`Unknown features: ${bad.join(', ')}`);
    return {
      ...(features ? { features: [...new Set(features)] } : {}),
      ...(mobile ? { mobileFeatures: [...new Set(mobile)].filter((k) => MOBILE_FEATURE_KEYS.includes(k)) } : {}),
    };
  }

  async createPlan(u: AuthUser, body: { code: string; name: string; description?: string | null; priceLabel?: string | null; features: string[]; mobileFeatures: string[]; mobileEnabled?: boolean; maxUsers?: number | null; maxProjects?: number | null; limits?: Record<string, unknown>; sortOrder?: number; priceMonthly?: number | null; priceYearly?: number | null; currency?: string }) {
    if (await this.prisma.plan.findUnique({ where: { code: body.code } })) throw new BadRequestException('A plan with that code already exists');
    const p = await this.prisma.plan.create({ data: { ...body, limits: cleanLimitsJson(body.limits, false), ...this.cleanFeatures(body.features, body.mobileFeatures) } });
    await this.record(u, await this.ownerId(), 'superadmin.plan_create', 'Plan', p.id, { code: p.code });
    return p;
  }

  async updatePlan(u: AuthUser, id: string, body: Partial<{ name: string; description: string | null; priceLabel: string | null; features: string[]; mobileFeatures: string[]; mobileEnabled: boolean; maxUsers: number | null; maxProjects: number | null; limits: Record<string, unknown>; active: boolean; sortOrder: number; priceMonthly: number | null; priceYearly: number | null; currency: string }>) {
    const before = await this.prisma.plan.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Plan not found');
    const { limits, ...rest } = body;
    const p = await this.prisma.plan.update({ where: { id }, data: { ...rest, ...(limits ? { limits: cleanLimitsJson(limits, false) } : {}), ...this.cleanFeatures(body.features, body.mobileFeatures) } });
    this.entitlements.resetTraffic();
    const added = (p.features ?? []).filter((k) => !before.features.includes(k));
    const removed = before.features.filter((k) => !p.features.includes(k));
    await this.record(u, await this.ownerId(), 'superadmin.plan_update', 'Plan', p.id, { code: p.code, added, removed });
    return p;
  }

  async deletePlan(u: AuthUser, id: string) {
    const p = await this.prisma.plan.findUnique({ where: { id }, include: { _count: { select: { subscriptions: true } } } });
    if (!p) throw new NotFoundException('Plan not found');
    if (p._count.subscriptions) throw new BadRequestException('Organisations use this plan. Move them to another plan, or turn the plan off instead.');
    await this.prisma.plan.delete({ where: { id } });
    await this.record(u, await this.ownerId(), 'superadmin.plan_delete', 'Plan', id, { code: p.code });
    return { ok: true };
  }

  // ───────────── Organisations ─────────────

  private async summary(orgIds?: string[]) {
    const where = orgIds ? { id: { in: orgIds } } : {};
    const orgs = await this.prisma.organization.findMany({
      where, orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, slug: true, status: true, platformOwner: true, createdAt: true, registration: true, customDomain: true, ...ORG_FEATURES_INCLUDE },
    });
    const ids = orgs.map((o) => o.id);
    const [users, projects, seen, integrations] = await Promise.all([
      this.prisma.user.groupBy({ by: ['organizationId'], where: { organizationId: { in: ids }, active: true, role: { in: STAFF } }, _count: true }),
      this.prisma.project.groupBy({ by: ['organizationId'], where: { organizationId: { in: ids } }, _count: true }),
      this.prisma.user.groupBy({ by: ['organizationId'], where: { organizationId: { in: ids } }, _max: { lastSeenAt: true, lastLoginAt: true } }),
      this.prisma.integrationSetting.groupBy({ by: ['organizationId'], where: { organizationId: { in: ids } }, _count: true }),
    ]);
    const count = <T extends { organizationId: string; _count: number }>(rows: T[], id: string) => rows.find((r) => r.organizationId === id)?._count ?? 0;
    return orgs.map((o) => {
      const f = orgFeatures(o);
      const s = seen.find((r) => r.organizationId === o.id)?._max;
      const last = [s?.lastSeenAt, s?.lastLoginAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
      return {
        id: o.id, name: o.name, slug: o.slug, status: o.status, platformOwner: o.platformOwner, createdAt: o.createdAt, customDomain: o.customDomain,
        registration: o.registration,
        block: f.block,
        subscription: o.subscription ? {
          plan: { id: o.subscription.plan.id, code: o.subscription.plan.code, name: o.subscription.plan.name },
          status: o.subscription.status, startsAt: o.subscription.startsAt, endsAt: o.subscription.endsAt, trialEndsAt: o.subscription.trialEndsAt,
          live: subscriptionLive(o.subscription), mobileEnabled: o.subscription.mobileEnabled,
        } : null,
        limits: { ...f.limits, maxUsers: f.limits.users, maxProjects: f.limits.projects },
        users: count(users, o.id), projects: count(projects, o.id), integrations: count(integrations, o.id),
        overrides: o.featureOverrides.length,
        lastActiveAt: last,
        features: { web: f.web.size, mobile: f.mobileEnabled ? f.mobile.size : 0, total: FEATURE_KEYS.length },
      };
    });
  }

  async organizations(q?: { q?: string; status?: OrgStatus }) {
    const ids = (await this.prisma.organization.findMany({
      where: { ...(q?.status ? { status: q.status } : {}), ...(q?.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q, mode: 'insensitive' } }, { users: { some: { email: { contains: q.q, mode: 'insensitive' } } } }] } : {}) },
      select: { id: true },
    })).map((o) => o.id);
    return this.summary(ids);
  }

  /** Before observing (docs/SUPER_ADMIN_OBSERVE.md): the organisation exists, and the start goes in its activity log. */
  async observeTarget(u: AuthUser, id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, slug: true, customDomain: true } });
    if (!org) throw new NotFoundException('Organisation not found');
    if (org.id === u.organizationId) throw new BadRequestException('This is your own organisation');
    await this.record(u, org.id, 'superadmin.observe', 'Organization', org.id, { superAdmin: u.email });
    return org;
  }

  /** Respondent traffic for one organisation over the last `days` days (live entries only). */
  async traffic(id: string, days: number) {
    const org = await this.prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, customDomain: true, customDomainVerifiedAt: true, uidPrefix: true, branding: true } });
    if (!org) throw new NotFoundException('Organisation not found');
    const since = new Date(Date.now() - days * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const rows = (
      await aggregate<{ _id: { day: string; status: string }; n: number }>(this.prisma.respondentSession, [
        { $match: { organizationId: id, isTest: false, startedAt: { $gte: mdate(since) } } },
        { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt' } }, status: '$status' }, n: { $sum: 1 } } },
        { $sort: { '_id.day': 1 } },
      ])
    ).map((r) => ({ day: new Date(`${r._id.day}T00:00:00Z`), status: r._id.status, n: numOut(r.n) }));
    const byDay = new Map<string, { day: string; clicks: number; completes: number; terminates: number; quotaFull: number; rejected: number }>();
    for (let t = since.getTime(); t <= Date.now(); t += 86_400_000) { const d = new Date(t).toISOString().slice(0, 10); byDay.set(d, { day: d, clicks: 0, completes: 0, terminates: 0, quotaFull: 0, rejected: 0 }); }
    const totals: Record<string, number> = {};
    for (const r of rows) {
      const d = r.day.toISOString().slice(0, 10);
      const n = Number(r.n);
      const b = byDay.get(d) ?? { day: d, clicks: 0, completes: 0, terminates: 0, quotaFull: 0, rejected: 0 };
      b.clicks += n;
      if (r.status === 'COMPLETE') b.completes += n;
      else if (r.status === 'TERMINATE') b.terminates += n;
      else if (r.status === 'QUOTA_FULL') b.quotaFull += n;
      else if (r.status === 'SECURITY_REJECT' || r.status === 'QUALITY_FAIL' || r.status === 'DUPLICATE') b.rejected += n;
      byDay.set(d, b);
      totals[r.status] = (totals[r.status] ?? 0) + n;
    }
    const perProject = await this.prisma.respondentSession.groupBy({ by: ['projectId', 'status'], where: { organizationId: id, isTest: false, startedAt: { gte: since } }, _count: true });
    const projMap = new Map<string, { clicks: number; completes: number }>();
    for (const r of perProject) { const m = projMap.get(r.projectId) ?? { clicks: 0, completes: 0 }; m.clicks += r._count; if (r.status === 'COMPLETE') m.completes += r._count; projMap.set(r.projectId, m); }
    const top = [...projMap.entries()].sort((a, b) => b[1].clicks - a[1].clicks).slice(0, 10);
    const projects = await this.prisma.project.findMany({ where: { id: { in: top.map(([pid]) => pid) } }, select: { id: true, name: true, workOrderNo: true, status: true } });
    const live = await this.prisma.project.count({ where: { organizationId: id, status: 'LIVE' } });
    const brand = (org.branding ?? {}) as { appName?: string };
    const clicks = Object.values(totals).reduce((a, b) => a + b, 0);
    return {
      days,
      liveProjects: live,
      totals: { clicks, completes: totals.COMPLETE ?? 0, inSurvey: totals.STARTED ?? 0, incidence: clicks ? Math.round(((totals.COMPLETE ?? 0) / clicks) * 1000) / 10 : null },
      byDay: [...byDay.values()],
      topProjects: top.map(([pid, m]) => ({ ...projects.find((p) => p.id === pid), id: pid, ...m })),
      // Links and redirects may run on the organisation's own domain and name; the Super Admin still sees it all here.
      runsAs: { appName: brand.appName ?? null, domain: org.customDomain, domainVerified: !!org.customDomainVerifiedAt, uidPrefix: org.uidPrefix },
    };
  }

  async organization(id: string) {
    const [s] = await this.summary([id]);
    if (!s) throw new NotFoundException('Organisation not found');
    const org = await this.entitlements.loadOrg(id);
    const sub = org.subscription;
    const f = orgFeatures(org);
    const planWeb = new Set(sub ? sub.plan.features : FEATURE_KEYS);
    const planMobile = new Set(sub ? sub.plan.mobileFeatures : MOBILE_FEATURE_KEYS);
    const ov = (k: string, c: string) => org.featureOverrides.find((o) => o.feature === k && o.channel === c);
    const access = readFeatureAccess(org.featureAccess);
    return {
      ...s,
      subscriptionDetail: sub ? { ...sub, plan: undefined } : null,
      usage: await this.entitlements.limitsReport(id),
      // Plan limit emails sent to this organisation (docs/PLAN_LIMITS.md), newest first.
      limitAlerts: await this.prisma.limitAlert.findMany({ where: { organizationId: id, sentTo: { not: null } }, orderBy: { createdAt: 'desc' }, take: 20, select: { limit: true, level: true, period: true, used: true, max: true, sentTo: true, createdAt: true } }),
      features: FEATURES.map((d) => ({
        key: d.key, label: d.label, group: d.group, summary: d.summary, mobile: d.mobile,
        // Who the organisation's Admin gives it to (Settings → Features & access); null = not the Admin's choice.
        adminAccess: access[d.key] ? { mode: access[d.key]!.mode, people: access[d.key]!.people.length } : null,
        web: { plan: planWeb.has(d.key), override: ov(d.key, 'web')?.enabled ?? null, effective: f.web.has(d.key) },
        app: d.mobile ? { plan: planMobile.has(d.key), override: ov(d.key, 'mobile')?.enabled ?? null, effective: f.mobileEnabled && f.mobile.has(d.key) } : null,
      })),
    };
  }

  private async uniqueSlug(base: string) {
    const root = slugify(base);
    for (let i = 0; i < 50; i++) {
      const slug = i ? `${root}-${i + 1}` : root;
      if (!(await this.prisma.organization.findUnique({ where: { slug }, select: { id: true } }))) return slug;
    }
    return `${root}-${randomToken(3).toLowerCase()}`;
  }

  /** Makes the organisation, its first admin (no password yet) and, when a plan is given, its subscription. */
  async createOrganization(u: AuthUser | null, input: OrgInput) {
    if (input.slug && (await this.prisma.organization.findUnique({ where: { slug: input.slug } }))) throw new BadRequestException('That short name is taken');
    const settings = await this.settings();
    const planCode = input.planCode === undefined ? settings.defaultPlanCode : input.planCode;
    const plan = planCode ? (await this.plans(), await this.plan(planCode)) : null;
    const trialDays = input.trialDays ?? 0;
    const status = input.status ?? 'ACTIVE';
    const slug = input.slug ?? (await this.uniqueSlug(input.name));
    const { org, admin } = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: input.name, slug, status, registration: (input.registration ?? undefined) as Prisma.InputJsonValue | undefined } });
      const admin = await tx.user.create({
        data: { organizationId: org.id, email: input.adminEmail, name: input.adminName, role: 'ADMIN', active: status === 'ACTIVE', passwordHash: await bcrypt.hash(randomToken(32), 10) },
        include: { organization: true },
      });
      if (plan) {
        await tx.subscription.create({
          data: { organizationId: org.id, planId: plan.id, status: trialDays > 0 ? 'TRIAL' : 'ACTIVE', trialEndsAt: trialDays > 0 ? new Date(Date.now() + trialDays * DAY) : null, updatedById: u?.id ?? null },
        });
      }
      return { org, admin };
    });
    await this.record(u, org.id, status === 'PENDING' ? 'org.registered' : 'superadmin.org_create', 'Organization', org.id, { name: org.name, plan: plan?.code ?? null, trialDays, adminEmail: input.adminEmail });
    let invite: { emailed: boolean; inviteUrl: string } | null = null;
    if (status === 'ACTIVE') invite = await this.inviteAdmin(admin.id, u);
    await this.onEvent(status === 'PENDING' ? 'org.registered' : 'org.created', org.id).catch((e) => this.log.error(`Automation failed: ${(e as Error).message}`));
    return { id: org.id, slug: org.slug, adminId: admin.id, invite };
  }

  /** Invitation link for the first admin; sent with the server's email settings. */
  private async inviteAdmin(userId: string, u: AuthUser | null) {
    const admin = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { organization: true } });
    const link = await this.passwords.issue(admin, 'invite', u?.id ?? null);
    let emailed = false;
    try {
      const org = esc(admin.organization.name);
      await this.mail.send({
        organizationId: await this.ownerId(),
        to: [admin.email],
        subject: `Your SampTrek workspace for ${admin.organization.name} is ready`,
        text: `Hello ${admin.name},\n\nYour SampTrek workspace for ${admin.organization.name} is ready. Choose a password to start (the link works for 72 hours):\n${link.url}\n`,
        html: `<p>Hello ${esc(admin.name)},</p><p>Your SampTrek workspace for <b>${org}</b> is ready. Choose a password to start (the link works for 72 hours).</p><p><a href="${esc(link.url)}">Choose a password</a></p>`,
      });
      emailed = true;
    } catch (e) {
      this.log.warn(`Could not email the invitation to ${admin.email}: ${(e as Error).message}`);
    }
    return { emailed, inviteUrl: link.url };
  }

  async approve(u: AuthUser | null, id: string, body: { planCode?: string | null; trialDays?: number | null }) {
    const org = await this.prisma.organization.findUnique({ where: { id }, include: { subscription: true, users: { where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, take: 1 } } });
    if (!org) throw new NotFoundException('Organisation not found');
    if (org.status !== 'PENDING') throw new BadRequestException('Only registrations waiting for approval can be approved');
    const settings = await this.settings();
    const planCode = body.planCode === undefined ? ((org.registration as { requestedPlan?: string } | null)?.requestedPlan ?? settings.defaultPlanCode) : body.planCode;
    const plan = planCode ? (await this.plans(), await this.plan(planCode)) : null;
    const trialDays = body.trialDays ?? settings.trialDays;
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id }, data: { status: 'ACTIVE' } });
      if (org.users[0]) await tx.user.update({ where: { id: org.users[0].id }, data: { active: true } });
      if (plan) {
        const data = { planId: plan.id, status: trialDays > 0 ? 'TRIAL' as const : 'ACTIVE' as const, trialEndsAt: trialDays > 0 ? new Date(Date.now() + trialDays * DAY) : null, startsAt: new Date(), updatedById: u?.id ?? null };
        await tx.subscription.upsert({ where: { organizationId: id }, create: { organizationId: id, ...data }, update: data });
      }
    });
    await this.record(u, id, 'superadmin.org_approve', 'Organization', id, { plan: plan?.code ?? null, trialDays });
    const invite = org.users[0] ? await this.inviteAdmin(org.users[0].id, u) : null;
    await this.onEvent('org.created', id).catch((e) => this.log.error(`Automation failed: ${(e as Error).message}`));
    return { ok: true, invite };
  }

  /** Turns a registration down: it is removed (it never had data). */
  async reject(u: AuthUser, id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organisation not found');
    if (org.status !== 'PENDING') throw new BadRequestException('Only registrations waiting for approval can be turned down. Suspend an organisation instead.');
    await this.prisma.organization.delete({ where: { id } });
    await this.record(u, await this.ownerId(), 'superadmin.org_reject', 'Organization', id, { name: org.name, registration: org.registration });
    return { ok: true };
  }

  async updateOrganization(u: AuthUser | null, id: string, body: { name?: string; status?: OrgStatus }) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organisation not found');
    if (org.platformOwner && body.status && body.status !== 'ACTIVE') throw new ForbiddenException('The organisation that runs this server cannot be suspended');
    if (body.status === 'PENDING') throw new BadRequestException('Use ACTIVE or SUSPENDED');
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id }, data: body });
      // Suspended: everyone is signed out at once.
      if (body.status === 'SUSPENDED' && org.status !== 'SUSPENDED') await tx.user.updateMany({ where: { organizationId: id }, data: { sessionsValidAfter: new Date() } });
    });
    const action = body.status === 'SUSPENDED' ? 'superadmin.org_suspend' : body.status === 'ACTIVE' && org.status !== 'ACTIVE' ? 'superadmin.org_activate' : 'superadmin.org_update';
    await this.record(u, id, action, 'Organization', id, { ...body, previous: { name: org.name, status: org.status } });
    return this.organization(id);
  }

  // ───────────── Subscriptions and switches ─────────────

  async setSubscription(u: AuthUser | null, orgId: string, body: SubscriptionInput) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, include: { subscription: { include: { plan: true } } } });
    if (!org) throw new NotFoundException('Organisation not found');
    if (org.platformOwner) throw new BadRequestException('The organisation that runs this server always has every feature');
    await this.plans();
    const plan = await this.plan(body.planCode);
    const data = {
      planId: plan.id, status: body.status, endsAt: body.endsAt ?? null, trialEndsAt: body.trialEndsAt ?? null,
      maxUsers: body.maxUsers ?? null, maxProjects: body.maxProjects ?? null, limits: body.limits ? cleanLimitsJson(body.limits, true) : null, mobileEnabled: body.mobileEnabled ?? true, notes: body.notes ?? null, updatedById: u?.id ?? null,
      ...(body.startsAt ? { startsAt: body.startsAt } : {}),
    };
    await this.prisma.subscription.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...data }, update: data });
    this.entitlements.resetTraffic(orgId);
    const prev = org.subscription;
    await this.record(u, orgId, 'superadmin.subscription', 'Subscription', orgId, {
      plan: plan.code, status: body.status, endsAt: body.endsAt ?? null, trialEndsAt: body.trialEndsAt ?? null, mobileEnabled: data.mobileEnabled,
      previous: prev ? { plan: prev.plan.code, status: prev.status, endsAt: prev.endsAt } : null,
    });
    return this.organization(orgId);
  }

  /** Back to "no subscription": every feature, no limits. */
  async removeSubscription(u: AuthUser, orgId: string) {
    await this.prisma.subscription.deleteMany({ where: { organizationId: orgId } });
    await this.record(u, orgId, 'superadmin.subscription_remove', 'Subscription', orgId);
    return this.organization(orgId);
  }

  /** state: 'plan' follows the plan, 'on' / 'off' overrides it for this organisation. */
  async setFeatures(u: AuthUser | null, orgId: string, changes: { feature: string; channel: 'web' | 'mobile'; state: 'plan' | 'on' | 'off' }[]) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organisation not found');
    if (org.platformOwner) throw new BadRequestException('The organisation that runs this server always has every feature');
    for (const c of changes) {
      const def = featureDef(c.feature);
      if (!def) throw new BadRequestException(`Unknown feature ${c.feature}`);
      if (c.channel === 'mobile' && !def.mobile) throw new BadRequestException(`${def.label} is not in the mobile app`);
    }
    await this.prisma.$transaction(async (tx) => {
      for (const c of changes) {
        const where = { organizationId_feature_channel: { organizationId: orgId, feature: c.feature, channel: c.channel } };
        if (c.state === 'plan') await tx.featureOverride.deleteMany({ where: { organizationId: orgId, feature: c.feature, channel: c.channel } });
        else await tx.featureOverride.upsert({ where, create: { organizationId: orgId, feature: c.feature, channel: c.channel, enabled: c.state === 'on', updatedById: u?.id ?? null }, update: { enabled: c.state === 'on', updatedById: u?.id ?? null } });
      }
    });
    await this.record(u, orgId, 'superadmin.features', 'Organization', orgId, { changes });
    return this.organization(orgId);
  }

  // ───────────── People ─────────────

  async users(orgId: string) {
    const org = await this.entitlements.loadOrg(orgId);
    const users = await this.prisma.user.findMany({
      where: { organizationId: orgId },
      orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, email: true, role: true, active: true, superAdmin: true, mobileAccess: true, featuresOff: true, mobileFeaturesOff: true, lastLoginAt: true, lastSeenAt: true, mfaEnabledAt: true, passwordSetAt: true, createdAt: true, client: { select: { name: true } }, vendor: { select: { name: true } } },
    });
    return users.map((x) => {
      const f = userFeatures(org, x);
      return {
        ...x, mfaEnabled: !!x.mfaEnabledAt, mfaEnabledAt: undefined, invited: !x.passwordSetAt, passwordSetAt: undefined,
        superAdmin: x.superAdmin && org.platformOwner,
        partner: x.client?.name ?? x.vendor?.name ?? null, client: undefined, vendor: undefined,
        webFeatures: Object.values(f.web).filter(Boolean).length, mobileFeatures: Object.values(f.mobile.features).filter(Boolean).length, mobileEnabled: f.mobile.enabled,
      };
    });
  }

  async updateUser(u: AuthUser, id: string, body: { active?: boolean; mobileAccess?: boolean; featuresOff?: string[]; mobileFeaturesOff?: string[]; superAdmin?: boolean }) {
    const x = await this.prisma.user.findUnique({ where: { id }, include: { organization: true } });
    if (!x) throw new NotFoundException('User not found');
    for (const k of [...(body.featuresOff ?? []), ...(body.mobileFeaturesOff ?? [])]) if (!featureDef(k)) throw new BadRequestException(`Unknown feature ${k}`);
    if (body.superAdmin !== undefined) {
      if (!x.organization.platformOwner || x.role !== 'ADMIN') throw new BadRequestException('Only admins of the organisation that runs this server can be Super Admins');
      if (x.id === u.id && body.superAdmin === false) throw new BadRequestException('You cannot remove your own Super Admin access');
    }
    if (x.id === u.id && body.active === false) throw new BadRequestException('You cannot deactivate yourself');
    if (body.active === true && !x.active && STAFF.includes(x.role)) await this.entitlements.assertSeat(x.organizationId);
    const data: Prisma.UserUpdateInput = { ...body };
    if (body.active === false && x.active) data.sessionsValidAfter = new Date();
    await this.prisma.user.update({ where: { id }, data });
    await this.record(u, x.organizationId, 'superadmin.user_update', 'User', id, { email: x.email, ...body });
    return { ok: true };
  }

  async signOutUser(u: AuthUser, id: string) {
    const x = await this.prisma.user.findUnique({ where: { id } });
    if (!x) throw new NotFoundException('User not found');
    await this.prisma.user.update({ where: { id }, data: { sessionsValidAfter: new Date() } });
    await this.record(u, x.organizationId, 'superadmin.user_sign_out', 'User', id, { email: x.email });
    return { ok: true };
  }

  // ───────────── Activity ─────────────

  async activity(q: { organizationId?: string; userId?: string; action?: string; before?: Date; limit?: number }) {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        ...(q.organizationId ? { organizationId: q.organizationId } : {}),
        ...(q.userId ? { actorId: q.userId } : {}),
        ...(q.action ? { action: { startsWith: q.action } } : {}),
        ...(q.before ? { createdAt: { lt: q.before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: { organization: { select: { id: true, name: true } } },
    });
    const page = rows.slice(0, limit);
    const actorIds = [...new Set(page.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true, role: true, organizationId: true, superAdmin: true } });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return {
      items: page.map((r) => ({
        id: r.id, at: r.createdAt, action: r.action, entityType: r.entityType, entityId: r.entityId, detail: r.detail,
        organization: r.organization,
        actor: r.actorId ? byId.get(r.actorId) ?? { id: r.actorId, name: 'Removed user', email: null, role: null } : null,
      })),
      next: rows.length > limit ? page[page.length - 1].createdAt : null,
    };
  }

  // ───────────── Integrations ─────────────

  async integrationsMatrix() {
    const orgs = await this.prisma.organization.findMany({ where: { status: { not: 'PENDING' } }, orderBy: { name: 'asc' }, select: { id: true, name: true, status: true, platformOwner: true, ...ORG_FEATURES_INCLUDE } });
    const rows = await this.prisma.integrationSetting.findMany({ select: { organizationId: true, kind: true, lastTestOk: true, lastTestAt: true, lastTestMessage: true, updatedAt: true } });
    return {
      kinds: CATALOG.map((d) => ({ kind: d.kind, label: d.label, group: d.group, scope: d.scope })),
      organizations: orgs.map((o) => {
        const f = orgFeatures(o);
        return {
          id: o.id, name: o.name, status: o.status, platformOwner: o.platformOwner,
          integrations: Object.fromEntries(CATALOG.map((d) => {
            const r = rows.find((x) => x.organizationId === o.id && x.kind === d.kind);
            return [d.kind, { allowed: f.web.has(`integration.${d.kind}`), saved: !!r, lastTestOk: r?.lastTestOk ?? null, lastTestAt: r?.lastTestAt ?? null, lastTestMessage: r?.lastTestMessage ?? null, updatedAt: r?.updatedAt ?? null }];
          })),
        };
      }),
    };
  }

  /** Removes an organisation's saved settings for one integration (secrets included). */
  async clearIntegration(u: AuthUser, orgId: string, kind: string) {
    const r = await this.prisma.integrationSetting.deleteMany({ where: { organizationId: orgId, kind } });
    if (!r.count) throw new NotFoundException('That organisation has not set up this integration');
    await this.record(u, orgId, 'superadmin.integration_clear', 'IntegrationSetting', kind, { kind });
    return { ok: true };
  }

  // ───────────── Overview ─────────────

  async overview() {
    const now = new Date();
    const soon = new Date(now.getTime() + 14 * DAY);
    const [orgs, pending, suspended, users, mobileUsers, seen7, expiring, plans, runs, recent] = await Promise.all([
      this.prisma.organization.count({ where: { status: 'ACTIVE' } }),
      this.prisma.organization.count({ where: { status: 'PENDING' } }),
      this.prisma.organization.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.user.count({ where: { active: true, role: { in: STAFF } } }),
      this.prisma.user.count({ where: { active: true, mobileAccess: true } }),
      this.prisma.user.count({ where: { lastSeenAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
      this.prisma.subscription.findMany({
        where: { OR: [{ status: { in: ['ACTIVE', 'PAST_DUE'] }, endsAt: { lte: soon } }, { status: 'TRIAL', trialEndsAt: { lte: soon } }] },
        include: { organization: { select: { id: true, name: true } }, plan: { select: { name: true } } }, orderBy: { endsAt: 'asc' }, take: 20,
      }),
      this.prisma.plan.findMany({ where: { active: true }, select: { id: true, name: true, code: true, _count: { select: { subscriptions: true } } }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.automationRun.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { rule: { select: { name: true } }, organization: { select: { name: true } } } }),
      this.activity({ limit: 10 }),
    ]);
    const subs = await this.prisma.subscription.groupBy({ by: ['status'], _count: true });
    return {
      counts: { organizations: orgs, pending, suspended, users, mobileUsers, activeLast7Days: seen7 },
      subscriptions: Object.fromEntries(subs.map((s) => [s.status, s._count])),
      expiring: expiring.map((s) => ({ organization: s.organization, plan: s.plan.name, status: s.status, endsAt: s.status === 'TRIAL' ? s.trialEndsAt : s.endsAt, live: subscriptionLive(s, now) })),
      plans: plans.map((p) => ({ id: p.id, name: p.name, code: p.code, organizations: p._count.subscriptions })),
      automationRuns: runs.map((r) => ({ id: r.id, at: r.createdAt, rule: r.rule.name, organization: r.organization?.name ?? null, status: r.status, detail: r.detail })),
      recentActivity: recent.items,
    };
  }

  catalog() {
    return { features: FEATURES, groups: [...new Set(FEATURES.map((f) => f.group))], limits: LIMITS };
  }
}
