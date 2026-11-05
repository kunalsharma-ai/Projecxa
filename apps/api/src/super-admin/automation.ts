/**
 * Super Admin automation (docs/SUPER_ADMIN.md): plain "When … / Only if … / Then …" rules over
 * organisations and subscriptions. Event rules run at once (a registration, a new organisation);
 * time rules are checked every hour. Each rule acts once per organisation and occasion (e.g. once per
 * subscription end date), and every run is logged.
 */
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AutomationRule, Prisma, SubscriptionStatus } from '@prisma/client';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { config } from '../common/config';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ORG_FEATURES_INCLUDE, orgFeatures } from './entitlements';
import { featureDef } from './features';
import { esc, SuperAdminService } from './super-admin.service';

const DAY = 86_400_000;
const STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED'] as const;

export const TRIGGERS = [
  { type: 'org.registered', label: 'An organisation registers', detail: 'Someone fills in the public registration form.', kind: 'event', days: null },
  { type: 'org.created', label: 'An organisation starts', detail: 'You create one, or approve a registration.', kind: 'event', days: null },
  { type: 'trial.ending', label: 'A trial is about to end', detail: 'Days before the trial end date.', kind: 'time', days: { label: 'Days before', default: 3 } },
  { type: 'subscription.expiring', label: 'A subscription is about to end', detail: 'Days before the end or renewal date.', kind: 'time', days: { label: 'Days before', default: 7 } },
  { type: 'subscription.ended', label: 'A subscription or trial has ended', detail: 'Days after the end date (0 = on the day).', kind: 'time', days: { label: 'Days after', default: 0 } },
  { type: 'org.inactive', label: 'Nobody in an organisation signs in', detail: 'For this many days.', kind: 'time', days: { label: 'Days without activity', default: 30 } },
  { type: 'seats.exceeded', label: 'An organisation has more users than its plan', detail: 'Active staff above the plan’s user limit.', kind: 'time', days: null },
  { type: 'integration.failing', label: 'An integration test fails', detail: 'The last test in Settings → Integrations failed.', kind: 'time', days: null },
] as const;
export type TriggerType = (typeof TRIGGERS)[number]['type'];

export const ACTIONS = [
  { type: 'email_org_admins', label: 'Email the organisation’s admins', fields: ['subject', 'message'] },
  { type: 'email_super_admins', label: 'Email the Super Admins', fields: ['subject', 'message'] },
  { type: 'create_task', label: 'Add a task for the Super Admins', fields: ['title'] },
  { type: 'approve_registration', label: 'Approve the registration', fields: ['planCode', 'trialDays'] },
  { type: 'set_subscription_status', label: 'Set the subscription status', fields: ['status'] },
  { type: 'change_plan', label: 'Move to another plan', fields: ['planCode'] },
  { type: 'extend_subscription', label: 'Extend the subscription or trial', fields: ['days'] },
  { type: 'suspend_org', label: 'Pause the organisation', fields: [] },
  { type: 'activate_org', label: 'Reactivate the organisation', fields: [] },
  { type: 'set_feature', label: 'Turn a feature on or off', fields: ['feature', 'channel', 'state'] },
] as const;

const text = z.string().trim().min(1).max(4000);
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('email_org_admins'), subject: text.max(200), message: text }),
  z.object({ type: z.literal('email_super_admins'), subject: text.max(200), message: text }),
  z.object({ type: z.literal('create_task'), title: text.max(200) }),
  z.object({ type: z.literal('approve_registration'), planCode: z.string().max(40).nullable().optional(), trialDays: z.number().int().min(0).max(365).nullable().optional() }),
  z.object({ type: z.literal('set_subscription_status'), status: z.enum(STATUSES) }),
  z.object({ type: z.literal('change_plan'), planCode: z.string().min(1).max(40) }),
  z.object({ type: z.literal('extend_subscription'), days: z.number().int().min(1).max(3650) }),
  z.object({ type: z.literal('suspend_org') }),
  z.object({ type: z.literal('activate_org') }),
  z.object({ type: z.literal('set_feature'), feature: z.string().refine((k) => !!featureDef(k), 'Unknown feature'), channel: z.enum(['web', 'mobile']), state: z.enum(['on', 'off', 'plan']) }),
]);
export type Action = z.infer<typeof actionSchema>;

