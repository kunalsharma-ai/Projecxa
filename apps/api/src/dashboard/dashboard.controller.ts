import { Body, Controller, Get, Module, Patch, Post, Param, BadRequestException, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { redirectConfigSchema } from '../redirects/redirect.types';
import { FinanceModule } from '../finance/finance.controller';
import { PayablesService } from '../finance/payables.service';
import { FinanceService } from '../finance/finance.service';
import { ReportsModule } from '../reports/reports.controller';
import { ReportsService, SummaryRow } from '../reports/reports.service';
import { TasksModule, TasksService } from '../tasks/tasks.service';
import { DashboardWidgetsController } from './dashboard-widgets';
import { DashboardBoardController } from './dashboard-board';
import { VendorsModule } from '../vendors/vendors.controller';
import { DAY, iso, periods, periodSchema, seriesSchema } from './period';

function kpis(r: SummaryRow | undefined) {
  return { revenue: r?.revenue ?? 0, cost: r?.payout ?? 0, profit: r?.profit ?? 0, clicks: r?.clicks ?? 0, completes: r?.completes ?? 0, currencies: r?.currencies ?? [] };
}
function converted(cur: SummaryRow | undefined, prev: SummaryRow | undefined, base: string) {
  const m = (r: SummaryRow | undefined) => ({ revenue: r?.reporting.revenue ?? 0, cost: r?.reporting.payout ?? 0, profit: r?.reporting.profit ?? 0, missing: r?.reporting.missing ?? [] });
  const c = m(cur);
  const p = m(prev);
  return {
    currency: base,
    current: c,
    previous: p,
    trend: { revenue: trend(c.revenue, p.revenue), cost: trend(c.cost, p.cost), profit: trend(c.profit, p.profit) },
  };
}
/** Change in percent against the previous period; null when there is nothing to compare with. */
function trend(cur: number, prev: number) {
  return prev ? Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10 : null;
}
/** Bucket keys between two days, matching the report's day / week (Monday) / month labels. */
function buckets(from: string, to: string, interval: 'day' | 'week' | 'month') {
  const out: string[] = [];
  const end = Date.parse(to);
  let t = Date.parse(from);
  if (interval === 'week') t -= ((new Date(t).getUTCDay() + 6) % 7) * DAY;
  if (interval === 'month') t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), 1);
  while (t <= end && out.length < 800) {
    out.push(interval === 'month' ? iso(t).slice(0, 7) : iso(t));
    if (interval === 'day') t += DAY;
    else if (interval === 'week') t += 7 * DAY;
    else t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1);
  }
  return out;
}

const domain = z.string().regex(/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$|^localhost$/i, 'Use a hostname like example.com or *.example.com');
const readSchema = z
  .object({ items: z.array(z.object({ id: z.string().min(1).max(200), title: z.string().max(400) }).strict()).min(1).max(50) })
  .strict();

const orgSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  redirectAllowedDomains: z.array(domain).max(500).optional(),
  fallbackRedirectUrl: z.string().url().nullable().optional(),
  defaultRedirectConfig: redirectConfigSchema.nullable().optional(),
});
const approvalSchema = z.object({
  sessionIds: z.array(z.string()).min(1).max(5000),
  approval: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().max(500).optional(),
});

