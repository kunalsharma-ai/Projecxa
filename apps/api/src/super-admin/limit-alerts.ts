/**
 * Plan limit emails (docs/PLAN_LIMITS.md): when an organisation's usage reaches 80% of a limit, and again
 * when it reaches the limit, its admins get an email. Super Admins get one when a limit is reached.
 * Each limit sends each email once per period: per calendar month for monthly limits, and for the
 * others once per limit value (raising the limit lets the emails come again).
 *
 * Checked every hour for every organisation, and a few seconds after the organisation adds something
 * that has a limit or after its traffic counts are refreshed. LIMIT_ALERTS_ENABLED=false turns it off.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { webBaseOf } from '../branding/branding';
import { config } from '../common/config';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from './entitlements';
import { LIMIT_MESSAGE, LimitDef, LIMITS } from './limits';
import { esc, SuperAdminService } from './super-admin.service';

/** "Close to the limit" starts at this share of it. */
export const NEAR_SHARE = 0.8;
export type AlertLevel = 'near' | 'reached';

export function alertLevel(used: number, max: number): AlertLevel | null {
  if (max <= 0) return null; // 0 = the plan does not include it at all; nothing to warn about.
  if (used >= max) return 'reached';
  if (used >= max * NEAR_SHARE) return 'near';
  return null;
}

export interface Crossing { def: LimitDef; level: AlertLevel; used: number; max: number }

const n = (x: number) => x.toLocaleString('en');

/** One line per limit for the email. */
export function crossingLine(c: Crossing, trafficAction: 'stop' | 'warn'): string {
  const month = c.def.period === 'month' ? ' this month' : '';
  const head = `${c.def.label}: ${n(c.used)} of ${n(c.max)}${month}`;
  if (c.level === 'near') return `${head} (${Math.min(99, Math.floor((c.used / c.max) * 100))}%).`;
  if (c.def.traffic) {
    return `${head}. ${trafficAction === 'stop' ? 'New live entries now go back to the vendor as quota full; test links and respondents already in a survey are not affected.' : 'Entries keep going; the overrun shows on your Subscription page.'}`;
  }
  return `${head}. ${LIMIT_MESSAGE[c.def.key](c.max)}`;
}