export const ruleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  trigger: z.enum(TRIGGERS.map((t) => t.type) as [TriggerType, ...TriggerType[]]),
  triggerConfig: z.object({ days: z.number().int().min(0).max(3650).optional() }).strict().default({}),
  conditions: z.object({
    plans: z.array(z.string().max(40)).max(50).optional(),
    statuses: z.array(z.enum(STATUSES)).max(5).optional(),
  }).strict().default({}),
  actions: z.array(actionSchema).min(1).max(10),
  recipe: z.string().max(60).nullable().optional(),
}).strict();
export type RuleInput = z.infer<typeof ruleSchema>;

/** Ready-made rules: one click adds them, and they can be changed afterwards. */
export const RECIPES: (RuleInput & { id: string; summary: string })[] = [
  { id: 'notify-registration', summary: 'Email you and add a task when someone registers.', name: 'Tell me about new registrations', enabled: true, trigger: 'org.registered', triggerConfig: {}, conditions: {},
    actions: [
      { type: 'email_super_admins', subject: 'New registration: {{org}}', message: '{{org}} registered on PROJEXA. Review it in Super Admin → Registrations.' },
      { type: 'create_task', title: 'Review the registration of {{org}}' },
    ] },
  { id: 'auto-approve', summary: 'Approve every registration at once on a 14-day Starter trial.', name: 'Approve registrations on a trial', enabled: true, trigger: 'org.registered', triggerConfig: {}, conditions: {},
    actions: [{ type: 'approve_registration', planCode: 'starter', trialDays: 14 }] },
  { id: 'welcome', summary: 'Welcome email to the new organisation’s admin.', name: 'Welcome new organisations', enabled: true, trigger: 'org.created', triggerConfig: {}, conditions: {},
    actions: [{ type: 'email_org_admins', subject: 'Welcome to PROJEXA, {{org}}', message: 'Your workspace is ready on the {{plan}} plan. Sign in, invite your team in Team and set up email in Settings → Integrations.' }] },
  { id: 'trial-ending', summary: '3 days before a trial ends, remind the organisation.', name: 'Trial ending reminder', enabled: true, trigger: 'trial.ending', triggerConfig: { days: 3 }, conditions: {},
    actions: [{ type: 'email_org_admins', subject: 'Your PROJEXA trial ends on {{date}}', message: 'Your trial of the {{plan}} plan ends on {{date}} ({{days}} days). Contact us to continue without interruption.' }] },
  { id: 'renewal-reminder', summary: '7 days before renewal, remind the organisation and you.', name: 'Renewal reminder', enabled: true, trigger: 'subscription.expiring', triggerConfig: { days: 7 }, conditions: {},
    actions: [
      { type: 'email_org_admins', subject: 'Your PROJEXA subscription renews on {{date}}', message: 'Your {{plan}} subscription ends on {{date}}. Please renew so your team keeps access.' },
      { type: 'email_super_admins', subject: '{{org}} renews on {{date}}', message: '{{org}} ({{plan}}) ends on {{date}}.' },
    ] },
  { id: 'grace', summary: 'When a subscription ends, keep it working 7 more days as past due.', name: 'Grace period when a subscription ends', enabled: true, trigger: 'subscription.ended', triggerConfig: { days: 0 }, conditions: { statuses: ['ACTIVE'] },
    actions: [
      { type: 'set_subscription_status', status: 'PAST_DUE' },
      { type: 'email_org_admins', subject: 'Your PROJEXA subscription has ended', message: 'Your {{plan}} subscription ended on {{date}}. Access continues for 7 days; please renew.' },
    ] },
  { id: 'expire', summary: '7 days after the end date, stop access and tell them.', name: 'Expire after the grace period', enabled: true, trigger: 'subscription.ended', triggerConfig: { days: 7 }, conditions: { statuses: ['PAST_DUE', 'TRIAL'] },
    actions: [
      { type: 'set_subscription_status', status: 'EXPIRED' },
      { type: 'email_org_admins', subject: 'Your PROJEXA access has stopped', message: 'Your {{plan}} subscription ended on {{date}}. Contact us to renew and get access back.' },
    ] },
  { id: 'inactive', summary: 'Tell you when an organisation has not signed in for 30 days.', name: 'Inactive organisations', enabled: true, trigger: 'org.inactive', triggerConfig: { days: 30 }, conditions: {},
    actions: [{ type: 'email_super_admins', subject: '{{org}} has not used PROJEXA for {{days}} days', message: 'Nobody at {{org}} has signed in for {{days}} days.' }] },
  { id: 'seats', summary: 'Tell you when an organisation has more users than its plan.', name: 'Over the user limit', enabled: true, trigger: 'seats.exceeded', triggerConfig: {}, conditions: {},
    actions: [{ type: 'email_super_admins', subject: '{{org}} is over its user limit', message: '{{org}} has {{detail}} on the {{plan}} plan.' }] },
  { id: 'integration-failing', summary: 'Tell the organisation when an integration test fails.', name: 'Integration problems', enabled: true, trigger: 'integration.failing', triggerConfig: {}, conditions: {},
    actions: [{ type: 'email_org_admins', subject: 'An integration needs attention', message: 'The last test of {{detail}} failed. Open Settings → Integrations to fix it.' }] },
];

