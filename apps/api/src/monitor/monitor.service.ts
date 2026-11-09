import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AllocationStatus, Prisma } from '@prisma/client';
import { createHmac, randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { config } from '../common/config';
import { PushService } from '../push/push';
import { WebhooksService } from '../webhooks/webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { allocationRules, autoPauseStateOf, autopilotOf, Candidate, marketRules, Metrics, pace, Pace, settingsOf } from './monitor.rules';
import { runAutoPause } from './auto-pause';
import { RoutingService } from './routing.service';
import { ForecastMarketIn, forecastProject, marginFloorOf, marginRules, ProjectForecast } from './forecast';

type Fetcher = (url: string, init: RequestInit) => Promise<{ status: number }>;

interface Row extends Metrics { key: string }

export interface MarketView {
  project: { id: string; projectCode: string; name: string; status: string; fieldStartAt: Date | null; fieldEndAt: Date | null };
  country: { id: string; countryCode: string; targetGroup: string | null; status: string; irPercent: number; loiMinutes: number; currency: string; /** Client CPI. */ cpi: number };
  metrics: Metrics;
  pace: Pace;
  ir: number | null;
  allocations: { id: string; vendor: { id: string; name: string; code: string }; status: AllocationStatus; cpi: number; metrics: Metrics; pace: Pace; qualityShare24h: number | null; dropShare24h: number | null }[];
  /** Quota cells of the market (docs/QUOTAS.md). */
  cells: { id: string; group: string; name: string; target: number; completes: number; isOpen: boolean }[];
}

const SEVERITY_RANK: Record<string, number> = { bad: 0, warn: 1, info: 2 };

@Injectable()
export class MonitorService {
  private readonly log = new Logger(MonitorService.name);
  private running = false;
  fetcher: Fetcher = (url, init) => fetch(url, init);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhooksService,
    private readonly push: PushService,
    private readonly routing: RoutingService,
  ) {}

  /** Every five minutes: evaluate every organisation that has live fieldwork or open alerts. */
  @Interval(5 * 60_000)
  async tick() {
    if (!config.monitorEnabled || this.running) return;
    this.running = true;
    try {
      const orgs = await this.prisma.organization.findMany({
        where: { OR: [{ projects: { some: { status: 'LIVE' } } }, { alerts: { some: { state: { not: 'RESOLVED' } } } }] },
        select: { id: true },
      });
      for (const o of orgs) await this.evaluate(o.id);
    } catch (e) {
      this.log.error(`Fieldwork monitor failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Counts per market (group = country) or per vendor link (group = allocation) for live projects. */
  private async metrics(org: string, group: 'country' | 'allocation', projectId: string | undefined, now: Date): Promise<Map<string, Row>> {
    const col = group === 'country' ? Prisma.sql`s."projectCountryId"` : Prisma.sql`s."vendorAllocationId"`;
    const d24 = new Date(now.getTime() - 24 * 3_600_000);
    const d72 = new Date(now.getTime() - 72 * 3_600_000);
    const rows = await this.prisma.$queryRaw<(Omit<Row, 'target'> & { firstEntryAt: Date | null })[]>`
      SELECT ${col} AS key,
        COUNT(*) FILTER (WHERE s.status = 'COMPLETE')::int AS completes,
        COUNT(*) FILTER (WHERE s.status = 'TERMINATE')::int AS terminates,
        COUNT(*) FILTER (WHERE s."startedAt" >= ${d24})::int AS "entries24h",
        COUNT(*) FILTER (WHERE s."startedAt" >= ${d24} AND s.status IN ('QUALITY_FAIL', 'DUPLICATE', 'SECURITY_REJECT'))::int AS "quality24h",
        COUNT(*) FILTER (WHERE s."startedAt" >= ${d24} AND s.status = 'PARTIAL')::int AS "dropped24h",
        COUNT(*) FILTER (WHERE s.status = 'COMPLETE' AND s."outcomeAt" >= ${d72})::int AS "completes72h",
        MIN(s."startedAt") AS "firstEntryAt",
        MAX(s."startedAt") AS "lastEntryAt",
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (s."outcomeAt" - s."startedAt")) / 60)
          FILTER (WHERE s.status = 'COMPLETE' AND s."outcomeAt" IS NOT NULL))::float8 AS "medianLoiMinutes"
      FROM "RespondentSession" s JOIN "Project" p ON p.id = s."projectId"
      WHERE s."organizationId" = ${org} AND s."isTest" = false AND p.status = 'LIVE'
        ${projectId ? Prisma.sql`AND s."projectId" = ${projectId}` : Prisma.empty}
      GROUP BY 1`;
    return new Map(rows.map((r) => [r.key, { ...r, target: 0 }]));
  }

  /** Live markets with their vendor links, metrics and pace. */
  async markets(org: string, projectId?: string, now = new Date()): Promise<MarketView[]> {
    const s = settingsOf((await this.prisma.organization.findUnique({ where: { id: org }, select: { alertSettings: true } }))?.alertSettings);
    const countries = await this.prisma.projectCountry.findMany({
      where: { project: { organizationId: org, status: 'LIVE', ...(projectId ? { id: projectId } : {}) }, status: { in: ['LIVE', 'HOLD'] } },
      include: {
        project: { select: { id: true, projectCode: true, name: true, status: true, fieldStartAt: true, fieldEndAt: true } },
        allocations: { include: { vendor: { select: { id: true, name: true, code: true } } }, orderBy: { createdAt: 'asc' } },
        quotas: { select: { id: true, group: true, name: true, target: true, completes: true, isOpen: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
      orderBy: [{ project: { projectCode: 'asc' } }, { countryCode: 'asc' }],
    });
    const [byCountry, byAlloc] = await Promise.all([this.metrics(org, 'country', projectId, now), this.metrics(org, 'allocation', projectId, now)]);
    const empty = (target: number): Metrics => ({ target, completes: 0, terminates: 0, entries24h: 0, quality24h: 0, dropped24h: 0, completes72h: 0, firstEntryAt: null, lastEntryAt: null, medianLoiMinutes: null });
    const share = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
    return countries.map((c) => {
      const m = { ...(byCountry.get(c.id) ?? empty(0)), target: c.targetCompletes };
      return {
        project: c.project,
        country: { id: c.id, countryCode: c.countryCode, targetGroup: c.targetGroup, status: c.status, irPercent: c.irPercent, loiMinutes: c.loiMinutes, currency: c.currency, cpi: Number(c.cpi) },
        metrics: strip(m),
        pace: pace(m, c.project.fieldEndAt, now, s.stalledHours),
        ir: share(m.completes, m.completes + m.terminates),
        allocations: c.allocations.map((a) => {
          const am = { ...(byAlloc.get(a.id) ?? empty(0)), target: a.targetCompletes };
          return { id: a.id, vendor: a.vendor, status: a.status, cpi: Number(a.cpi), metrics: strip(am), pace: pace(am, c.project.fieldEndAt, now, s.stalledHours), qualityShare24h: share(am.quality24h, am.entries24h), dropShare24h: share(am.dropped24h, am.entries24h) };
        }),
        cells: c.quotas,
      };
    });
  }

  /**
   * Finish date, cost and margin forecast for each live project (docs/PROFIT_FORECAST.md).
   * Pass `markets` when they are already loaded for the same organisation and moment.
   */
  async forecasts(org: string, projectId?: string, now = new Date(), markets?: MarketView[]): Promise<Map<string, ProjectForecast>> {
    const mks = markets ?? (await this.markets(org, projectId, now));
    const ids = [...new Set(mks.map((m) => m.project.id))];
    if (!ids.length) return new Map();
    const [orgRow, projects, money, closed] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: org }, select: { alertSettings: true } }),
      this.prisma.project.findMany({ where: { id: { in: ids }, organizationId: org }, select: { id: true, autopilot: true } }),
      this.prisma.respondentSession.groupBy({ by: ['projectCountryId'], where: { organizationId: org, projectId: { in: ids }, isTest: false, status: 'COMPLETE' }, _sum: { revenue: true, payout: true }, _count: { _all: true } }),
      // Closed markets take no more completes, but what they earned and cost stays in the project's money.
      this.prisma.projectCountry.findMany({ where: { projectId: { in: ids }, status: 'CLOSED' }, select: { id: true, projectId: true, countryCode: true, currency: true, cpi: true } }),
    ]);
    const s = settingsOf(orgRow?.alertSettings);
    const moneyOf = new Map(money.map((m) => [m.projectCountryId, { revenue: Number(m._sum.revenue ?? 0), cost: Number(m._sum.payout ?? 0), completes: m._count._all }]));
    const out = new Map<string, ProjectForecast>();
    for (const p of projects) {
      const own = mks.filter((m) => m.project.id === p.id);
      const input: ForecastMarketIn[] = own.map((m) => ({
        id: m.country.id,
        countryCode: m.country.countryCode,
        status: m.country.status,
        currency: m.country.currency,
        cpi: m.country.cpi,
        target: m.metrics.target,
        completes: m.metrics.completes,
        revenue: moneyOf.get(m.country.id)?.revenue ?? 0,
        cost: moneyOf.get(m.country.id)?.cost ?? 0,
        pace: m.pace,
        vendors: m.allocations.map((a) => ({ cpi: a.cpi, target: a.metrics.target, completes: a.metrics.completes, status: a.status, perDay: a.pace.perDay })),
      }));
      for (const c of closed.filter((c) => c.projectId === p.id)) {
        const got = moneyOf.get(c.id) ?? { revenue: 0, cost: 0, completes: 0 };
        const done = { status: 'done' as const, perDay: 0, requiredPerDay: null, remaining: 0, etaDays: 0, daysLeft: null };
        input.push({ id: c.id, countryCode: c.countryCode, status: 'CLOSED', currency: c.currency, cpi: Number(c.cpi), target: got.completes, completes: got.completes, revenue: got.revenue, cost: got.cost, pace: done, vendors: [] });
      }
      out.set(p.id, forecastProject(input, { now, fieldEndAt: own[0].project.fieldEndAt, marginFloorPct: marginFloorOf(s, autopilotOf(p.autopilot).marginFloorPct), marginDropPts: s.marginDropPts }));
    }
    return out;
  }

  /**
   * Runs every rule for one organisation: opens or refreshes alerts, resolves the ones whose
   * condition has cleared, takes autopilot actions and notifies the webhook about new alerts.
   */
  async evaluate(org: string, now = new Date()) {
    const orgRow = await this.prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { alertSettings: true, alertWebhookUrl: true, alertWebhookSecret: true } });
    const s = settingsOf(orgRow.alertSettings);
    // Auto-pause checkpoints first: they change market and link statuses the rules below look at.
    const pauseActions: string[] = [];
    for (const p of await this.prisma.project.findMany({ where: { organizationId: org, status: 'LIVE' }, select: { id: true, autopilot: true } })) {
      if (autopilotOf(p.autopilot).autoPause.enabled) pauseActions.push(...(await runAutoPause(this.prisma, p.id, now)).actions);
    }
    let markets = await this.markets(org, undefined, now);
    // Vendor auto-routing (projects set to "auto"): it changes vendor targets, so read the markets again after it.
    const routeActions = await this.routing.runAuto(org, markets, s, now);
    if (routeActions.length) markets = await this.markets(org, undefined, now);
    const projectRows = await this.prisma.project.findMany({ where: { id: { in: [...new Set(markets.map((m) => m.project.id))] } }, select: { id: true, autopilot: true, autopilotState: true } });
    const autopilots = new Map(projectRows.map((p) => [p.id, autopilotOf(p.autopilot)]));
    const pauseStates = new Map(projectRows.map((p) => [p.id, autoPauseStateOf(p.autopilotState, autopilotOf(p.autopilot).autoPause)]));

    type Found = Candidate & { projectId?: string; projectCountryId?: string; vendorAllocationId?: string; autoAction?: string };
    const found: Found[] = [];
    const actions: string[] = [...pauseActions, ...routeActions];
    for (const mk of markets) {
      const label = `${mk.project.projectCode} ${mk.country.countryCode}`;
      // Held or paused by the auto-pause checkpoint: an info alert until someone resumes it.
      const done = pauseStates.get(mk.project.id)?.done ?? {};
      const held = done[`m:${mk.country.id}`];
      if (held?.reason === 'paused' && mk.country.status === 'HOLD') {
        found.push({ dedupeKey: `m:${mk.country.id}:auto_paused`, rule: 'auto_paused', severity: 'info', title: `${label} is on hold at the auto-pause checkpoint`, detail: `${held.completes} of ${held.target} completes. Check the data, then set the market live again; the checkpoint will not pause it again.`, projectId: mk.project.id, projectCountryId: mk.country.id, autoAction: `Put ${mk.country.countryCode} on hold at ${held.completes} of ${held.target} completes` });
      }
      for (const a of mk.allocations) {
        const d = done[`a:${a.id}`];
        if (d?.reason === 'paused' && a.status === 'PAUSED') {
          found.push({ dedupeKey: `a:${a.id}:auto_paused`, rule: 'auto_paused', severity: 'info', title: `${label} · ${a.vendor.name} is paused at the auto-pause checkpoint`, detail: `${d.completes} of ${d.target} completes. Check the data, then reactivate the link; the checkpoint will not pause it again.`, projectId: mk.project.id, projectCountryId: mk.country.id, vendorAllocationId: a.id, autoAction: `Paused ${a.vendor.name} at ${d.completes} of ${d.target} completes` });
        }
      }
      // Pausing every vendor link does not hide a market that is stalled or behind.
      const live = mk.country.status === 'LIVE';
      for (const c of marketRules(`m:${mk.country.id}`, label, mk.metrics, mk.pace, mk.country, s, live, now)) found.push({ ...c, projectId: mk.project.id, projectCountryId: mk.country.id });
      for (const q of mk.cells) {
        if (q.isOpen && q.completes >= q.target) {
          const name = q.group ? `${q.group}: ${q.name}` : q.name;
          found.push({ dedupeKey: `q:${q.id}:cell_full`, rule: 'cell_full', severity: 'info', title: `${label} quota cell ${name} is full`, detail: `${q.completes} of ${q.target} completes. Matching respondents now go to quota full; raise the target to keep them.`, projectId: mk.project.id, projectCountryId: mk.country.id });
        }
      }
      const ap = autopilots.get(mk.project.id)!;
      for (const a of mk.allocations) {
        const alabel = `${label} · ${a.vendor.name}`;
        for (const c of allocationRules(`a:${a.id}`, alabel, a.metrics, s)) {
          let autoAction: string | undefined;
          if (c.rule === 'quality_spike' && ap.pauseOnQuality && a.status === 'ACTIVE') {
            autoAction = await this.setAllocation(org, mk.project.id, a.id, 'PAUSED', `Paused ${a.vendor.name} in ${mk.country.countryCode}: ${c.title}`);
            a.status = 'PAUSED';
          }
          if (autoAction) actions.push(autoAction);
          found.push({ ...c, projectId: mk.project.id, projectCountryId: mk.country.id, vendorAllocationId: a.id, autoAction });
        }
        if (a.metrics.target > 0 && a.metrics.completes >= a.metrics.target) {
          let autoAction: string | undefined;
          if (ap.closeOnTarget && a.status === 'ACTIVE') {
            autoAction = await this.setAllocation(org, mk.project.id, a.id, 'CLOSED', `Closed ${a.vendor.name} in ${mk.country.countryCode}: target of ${a.metrics.target} reached`);
            actions.push(autoAction);
            a.status = 'CLOSED';
          }
          found.push({
            dedupeKey: `a:${a.id}:target_reached`, rule: 'target_reached', severity: 'info', title: `${alabel} reached its target`,
            detail: a.status === 'CLOSED' ? `${a.metrics.completes} completes; the link is closed.` : `${a.metrics.completes} of ${a.metrics.target} completes. Close the link or raise its target.`,
            projectId: mk.project.id, projectCountryId: mk.country.id, vendorAllocationId: a.id, autoAction,
          });
        }
      }
    }
    // Margin forecast: one alert per project and currency when the predicted margin is too low.
    const forecasts = await this.forecasts(org, undefined, now, markets);
    for (const [projectId, f] of forecasts) {
      const code = markets.find((m) => m.project.id === projectId)!.project.projectCode;
      for (const c of marginRules(`p:${projectId}`, code, f)) found.push({ ...c, projectId });
    }
    const failed = await this.prisma.callbackDelivery.count({ where: { organizationId: org, state: { in: ['FAILED', 'DEAD_LETTER'] } } });
    if (failed) found.push({ dedupeKey: 'org:callbacks_failed', rule: 'callbacks_failed', severity: 'bad', title: `${failed} vendor callback${failed === 1 ? '' : 's'} failed`, detail: 'Replay them from the project page once the vendor endpoint is fixed.', metrics: { failed } });

    const open = await this.prisma.alert.findMany({ where: { organizationId: org, state: { not: 'RESOLVED' } } });
    const byKey = new Map(open.map((a) => [a.dedupeKey, a]));
    const created: { id: string }[] = [];
    let updated = 0;
    for (const f of found) {
      const ex = byKey.get(f.dedupeKey);
      const data = { severity: f.severity, title: f.title, detail: f.detail, metrics: (f.metrics ?? Prisma.DbNull) as Prisma.InputJsonValue, lastSeenAt: now };
      if (ex) {
        await this.prisma.alert.update({ where: { id: ex.id }, data: { ...data, ...(f.autoAction ? { autoAction: f.autoAction } : {}) } });
        updated++;
      } else {
        created.push(
          await this.prisma.alert.create({
            data: { ...data, organizationId: org, rule: f.rule, dedupeKey: f.dedupeKey, projectId: f.projectId, projectCountryId: f.projectCountryId, vendorAllocationId: f.vendorAllocationId, autoAction: f.autoAction, firstSeenAt: now },
          }),
        );
      }
    }
    const keys = new Set(found.map((f) => f.dedupeKey));
    const cleared = open.filter((a) => !keys.has(a.dedupeKey)).map((a) => a.id);
    if (cleared.length) await this.prisma.alert.updateMany({ where: { id: { in: cleared } }, data: { state: 'RESOLVED', resolvedAt: now, resolvedBy: 'auto' } });

    for (const c of created) {
      const a = await this.prisma.alert.findUniqueOrThrow({ where: { id: c.id }, include: { project: { select: { id: true, projectCode: true, name: true } } } });
      await this.webhooks.emit(org, 'alert.opened', { alert: { id: a.id, rule: a.rule, severity: a.severity, title: a.title, detail: a.detail, autoAction: a.autoAction, firstSeenAt: a.firstSeenAt, project: a.project } });
      await this.push.alertOpened(org, a);
    }
    if (orgRow.alertWebhookUrl && orgRow.alertWebhookSecret) {
      for (const c of created) await this.notify(c.id, orgRow.alertWebhookUrl, orgRow.alertWebhookSecret);
    }
    return { opened: created.length, updated, resolved: cleared.length, actions };
  }

  private async setAllocation(org: string, projectId: string, allocationId: string, status: AllocationStatus, text: string) {
    await this.prisma.vendorAllocation.update({ where: { id: allocationId }, data: { status } });
    await this.audit.record({ organizationId: org, actorId: null, action: status === 'PAUSED' ? 'autopilot.pause_link' : 'autopilot.close_link', entityType: 'Project', entityId: projectId, detail: { allocationId, text } });
    return text;
  }

  /** Signed POST of one alert. The signature covers `${timestamp}.${body}`. */
  async notify(alertId: string, url: string, secret: string, test = false) {
    const alert = test
      ? { id: 'test', rule: 'test', severity: 'info', title: 'Test alert from SampTrek', detail: 'Your alert webhook works.', firstSeenAt: new Date() }
      : await this.prisma.alert.findUniqueOrThrow({ where: { id: alertId }, include: { project: { select: { id: true, projectCode: true, name: true } } } });
    const body = JSON.stringify({ event: test ? 'alert.test' : 'alert.opened', alert, link: `${config.webOrigins[0] ?? ''}/monitor` });
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    let status: string;
    try {
      const r = await this.fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'PROJEXA-Alerts/1', 'X-Projexa-Timestamp': ts, 'X-Projexa-Signature': `sha256=${sig}` },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      status = String(r.status);
    } catch (e) {
      status = `error: ${(e as Error).message.slice(0, 80)}`;
    }
    if (!test) await this.prisma.alert.update({ where: { id: alertId }, data: { webhookStatus: status } });
    return status;
  }

  static newSecret() {
    return randomBytes(24).toString('base64url');
  }

  static rank(a: { severity: string; lastSeenAt: Date }, b: { severity: string; lastSeenAt: Date }) {
    return (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) || b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
  }
}

function strip(m: Metrics): Metrics {
  return {
    target: m.target,
    completes: m.completes,
    terminates: m.terminates,
    entries24h: m.entries24h,
    quality24h: m.quality24h,
    dropped24h: m.dropped24h,
    completes72h: m.completes72h,
    firstEntryAt: m.firstEntryAt,
    lastEntryAt: m.lastEntryAt,
    medianLoiMinutes: m.medianLoiMinutes == null ? null : Math.round(m.medianLoiMinutes * 10) / 10,
  };
}