@Injectable()
export class LimitAlertsService implements OnModuleInit {
  private readonly log = new Logger(LimitAlertsService.name);
  private running = false;
  private readonly queued = new Map<string, NodeJS.Timeout>();
  private readonly lastCheck = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly superAdmin: SuperAdminService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    this.entitlements.onUsage = (orgId) => this.soon(orgId);
  }

  /** Check one organisation a few seconds from now (at most once a minute each). */
  soon(orgId: string) {
    if (!config.limitAlertsEnabled || this.queued.has(orgId)) return;
    const wait = Math.max(5_000, 60_000 - (Date.now() - (this.lastCheck.get(orgId) ?? 0)));
    const t = setTimeout(() => {
      this.queued.delete(orgId);
      this.check(orgId).catch((e) => this.log.warn(`Limit check for ${orgId} failed: ${(e as Error).message}`));
    }, wait);
    t.unref?.();
    this.queued.set(orgId, t);
  }

  @Interval(3_600_000)
  async tick() {
    if (!config.limitAlertsEnabled || this.running) return;
    this.running = true;
    try {
      await this.checkAll();
    } catch (e) {
      this.log.error(`Limit check failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async checkAll(now = new Date()) {
    const orgs = await this.prisma.organization.findMany({ where: { status: 'ACTIVE', platformOwner: false, subscription: { isNot: null } }, select: { id: true } });
    let emailed = 0;
    for (const o of orgs) if ((await this.check(o.id, now)).length) emailed++;
    return { organizations: orgs.length, emailed };
  }

  /** Emails what is newly close to or at its limit. Returns what it emailed about. */
  async check(orgId: string, now = new Date()): Promise<Crossing[]> {
    this.lastCheck.set(orgId, Date.now());
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, status: true, platformOwner: true, customDomain: true, customDomainVerifiedAt: true } });
    if (!org || org.platformOwner || org.status !== 'ACTIVE') return [];
    const o = await this.entitlements.forOrg(orgId);
    if (o.block) return [];
    const defs = LIMITS.filter((d) => (o.limits[d.key] ?? 0) > 0);
    if (!defs.length) return [];
    const used = await this.entitlements.usage(orgId, defs.map((d) => d.key), now);
    const month = now.toISOString().slice(0, 7);

    const fresh: (Crossing & { id: string })[] = [];
    for (const def of defs) {
      const max = o.limits[def.key]!;
      const u = used[def.key] ?? 0;
      const level = alertLevel(u, max);
      if (!level) continue;
      const period = def.period === 'month' ? month : `max:${max}`;
      const claim = (lvl: AlertLevel) => this.prisma.limitAlert.create({ data: { organizationId: orgId, limit: def.key, level: lvl, period, used: u, max } });
      let row;
      try {
        // Claiming the row first means two servers never both send it.
        row = await claim(level);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
      // Straight to the limit: no "close to it" email afterwards for the same period.
      if (level === 'reached') await claim('near').catch(() => undefined);
      fresh.push({ def, level, used: u, max, id: row.id });
    }
    if (!fresh.length) return [];

    const sentTo = await this.send(org, fresh, o.trafficAction);
    await this.prisma.limitAlert.updateMany({ where: { id: { in: fresh.map((c) => c.id) } }, data: { sentTo } });
    return fresh.map(({ id: _id, ...c }) => c);
  }

  private async send(org: { id: string; name: string; customDomain: string | null; customDomainVerifiedAt: Date | null }, cs: Crossing[], trafficAction: 'stop' | 'warn') {
    const reached = cs.filter((c) => c.level === 'reached');
    const near = cs.filter((c) => c.level === 'near');
    const link = `${webBaseOf(org)}/settings/subscription`;
    const owner = await this.superAdmin.ownerId();
    const parts: string[] = [];

    const admins = await this.prisma.user.findMany({ where: { organizationId: org.id, role: 'ADMIN', active: true }, select: { email: true } });
    if (admins.length) {
      const paras = [`Hello,`];
      if (reached.length) paras.push(`${org.name} has reached ${reached.length === 1 ? 'a limit' : `${reached.length} limits`} of its plan:\n${reached.map((c) => `• ${crossingLine(c, trafficAction)}`).join('\n')}`);
      if (near.length) paras.push(`${reached.length ? 'It is also close to' : `${org.name} is close to`} ${near.length === 1 ? 'a limit' : `${near.length} limits`} of its plan:\n${near.map((c) => `• ${crossingLine(c, trafficAction)}`).join('\n')}`);
      if (cs.some((c) => c.def.period === 'month')) paras.push('Monthly limits start again on the 1st.');
      paras.push(`See your usage under Settings → Subscription, and ask your SampTrek provider if you need more: ${link}`);
      const subject = reached.length
        ? `${org.name} has reached its plan limit for ${reached.map((c) => c.def.label.toLowerCase()).join(', ')}`
        : `${org.name} is close to its plan limit for ${near.map((c) => c.def.label.toLowerCase()).join(', ')}`;
      parts.push(await this.mailTo(owner, admins.map((a) => a.email), subject, paras, `${admins.length} admin${admins.length === 1 ? '' : 's'}`));
    }

    if (reached.length) {
      const sas = await this.prisma.user.findMany({ where: { superAdmin: true, active: true, organization: { platformOwner: true } }, select: { email: true } });
      if (sas.length) {
        const paras = [
          `${org.name} has reached ${reached.length === 1 ? 'a limit' : `${reached.length} limits`} of its plan:\n${reached.map((c) => `• ${crossingLine(c, trafficAction)}`).join('\n')}`,
          `Raise the limit for this organisation, or move it to another plan, in Super Admin → Organisations → ${org.name} → Subscription.`,
        ];
        parts.push(await this.mailTo(owner, sas.map((s) => s.email), `${org.name} reached its plan limit: ${reached.map((c) => c.def.label.toLowerCase()).join(', ')}`, paras, `${sas.length} Super Admin${sas.length === 1 ? '' : 's'}`));
      }
    }
    return parts.length ? parts.join(', ') : 'Nobody to email';
  }

  private async mailTo(owner: string, to: string[], subject: string, paras: string[], who: string) {
    const text = paras.join('\n\n');
    try {
      await this.mail.send({ organizationId: owner, to, subject: subject.slice(0, 200), text, html: paras.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') });
      return who;
    } catch (e) {
      this.log.warn(`Limit email "${subject}" not sent: ${(e as Error).message}`);
      return `${who}: not sent (${(e as Error).message.slice(0, 120)})`;
    }
  }

}