@Controller()
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly finance: FinanceService,
    private readonly payables: PayablesService,
    private readonly tasks: TasksService,
  ) {}

  /** PM dashboard numbers, computed from live (non-test) data only. */
  @Get('dashboard')
  async dashboard(@CurrentUser() u: AuthUser, @Query(new ZodPipe(periodSchema)) q: z.infer<typeof periodSchema>) {
    const org = u.organizationId;
    const per = periods(q);
    const [cur, prev, byVendor, byProject, byClient, finance] = await Promise.all([
      this.reports.summary(org, { from: per.from, to: per.to }, null),
      this.reports.summary(org, { from: per.prevFrom, to: per.prevTo }, null),
      this.reports.summary(org, { from: per.from, to: per.to }, 'vendor'),
      this.reports.summary(org, { from: per.from, to: per.to }, 'project'),
      this.reports.summary(org, { from: per.from, to: per.to }, 'client'),
      this.finance.financeTiles(org),
    ]);
    const [toBase, payables] = await Promise.all([this.payables.converter(org), this.payables.summary(org)]);
    const c = kpis(cur[0]);
    const p = kpis(prev[0]);
    const top = (rows: SummaryRow[]) =>
      rows
        .filter((r) => r.clicks > 0)
        .sort((a, b) => b.revenue - a.revenue || b.completes - a.completes)
        .slice(0, 5)
        .map((r) => ({ id: r.key, label: r.label, sublabel: r.sublabel, revenue: r.revenue, profit: r.profit, completes: r.completes, clicks: r.clicks, currencies: r.currencies }));
    const overview = await this.overview(org);
    return {
      ...overview,
      period: {
        from: per.from,
        to: per.to,
        previousFrom: per.prevFrom,
        previousTo: per.prevTo,
        current: c,
        previous: p,
        trend: {
          revenue: trend(c.revenue, p.revenue),
          cost: trend(c.cost, p.cost),
          profit: trend(c.profit, p.profit),
          clicks: trend(c.clicks, p.clicks),
          completes: trend(c.completes, p.completes),
        },
        /** The money KPIs in the reporting currency, so currencies are never mixed. */
        converted: converted(cur[0], prev[0], (await this.reports.rateTable(org)).base),
      },
      finance: Object.fromEntries(Object.entries(finance).map(([k, t]) => [k, { ...t, base: toBase(t.byCurrency) }])),
      payables: { unbilled: payables.totals.unbilled, due: payables.totals.due, paid: payables.totals.paid },
      top: { vendors: top(byVendor), projects: top(byProject), clients: top(byClient) },
    };
  }

  /** Revenue, payout and profit per day, week or month for the dashboard chart. Empty buckets are filled with zero. */
  @Get('dashboard/series')
  async series(@CurrentUser() u: AuthUser, @Query(new ZodPipe(periodSchema)) q: z.infer<typeof periodSchema>, @Query(new ZodPipe(seriesSchema)) s: z.infer<typeof seriesSchema>) {
    const per = periods(q);
    const rows = await this.reports.summary(u.organizationId, { from: per.from, to: per.to }, s.interval);
    const by = new Map(rows.map((r) => [r.key, r]));
    return {
      interval: s.interval,
      from: per.from,
      to: per.to,
      points: buckets(per.from, per.to, s.interval).map((k) => {
        const r = by.get(k);
        return { key: k, revenue: r?.revenue ?? 0, payout: r?.payout ?? 0, profit: r?.profit ?? 0, completes: r?.completes ?? 0, clicks: r?.clicks ?? 0 };
      }),
      currencies: [...new Set(rows.flatMap((r) => r.currencies))],
    };
  }

  /**
   * The simple overview at the top of the dashboard: project counts by status, clients and vendors, and clicks,
   * completes and money for today, yesterday, the last 7 days and this month (UTC days, test traffic excluded),
   * each compared with the window just before it. Money is in the reporting currency so currencies never mix.
   */
  @Get('dashboard/snapshot')
  async snapshot(@CurrentUser() u: AuthUser) {
    const org = u.organizationId;
    const now = Date.now();
    const today = iso(now);
    const y = new Date(now);
    const monthStart = iso(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), 1));
    const dayOfMonth = y.getUTCDate();
    const lastMonthStart = Date.UTC(y.getUTCFullYear(), y.getUTCMonth() - 1, 1);
    const lastMonthDays = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), 0)).getUTCDate();
    const windows = [
      { id: 'today', label: 'Today', from: today, to: today, prevFrom: iso(now - DAY), prevTo: iso(now - DAY), compare: 'vs yesterday' },
      { id: 'yesterday', label: 'Yesterday', from: iso(now - DAY), to: iso(now - DAY), prevFrom: iso(now - 2 * DAY), prevTo: iso(now - 2 * DAY), compare: 'vs the day before' },
      { id: 'week', label: 'Last 7 days', from: iso(now - 6 * DAY), to: today, prevFrom: iso(now - 13 * DAY), prevTo: iso(now - 7 * DAY), compare: 'vs the 7 days before' },
      {
        id: 'month', label: 'This month', from: monthStart, to: today,
        prevFrom: iso(lastMonthStart), prevTo: iso(lastMonthStart + (Math.min(dayOfMonth, lastMonthDays) - 1) * DAY), compare: 'vs the same days last month',
      },
    ] as const;
    const [clients, vendors, projects, rates, ...rows] = await Promise.all([
      this.prisma.client.groupBy({ by: ['status'], where: { organizationId: org }, _count: { _all: true } }),
      this.prisma.vendor.groupBy({ by: ['status'], where: { organizationId: org }, _count: { _all: true } }),
      this.prisma.project.groupBy({ by: ['status'], where: { organizationId: org }, _count: { _all: true } }),
      this.reports.rateTable(org),
      ...windows.flatMap((w) => [
        this.reports.summary(org, { from: w.from, to: w.to }, null),
        this.reports.summary(org, { from: w.prevFrom, to: w.prevTo }, null),
      ]),
    ]);
    const pick = (r: SummaryRow | undefined) => ({
      clicks: r?.clicks ?? 0,
      completes: r?.completes ?? 0,
      conversion: r?.clicks ? Math.round((r.completes / r.clicks) * 1000) / 10 : null,
      revenue: r?.reporting.revenue ?? 0,
      cost: r?.reporting.payout ?? 0,
      profit: r?.reporting.profit ?? 0,
      missing: r?.reporting.missing ?? [],
    });
    const byStatus = Object.fromEntries(projects.map((p) => [p.status, p._count._all])) as Record<string, number>;
    return {
      currency: rates.base,
      projects: {
        all: sum(projects),
        live: byStatus.LIVE ?? 0,
        test: byStatus.TEST ?? 0,
        hold: byStatus.HOLD ?? 0,
        closed: byStatus.CLOSED ?? 0,
        draft: byStatus.DRAFT ?? 0,
        invoiced: byStatus.INVOICED ?? 0,
      },
      clients: { total: sum(clients), active: count(clients, 'ACTIVE') },
      vendors: { total: sum(vendors), active: count(vendors, 'ACTIVE') },
      periods: windows.map((w, i) => {
        const cur = pick(rows[i * 2][0]);
        const prev = pick(rows[i * 2 + 1][0]);
        return {
          id: w.id, label: w.label, from: w.from, to: w.to, compare: w.compare,
          ...cur,
          trend: { clicks: trend(cur.clicks, prev.clicks), completes: trend(cur.completes, prev.completes), revenue: trend(cur.revenue, prev.revenue) },
        };
      }),
    };
  }

  /** All-time counts and fieldwork health. */
  private async overview(org: string) {
    const [clients, vendors, projectsByStatus, money, sessionsByStatus, recentRedirects, callbackStates] = await Promise.all([
      this.prisma.client.groupBy({ by: ['status'], where: { organizationId: org }, _count: { _all: true } }),
      this.prisma.vendor.groupBy({ by: ['status'], where: { organizationId: org }, _count: { _all: true } }),
      this.prisma.project.groupBy({ by: ['status'], where: { organizationId: org }, _count: { _all: true } }),
      this.prisma.respondentSession.aggregate({
        where: { organizationId: org, isTest: false, status: 'COMPLETE', approval: { not: 'REJECTED' } },
        _sum: { revenue: true, payout: true },
        _count: { _all: true },
      }),
      this.prisma.respondentSession.groupBy({ by: ['status'], where: { organizationId: org, isTest: false }, _count: { _all: true } }),
      this.prisma.redirectExecution.groupBy({
        by: ['usedFallback'],
        where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) }, session: { organizationId: org } },
        _count: { _all: true },
      }),
      this.prisma.callbackDelivery.groupBy({ by: ['state'], where: { organizationId: org }, _count: { _all: true } }),
    ]);
    const revenue = Number(money._sum.revenue ?? 0);
    const cost = Number(money._sum.payout ?? 0);
    const clicks = sessionsByStatus.reduce((a, s) => a + s._count._all, 0);
    const live = await this.prisma.project.findMany({
      where: { organizationId: org, status: 'LIVE' },
      select: { id: true, projectCode: true, workOrderNo: true, name: true, countries: { select: { targetCompletes: true, completes: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    return {
      clients: { total: sum(clients), active: count(clients, 'ACTIVE'), inactive: count(clients, 'INACTIVE') },
      vendors: { total: sum(vendors), active: count(vendors, 'ACTIVE'), inactive: count(vendors, 'INACTIVE') },
      projects: { total: sum(projectsByStatus), byStatus: Object.fromEntries(projectsByStatus.map((p) => [p.status, p._count._all])) },
      financials: { revenue, cost, profit: revenue - cost, currencyNote: 'Sums are in each country’s own currency. Finance tiles add a total in your reporting currency (Settings → Finance).' },
      clicks,
      completes: money._count._all,
      sessionsByStatus: Object.fromEntries(sessionsByStatus.map((s) => [s.status, s._count._all])),
      redirectHealth24h: {
        total: recentRedirects.reduce((a, r) => a + r._count._all, 0),
        fallbacks: recentRedirects.find((r) => r.usedFallback)?._count._all ?? 0,
      },
      callbacks: Object.fromEntries(callbackStates.map((c) => [c.state, c._count._all])),
      liveProjects: live.map((p) => ({
        id: p.id,
        projectCode: p.projectCode,
        workOrderNo: p.workOrderNo,
        name: p.name,
        target: p.countries.reduce((a, c) => a + c.targetCompletes, 0),
        completes: p.countries.reduce((a, c) => a + c.completes, 0),
      })),
    };
  }

  /**
   * Rules-based attention list for the insights panel and notification count.
   * Every item is computed from live data and links to where it can be acted on.
   */
  @Get('insights')
  async insights(@CurrentUser() u: AuthUser) {
    const org = u.organizationId;
    const day = new Date(Date.now() - 24 * 3600_000);
    const [pending, liveCountries, recentTraffic, callbacks, fallbacks, activity, wonBidsNew] = await Promise.all([
      this.prisma.respondentSession.groupBy({
        by: ['projectId'],
        where: { organizationId: org, isTest: false, status: 'COMPLETE', approval: 'PENDING' },
        _count: { _all: true },
        orderBy: { _count: { projectId: 'desc' } },
        take: 5,
      }),
      this.prisma.projectCountry.findMany({
        where: { status: 'LIVE', project: { organizationId: org, status: 'LIVE' } },
        select: { id: true, countryCode: true, completes: true, targetCompletes: true, project: { select: { id: true, projectCode: true, name: true } } },
      }),
      this.prisma.respondentSession.groupBy({
        by: ['projectCountryId'],
        where: { organizationId: org, isTest: false, startedAt: { gte: day } },
        _count: { _all: true },
      }),
      this.prisma.callbackDelivery.count({ where: { organizationId: org, state: { in: ['FAILED', 'DEAD_LETTER'] } } }),
      this.prisma.redirectExecution.count({ where: { usedFallback: true, createdAt: { gte: day }, session: { organizationId: org } } }),
      this.prisma.auditEvent.findMany({ where: { organizationId: org, action: { not: 'auth.sign_in' } }, orderBy: { createdAt: 'desc' }, take: 8 }),
      this.prisma.wonBid.count({ where: { organizationId: org, status: 'NEW' } }),
    ]);
    const [failedSchedules, apiFallbacks, openRequests, expiringDocs, applications, quoted] = await Promise.all([
      this.prisma.redirectPolicyVersion.findMany({
        where: { state: 'DRAFT', scheduleError: { not: null }, project: { organizationId: org } },
        select: { id: true, version: true, scheduleError: true, project: { select: { id: true, projectCode: true } } },
        take: 5,
      }),
      this.prisma.redirectExecution.count({ where: { apiFallback: true, createdAt: { gte: day }, session: { organizationId: org } } }),
      this.prisma.ticket.groupBy({ by: ['kind'], where: { organizationId: org, status: 'OPEN' }, _count: { _all: true } }),
      this.prisma.sharedFile.findMany({ where: { organizationId: org, kind: 'COMPLIANCE', expiresAt: { lte: new Date(Date.now() + 30 * 86_400_000) } }, select: { id: true, name: true, expiresAt: true, vendor: { select: { id: true, name: true } } }, orderBy: { expiresAt: 'asc' }, take: 5 }),
      this.prisma.vendorApplication.count({ where: { organizationId: org, status: 'PENDING' } }),
      this.prisma.quoteRequest.findMany({ where: { organizationId: org, status: 'QUOTED' }, select: { projectCountry: { select: { countryCode: true, project: { select: { id: true, projectCode: true } } } } }, take: 200 }),
    ]);
    const openAlerts = await this.prisma.alert.findMany({ where: { organizationId: org, state: 'OPEN', severity: { in: ['warn', 'bad'] } }, orderBy: { lastSeenAt: 'desc' }, take: 10 });
    const projects = await this.prisma.project.findMany({ where: { id: { in: pending.map((p) => p.projectId) }, organizationId: org }, select: { id: true, projectCode: true, name: true } });
    const actors = await this.prisma.user.findMany({ where: { id: { in: activity.map((a) => a.actorId).filter((x): x is string => !!x) }, organizationId: org }, select: { id: true, name: true } });
    const traffic = new Set(recentTraffic.map((t) => t.projectCountryId));

    type Item = { id: string; severity: 'info' | 'warn' | 'bad'; title: string; detail: string; href: string };
    const items: Item[] = [];
    for (const a of openAlerts) items.push({ id: `alert-${a.id}`, severity: a.severity as 'warn' | 'bad', title: a.title, detail: a.autoAction ? `Autopilot: ${a.autoAction}` : a.detail, href: '/monitor' });
    const alertRules = new Set(openAlerts.map((a) => a.rule));
    if (callbacks && !alertRules.has('callbacks_failed')) items.push({ id: 'callbacks', severity: 'bad', title: `${callbacks} vendor callback${callbacks === 1 ? '' : 's'} failed`, detail: 'Replay them from the project page once the vendor endpoint is fixed.', href: '/projects' });
    if (fallbacks) items.push({ id: 'fallbacks', severity: 'warn', title: `${fallbacks} redirect${fallbacks === 1 ? '' : 's'} used a fallback in 24h`, detail: 'A rule was missing or blocked by the security policy.', href: '/projects' });
    for (const f of failedSchedules) items.push({ id: `redirect-schedule-${f.id}`, severity: 'bad', title: `Scheduled redirect change on ${f.project.projectCode} did not go live`, detail: `Version ${f.version}: ${f.scheduleError}`, href: `/projects/${f.project.id}?tab=redirects` });
    const waiting = openRequests.reduce((n, g) => n + g._count._all, 0);
    const disputes = openRequests.find((g) => g.kind === 'DISPUTE')?._count._all ?? 0;
    if (waiting) items.push({ id: 'requests', severity: disputes ? 'warn' : 'info', title: `${waiting} client or vendor request${waiting === 1 ? '' : 's'} waiting for an answer`, detail: disputes ? `${disputes} ${disputes === 1 ? 'is a dispute' : 'are disputes'} of rejected completes.` : 'Answer them from Requests.', href: '/requests?status=OPEN' });
    if (applications) items.push({ id: 'vendor-applications', severity: 'info', title: `${applications} vendor application${applications === 1 ? '' : 's'} to review`, detail: 'Panel companies that signed up through your link.', href: '/vendors/applications' });
    const quotedBy = new Map<string, { id: string; code: string; n: number; markets: Set<string> }>();
    for (const q of quoted) {
      const p = q.projectCountry.project;
      const e = quotedBy.get(p.id) ?? { id: p.id, code: p.projectCode, n: 0, markets: new Set<string>() };
      e.n++;
      e.markets.add(q.projectCountry.countryCode);
      quotedBy.set(p.id, e);
    }
    for (const e of quotedBy.values()) items.push({ id: `quotes-${e.id}`, severity: 'info', title: `${e.n} vendor quote${e.n === 1 ? '' : 's'} to review on ${e.code}`, detail: `Markets: ${[...e.markets].join(', ')}.`, href: `/projects/${e.id}?tab=vendors` });
    for (const d of expiringDocs) {
      const gone = !!d.expiresAt && d.expiresAt.getTime() < Date.now();
      items.push({ id: `compliance-${d.id}`, severity: gone ? 'bad' : 'warn', title: `${d.vendor?.name ?? 'Vendor'}: ${d.name} ${gone ? 'expired' : 'expires soon'}`, detail: `Compliance document ${gone ? 'expired' : 'expires'} on ${d.expiresAt!.toISOString().slice(0, 10)}.`, href: d.vendor ? `/vendors/${d.vendor.id}` : '/vendors' });
    }
    if (apiFallbacks) items.push({ id: 'api-fallbacks', severity: 'warn', title: `${apiFallbacks} API destination${apiFallbacks === 1 ? '' : 's'} used the fallback URL in 24h`, detail: 'The endpoint did not answer in time or answered a URL that is not allowed.', href: '/projects' });
    // The monitor's alert already covers a market it has an open alert for.
    const alerted = new Set(openAlerts.map((a) => a.projectCountryId).filter(Boolean));
    for (const c of liveCountries) {
      if (alerted.has(c.id)) continue;
      const share = c.targetCompletes ? c.completes / c.targetCompletes : 0;
      if (share >= 0.9) {
        items.push({ id: `quota-${c.id}`, severity: share >= 1 ? 'info' : 'warn', title: `${c.project.projectCode} ${c.countryCode} at ${Math.round(share * 100)}% of target`, detail: share >= 1 ? 'Target reached; new entries are sent to quota full.' : 'Close to target; plan to close or raise the quota.', href: `/projects/${c.project.id}` });
      } else if (!traffic.has(c.id)) {
        items.push({ id: `idle-${c.id}`, severity: 'warn', title: `${c.project.projectCode} ${c.countryCode} has had no traffic for 24h`, detail: `${c.completes} of ${c.targetCompletes} completes so far.`, href: `/projects/${c.project.id}` });
      }
    }
    if (wonBidsNew) items.push({ id: 'won-bids', severity: 'info', title: `${wonBidsNew} won bid${wonBidsNew === 1 ? '' : 's'} waiting for project setup`, detail: 'Won in SampBidx; set up the project from the Won bids list.', href: '/won-bids' });
    for (const p of pending) {
      const proj = projects.find((x) => x.id === p.projectId);
      if (proj) items.push({ id: `approve-${proj.id}`, severity: 'info', title: `${p._count._all} complete${p._count._all === 1 ? '' : 's'} to review on ${proj.projectCode}`, detail: proj.name, href: `/projects/${proj.id}` });
    }
    // The person's own task reminders and overdue tasks.
    for (const t of await this.tasks.reminders(u)) items.push({ id: `task-${t.id}`, severity: t.overdue ? 'bad' : 'warn', title: t.overdue ? `Overdue: ${t.title}` : `Reminder: ${t.title}`, detail: [t.project?.projectCode, t.dueAt ? `due ${t.dueAt.toISOString().slice(0, 10)}` : null].filter(Boolean).join(' · ') || 'Task assigned to you', href: '/tasks' });
    const rank = { bad: 0, warn: 1, info: 2 } as const;
    items.sort((a, b) => rank[a.severity] - rank[b.severity]);
    // Read state is per person: an item is new until this person opens it, or again once its wording changes.
    const shown = items.slice(0, 20);
    const reads = await this.prisma.notificationRead.findMany({ where: { userId: u.id, key: { in: shown.map((i) => i.id) } }, select: { key: true, title: true } });
    const readTitle = new Map(reads.map((r) => [r.key, r.title]));
    const withRead = shown.map((i) => ({ ...i, read: readTitle.get(i.id) === i.title }));
    const unread = withRead.filter((i) => !i.read && i.severity !== 'info').length;
    return {
      items: withRead,
      /** Bell badge: alerts this person has not read yet. */
      alerts: unread,
      unread,
      /** Every alert (read or not), for screens that show the overall count. */
      alertsTotal: items.filter((i) => i.severity !== 'info').length,
      wonBidsNew,
      activity: activity.map((a) => ({ id: a.id, action: a.action, entityType: a.entityType, entityId: a.entityId, at: a.createdAt, actor: actors.find((x) => x.id === a.actorId)?.name ?? 'System' })),
    };
  }

  /**
   * Marks notifications read for the signed-in person (opening the bell, or the notifications screen
   * on the phone). The title is stored so a changed notification shows as new again.
   */
  @Post('insights/read')
  async markRead(@CurrentUser() u: AuthUser, @Body(new ZodPipe(readSchema)) body: z.infer<typeof readSchema>) {
    const now = new Date();
    await this.prisma.$transaction(
      body.items.map((i) =>
        this.prisma.notificationRead.upsert({
          where: { userId_key: { userId: u.id, key: i.id } },
          create: { organizationId: u.organizationId, userId: u.id, key: i.id, title: i.title, readAt: now },
          update: { title: i.title, readAt: now },
        }),
      ),
    );
    // Keep the table small: reads older than 60 days are for notifications long gone.
    await this.prisma.notificationRead.deleteMany({ where: { userId: u.id, readAt: { lt: new Date(now.getTime() - 60 * 86_400_000) } } });
    return { marked: body.items.length };
  }

  @Get('organization')
  async org(@CurrentUser() u: AuthUser) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: u.organizationId },
      select: { id: true, name: true, slug: true, redirectAllowedDomains: true, fallbackRedirectUrl: true, defaultRedirectConfig: true },
    });
  }

  @Patch('organization')
  @Roles('ADMIN')
  async updateOrg(@CurrentUser() u: AuthUser, @Body(new ZodPipe(orgSchema)) body: z.infer<typeof orgSchema>) {
    const { defaultRedirectConfig, ...rest } = body;
    await this.prisma.organization.update({
      where: { id: u.organizationId },
      data: {
        ...rest,
        ...(defaultRedirectConfig !== undefined
          ? { defaultRedirectConfig: defaultRedirectConfig === null ? Prisma.DbNull : (defaultRedirectConfig as unknown as Prisma.InputJsonValue) }
          : {}),
      },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'organization.update', entityType: 'Organization', entityId: u.organizationId, detail: body });
    return this.org(u);
  }

  /** Reconciliation: approve or reject completes. Only approved completes are billable. */
  @Post('projects/:projectId/sessions/approval')
  @Roles(...EDITORS)
  async approve(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @Body(new ZodPipe(approvalSchema)) body: z.infer<typeof approvalSchema>) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organizationId: u.organizationId } });
    if (!project) throw new BadRequestException('Project not found');
    const r = await this.prisma.respondentSession.updateMany({
      // Invoiced completes are locked until their invoice is voided.
      where: { id: { in: body.sessionIds }, projectId, status: 'COMPLETE', isTest: false, invoiceId: null },
      data: { approval: body.approval, approvalAt: new Date() },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: `sessions.${body.approval.toLowerCase()}`, entityType: 'Project', entityId: projectId, detail: { count: r.count, reason: body.reason } });
    return { updated: r.count, skipped: body.sessionIds.length - r.count };
  }
}

function sum(rows: { _count: { _all: number } }[]) {
  return rows.reduce((a, r) => a + r._count._all, 0);
}
function count(rows: { status: string; _count: { _all: number } }[], s: string) {
  return rows.find((r) => r.status === s)?._count._all ?? 0;
}

@Module({ imports: [ReportsModule, FinanceModule, TasksModule, VendorsModule], controllers: [DashboardWidgetsController, DashboardBoardController, DashboardController] })
export class DashboardModule {}