interface Match { organizationId: string; dedupeKey: string; vars: Record<string, string> }
const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const fill = (s: string, vars: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');

@Injectable()
export class AutomationService implements OnModuleInit {
  private readonly log = new Logger(AutomationService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly superAdmin: SuperAdminService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    this.superAdmin.onEvent = (event, orgId) => this.fire(event, orgId);
  }

  // ───────────── Rules ─────────────

  async list() {
    const rules = await this.prisma.automationRule.findMany({ orderBy: { createdAt: 'asc' } });
    return rules;
  }

  async create(u: AuthUser, body: RuleInput) {
    await this.check(body);
    const r = await this.prisma.automationRule.create({ data: { ...body, createdById: u.id, triggerConfig: body.triggerConfig as Prisma.InputJsonValue, conditions: body.conditions as Prisma.InputJsonValue, actions: body.actions as Prisma.InputJsonValue } });
    return r;
  }

  async addRecipe(u: AuthUser, id: string) {
    const r = RECIPES.find((x) => x.id === id);
    if (!r) throw new NotFoundException('Unknown recipe');
    const { id: _id, summary: _s, ...rule } = r;
    return this.create(u, { ...rule, recipe: id });
  }

  async update(id: string, body: Partial<RuleInput>) {
    const existing = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Rule not found');
    const merged = ruleSchema.parse({ name: existing.name, enabled: existing.enabled, trigger: existing.trigger, triggerConfig: existing.triggerConfig, conditions: existing.conditions, actions: existing.actions, recipe: existing.recipe, ...body });
    await this.check(merged);
    return this.prisma.automationRule.update({ where: { id }, data: { ...merged, triggerConfig: merged.triggerConfig as Prisma.InputJsonValue, conditions: merged.conditions as Prisma.InputJsonValue, actions: merged.actions as Prisma.InputJsonValue } });
  }

  async remove(id: string) {
    await this.prisma.automationRule.delete({ where: { id } }).catch(() => { throw new NotFoundException('Rule not found'); });
    return { ok: true };
  }

  private async check(r: RuleInput) {
    for (const a of r.actions) {
      if ((a.type === 'change_plan' || (a.type === 'approve_registration' && a.planCode)) && !(await this.prisma.plan.findUnique({ where: { code: a.planCode! } }))) {
        throw new BadRequestException(`There is no plan "${a.planCode}"`);
      }
      if (a.type === 'approve_registration' && r.trigger !== 'org.registered') throw new BadRequestException('“Approve the registration” only works with “An organisation registers”');
      if (a.type === 'set_feature' && a.channel === 'mobile' && !featureDef(a.feature)!.mobile) throw new BadRequestException(`${featureDef(a.feature)!.label} is not in the mobile app`);
    }
  }

  async runs(q: { ruleId?: string; limit?: number }) {
    const rows = await this.prisma.automationRun.findMany({
      where: q.ruleId ? { ruleId: q.ruleId } : {}, orderBy: { createdAt: 'desc' }, take: Math.min(q.limit ?? 50, 200),
      include: { rule: { select: { id: true, name: true } }, organization: { select: { id: true, name: true } } },
    });
    return rows;
  }

  // ───────────── Matching ─────────────

  private async matches(rule: AutomationRule, now: Date, onlyOrg?: string): Promise<Match[]> {
    const cfg = rule.triggerConfig as { days?: number };
    const def = TRIGGERS.find((t) => t.type === rule.trigger);
    const days = cfg.days ?? (def && def.days ? def.days.default : 0);
    const orgFilter = onlyOrg ? { organizationId: onlyOrg } : {};
    const out: Match[] = [];
    const subs = () => this.prisma.subscription.findMany({ where: { ...orgFilter, organization: { platformOwner: false, status: { not: 'PENDING' } } }, include: { plan: true, organization: { select: { name: true } } } });
    switch (rule.trigger as TriggerType) {
      case 'trial.ending':
        for (const s of await subs()) {
          if (s.status !== 'TRIAL' || !s.trialEndsAt) continue;
          const left = Math.ceil((s.trialEndsAt.getTime() - now.getTime()) / DAY);
          if (left > 0 && left <= days) out.push({ organizationId: s.organizationId, dedupeKey: `trial:${fmt(s.trialEndsAt)}`, vars: { date: fmt(s.trialEndsAt), days: String(left) } });
        }
        break;
      case 'subscription.expiring':
        for (const s of await subs()) {
          if (!['ACTIVE', 'PAST_DUE'].includes(s.status) || !s.endsAt) continue;
          const left = Math.ceil((s.endsAt.getTime() - now.getTime()) / DAY);
          if (left > 0 && left <= days) out.push({ organizationId: s.organizationId, dedupeKey: `ends:${fmt(s.endsAt)}`, vars: { date: fmt(s.endsAt), days: String(left) } });
        }
        break;
      case 'subscription.ended':
        for (const s of await subs()) {
          const end = s.status === 'TRIAL' ? s.trialEndsAt : ['ACTIVE', 'PAST_DUE'].includes(s.status) ? s.endsAt : null;
          if (!end) continue;
          if (end.getTime() + days * DAY <= now.getTime()) out.push({ organizationId: s.organizationId, dedupeKey: `ended:${fmt(end)}`, vars: { date: fmt(end), days: String(Math.floor((now.getTime() - end.getTime()) / DAY)) } });
        }
        break;
      case 'org.inactive': {
        const since = new Date(now.getTime() - days * DAY);
        const orgs = await this.prisma.organization.findMany({ where: { ...(onlyOrg ? { id: onlyOrg } : {}), status: 'ACTIVE', platformOwner: false, createdAt: { lt: since } }, select: { id: true } });
        for (const o of orgs) {
          const m = await this.prisma.user.aggregate({ where: { organizationId: o.id }, _max: { lastSeenAt: true, lastLoginAt: true } });
          const last = [m._max.lastSeenAt, m._max.lastLoginAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
          if (!last || last < since) out.push({ organizationId: o.id, dedupeKey: `inactive:${last ? fmt(last) : 'never'}`, vars: { days: String(days), date: last ? fmt(last) : 'never' } });
        }
        break;
      }
      case 'seats.exceeded': {
        const orgs = await this.prisma.organization.findMany({ where: { ...(onlyOrg ? { id: onlyOrg } : {}), status: 'ACTIVE', platformOwner: false }, select: { id: true, status: true, platformOwner: true, ...ORG_FEATURES_INCLUDE } });
        for (const o of orgs) {
          const limit = orgFeatures(o).limits.maxUsers;
          if (limit == null) continue;
          const used = await this.prisma.user.count({ where: { organizationId: o.id, active: true, role: { in: ['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER'] } } });
          if (used > limit) out.push({ organizationId: o.id, dedupeKey: `seats:${used}/${limit}`, vars: { detail: `${used} active users (limit ${limit})` } });
        }
        break;
      }
      case 'integration.failing': {
        const rows = await this.prisma.integrationSetting.findMany({ where: { ...orgFilter, lastTestOk: false, organization: { status: 'ACTIVE' } } });
        for (const r of rows) out.push({ organizationId: r.organizationId, dedupeKey: `integration:${r.kind}:${r.lastTestAt?.toISOString() ?? ''}`, vars: { detail: r.kind.replace('_', ' ') } });
        break;
      }
      default:
        break;
    }
    return out;
  }

  private async passes(rule: AutomationRule, orgId: string) {
    const c = rule.conditions as { plans?: string[]; statuses?: SubscriptionStatus[] };
    if (!c.plans?.length && !c.statuses?.length) return true;
    const s = await this.prisma.subscription.findUnique({ where: { organizationId: orgId }, include: { plan: { select: { code: true } } } });
    if (c.plans?.length && (!s || !c.plans.includes(s.plan.code))) return false;
    if (c.statuses?.length && (!s || !c.statuses.includes(s.status))) return false;
    return true;
  }

  // ───────────── Running ─────────────

  /** Event rules (registration, new organisation). */
  async fire(event: 'org.registered' | 'org.created', orgId: string) {
    const rules = await this.prisma.automationRule.findMany({ where: { enabled: true, trigger: event } });
    for (const r of rules) await this.execute(r, { organizationId: orgId, dedupeKey: event, vars: {} });
  }

  /** Time rules: hourly (AUTOMATION_SCHEDULER_ENABLED=false turns it off). */
  @Interval(3_600_000)
  async tick() {
    if (!config.automationSchedulerEnabled || this.running) return;
    this.running = true;
    try {
      await this.runAll();
    } catch (e) {
      this.log.error(`Automation run failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async runAll(now = new Date()) {
    const rules = await this.prisma.automationRule.findMany({ where: { enabled: true, trigger: { notIn: ['org.registered', 'org.created'] } } });
    let acted = 0;
    for (const r of rules) acted += await this.runRule(r, now);
    return { rules: rules.length, acted };
  }

  async runRule(rule: AutomationRule, now = new Date()) {
    let acted = 0;
    for (const m of await this.matches(rule, now)) {
      if (await this.execute(rule, m)) acted++;
    }
    await this.prisma.automationRule.update({ where: { id: rule.id }, data: { lastRunAt: now } });
    return acted;
  }

  async runNow(id: string) {
    const rule = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Rule not found');
    if (rule.trigger === 'org.registered' || rule.trigger === 'org.created') throw new BadRequestException('This rule runs by itself when the event happens');
    return { acted: await this.runRule(rule) };
  }

  /** Which organisations the rule would act on now, without acting. */
  async preview(body: RuleInput) {
    const fake = { ...body, id: 'preview', triggerConfig: body.triggerConfig, conditions: body.conditions } as unknown as AutomationRule;
    if (body.trigger === 'org.registered' || body.trigger === 'org.created') return { event: true, organizations: [] };
    const ms = await this.matches(fake, new Date());
    const out = [];
    for (const m of ms) {
      if (!(await this.passes(fake, m.organizationId))) continue;
      const done = await this.prisma.automationRun.findFirst({ where: { ruleId: { not: 'preview' }, organizationId: m.organizationId, dedupeKey: m.dedupeKey, rule: { trigger: body.trigger } }, select: { id: true } });
      const o = await this.prisma.organization.findUnique({ where: { id: m.organizationId }, select: { id: true, name: true } });
      if (o) out.push({ ...o, ...m.vars, alreadyHandled: !!done });
    }
    return { event: false, organizations: out };
  }

  /** Runs the actions for one organisation once. Returns whether it acted. */
  private async execute(rule: AutomationRule, m: Match): Promise<boolean> {
    if (!(await this.passes(rule, m.organizationId))) return false;
    const already = await this.prisma.automationRun.findUnique({ where: { ruleId_organizationId_dedupeKey: { ruleId: rule.id, organizationId: m.organizationId, dedupeKey: m.dedupeKey } } });
    if (already) return false;
    // Claim the occasion first, so two servers never both act.
    let run;
    try {
      run = await this.prisma.automationRun.create({ data: { ruleId: rule.id, organizationId: m.organizationId, dedupeKey: m.dedupeKey, status: 'running' } });
    } catch {
      return false;
    }
    const results: { action: string; ok: boolean; message?: string }[] = [];
    for (const a of rule.actions as Action[]) {
      try {
        const vars = await this.vars(m);
        results.push({ action: a.type, ok: true, message: await this.act(a, m.organizationId, vars) });
      } catch (e) {
        results.push({ action: a.type, ok: false, message: (e as Error).message });
      }
    }
    const ok = results.every((r) => r.ok);
    await this.prisma.automationRun.update({ where: { id: run.id }, data: { status: ok ? 'ok' : 'failed', detail: { results, vars: m.vars } as Prisma.InputJsonValue } });
    await this.prisma.automationRule.update({ where: { id: rule.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } });
    return true;
  }

  private async vars(m: Match) {
    const o = await this.prisma.organization.findUnique({ where: { id: m.organizationId }, include: { subscription: { include: { plan: true } } } });
    return { org: o?.name ?? '', plan: o?.subscription?.plan.name ?? 'no', ...m.vars };
  }

  private async emailTo(to: string[], subject: string, message: string, vars: Record<string, string>) {
    if (!to.length) return 'Nobody to email';
    const body = fill(message, vars);
    await this.mail.send({
      organizationId: await this.superAdmin.ownerId(), to, subject: fill(subject, vars).slice(0, 200), text: body,
      html: body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''),
    });
    return `Emailed ${to.length}`;
  }

  private async superAdmins() {
    return this.prisma.user.findMany({ where: { superAdmin: true, active: true, organization: { platformOwner: true } }, select: { id: true, email: true } });
  }

  private async act(a: Action, orgId: string, vars: Record<string, string>): Promise<string> {
    switch (a.type) {
      case 'email_org_admins': {
        const admins = await this.prisma.user.findMany({ where: { organizationId: orgId, role: 'ADMIN', active: true }, select: { email: true } });
        return this.emailTo(admins.map((x) => x.email), a.subject, a.message, vars);
      }
      case 'email_super_admins':
        return this.emailTo((await this.superAdmins()).map((x) => x.email), a.subject, a.message, vars);
      case 'create_task': {
        const owner = await this.superAdmin.ownerId();
        const people = await this.superAdmins();
        for (const p of people) await this.prisma.task.create({ data: { organizationId: owner, title: fill(a.title, vars).slice(0, 200), assigneeId: p.id, remindAt: new Date(), source: 'automation' } });
        return `Task for ${people.length}`;
      }
      case 'approve_registration': {
        const o = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { status: true } });
        if (o?.status !== 'PENDING') return 'Already handled';
        await this.superAdmin.approve(null, orgId, { planCode: a.planCode ?? undefined, trialDays: a.trialDays ?? undefined });
        return 'Approved';
      }
      case 'set_subscription_status': {
        const r = await this.prisma.subscription.updateMany({ where: { organizationId: orgId }, data: { status: a.status } });
        if (!r.count) throw new Error('No subscription');
        await this.audit(orgId, 'superadmin.subscription', { status: a.status });
        return `Status ${a.status}`;
      }
      case 'change_plan': {
        const plan = await this.prisma.plan.findUnique({ where: { code: a.planCode } });
        if (!plan) throw new Error(`No plan ${a.planCode}`);
        const r = await this.prisma.subscription.updateMany({ where: { organizationId: orgId }, data: { planId: plan.id } });
        if (!r.count) await this.prisma.subscription.create({ data: { organizationId: orgId, planId: plan.id } });
        await this.audit(orgId, 'superadmin.subscription', { plan: a.planCode });
        return `Plan ${plan.name}`;
      }
      case 'extend_subscription': {
        const s = await this.prisma.subscription.findUnique({ where: { organizationId: orgId } });
        if (!s) throw new Error('No subscription');
        const now = Date.now();
        const field = s.status === 'TRIAL' ? 'trialEndsAt' : 'endsAt';
        const from = Math.max(now, s[field]?.getTime() ?? now);
        await this.prisma.subscription.update({ where: { id: s.id }, data: { [field]: new Date(from + a.days * DAY) } });
        await this.audit(orgId, 'superadmin.subscription', { extendedDays: a.days });
        return `Extended ${a.days} days`;
      }
      case 'suspend_org':
        await this.superAdmin.updateOrganization(null, orgId, { status: 'SUSPENDED' });
        return 'Paused';
      case 'activate_org':
        await this.superAdmin.updateOrganization(null, orgId, { status: 'ACTIVE' });
        return 'Reactivated';
      case 'set_feature':
        await this.superAdmin.setFeatures(null, orgId, [{ feature: a.feature, channel: a.channel, state: a.state }]);
        return `${a.feature} ${a.state}`;
    }
  }

  private audit(orgId: string, action: string, detail: object) {
    return this.prisma.auditEvent.create({ data: { organizationId: orgId, actorId: null, action, entityType: 'Subscription', entityId: orgId, detail: { ...detail, bySuperAdmin: 'automation' } } });
  }

  catalog() {
    return { triggers: TRIGGERS, actions: ACTIONS, recipes: RECIPES.map((r) => ({ id: r.id, name: r.name, summary: r.summary, trigger: r.trigger })) };
  }
}
