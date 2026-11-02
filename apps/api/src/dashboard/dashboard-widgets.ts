/**
 * Command center widgets (docs/DASHBOARD_WIDGETS.md): each person's own layout (order, size,
 * visibility) and the data behind the newer widgets: markets map, traffic heatmap and the
 * revenue-to-profit waterfall. Money in the new widgets is converted into the reporting
 * currency with the manual exchange rates, like the reports.
 */
import { BadRequestException, Body, Controller, Delete, Get, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { RateTable, ReportsService } from '../reports/reports.service';
import { periods, periodSchema } from './period';

export const WIDGETS = ['kpis', 'trend', 'waterfall', 'map', 'finance', 'payables', 'top-vendors', 'top-projects', 'top-clients', 'live-projects', 'health', 'heatmap', 'workspace'] as const;
export type WidgetId = (typeof WIDGETS)[number];
export const SIZES = ['third', 'half', 'two-thirds', 'full'] as const;

/** The layout everyone starts with, and gets back with "Reset". */
export const DEFAULT_LAYOUT: { id: WidgetId; size: (typeof SIZES)[number]; hidden: boolean }[] = [
  { id: 'kpis', size: 'full', hidden: false },
  { id: 'trend', size: 'full', hidden: false },
  { id: 'map', size: 'two-thirds', hidden: false },
  { id: 'waterfall', size: 'third', hidden: false },
  { id: 'finance', size: 'full', hidden: false },
  { id: 'payables', size: 'full', hidden: false },
  { id: 'top-vendors', size: 'third', hidden: false },
  { id: 'top-projects', size: 'third', hidden: false },
  { id: 'top-clients', size: 'third', hidden: false },
  { id: 'live-projects', size: 'two-thirds', hidden: false },
  { id: 'health', size: 'third', hidden: false },
  { id: 'heatmap', size: 'two-thirds', hidden: false },
  { id: 'workspace', size: 'third', hidden: false },
];

const layoutSchema = z.object({
  widgets: z
    .array(z.object({ id: z.enum(WIDGETS), size: z.enum(SIZES), hidden: z.boolean().default(false) }).strict())
    .min(1)
    .max(WIDGETS.length)
    .refine((w) => new Set(w.map((x) => x.id)).size === w.length, { message: 'Each widget can appear once' }),
});
type Layout = z.infer<typeof layoutSchema>['widgets'];

/** A saved layout plus any widgets added since it was saved (appended, visible, at their default size). */
export function withNewWidgets(saved: Layout): Layout {
  const have = new Set(saved.map((w) => w.id));
  return [...saved, ...DEFAULT_LAYOUT.filter((w) => !have.has(w.id))];
}

const tzSchema = z.object({
  tz: z
    .string()
    .max(64)
    .default('UTC')
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown time zone'),
});

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Converts per-currency amounts; currencies without a rate are left out and listed. */
function convert(rows: { currency: string; amount: number }[], t: RateTable) {
  let amount = 0;
  const missing = new Set<string>();
  for (const r of rows) {
    const rate = r.currency === t.base ? 1 : t.rates.get(r.currency);
    if (rate == null) {
      if (r.amount) missing.add(r.currency);
    } else amount += r.amount * rate;
  }
  return { amount: r2(amount), missing: [...missing] };
}

@Controller('dashboard')
export class DashboardWidgetsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
  ) {}

  @Get('layout')
  async layout(@CurrentUser() u: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { dashboardLayout: true } });
    const parsed = layoutSchema.safeParse({ widgets: user.dashboardLayout });
    // A layout from an older version that no longer validates falls back to the default.
    return { custom: parsed.success, widgets: parsed.success ? withNewWidgets(parsed.data.widgets) : DEFAULT_LAYOUT, available: WIDGETS };
  }

  @Put('layout')
  async save(@CurrentUser() u: AuthUser, @Body(new ZodPipe(layoutSchema)) b: z.infer<typeof layoutSchema>) {
    if (b.widgets.every((w) => w.hidden)) throw new BadRequestException('Keep at least one widget visible');
    await this.prisma.user.update({ where: { id: u.id }, data: { dashboardLayout: b.widgets as unknown as Prisma.InputJsonValue } });
    return { custom: true, widgets: withNewWidgets(b.widgets), available: WIDGETS };
  }

  @Delete('layout')
  async reset(@CurrentUser() u: AuthUser) {
    await this.prisma.user.update({ where: { id: u.id }, data: { dashboardLayout: Prisma.DbNull } });
    return { custom: false, widgets: DEFAULT_LAYOUT, available: WIDGETS };
  }

  /** Per market (country): traffic, conversion and converted money, plus how many markets are live now. */
  @Get('markets')
  async markets(@CurrentUser() u: AuthUser, @Query(new ZodPipe(periodSchema)) q: z.infer<typeof periodSchema>) {
    const org = u.organizationId;
    const per = periods(q);
    const [rows, live, fx] = await Promise.all([
      this.reports.summary(org, { from: per.from, to: per.to }, 'country'),
      this.prisma.projectCountry.groupBy({ by: ['countryCode'], where: { status: 'LIVE', project: { organizationId: org, status: 'LIVE' } }, _count: { _all: true } }),
      this.reports.fxInfo(org),
    ]);
    const liveBy = new Map(live.map((l) => [l.countryCode, l._count._all]));
    const codes = new Set([...rows.map((r) => r.key), ...liveBy.keys()]);
    const byCode = new Map(rows.map((r) => [r.key, r]));
    const markets = [...codes]
      .map((code) => {
        const r = byCode.get(code);
        return {
          countryCode: code,
          clicks: r?.clicks ?? 0,
          completes: r?.completes ?? 0,
          conversion: r?.conversion ?? 0,
          revenue: r?.reporting.revenue ?? 0,
          profit: r?.reporting.profit ?? 0,
          margin: r?.reporting.margin ?? null,
          missing: r?.reporting.missing ?? [],
          liveMarkets: liveBy.get(code) ?? 0,
        };
      })
      .sort((a, b) => b.completes - a.completes || b.clicks - a.clicks || a.countryCode.localeCompare(b.countryCode));
    return { from: per.from, to: per.to, currency: fx.currency, markets };
  }

  /** Respondent entries and completes by weekday (0 = Monday) and hour, in the viewer's time zone. */
  @Get('heatmap')
  async heatmap(@CurrentUser() u: AuthUser, @Query(new ZodPipe(periodSchema)) q: z.infer<typeof periodSchema>, @Query(new ZodPipe(tzSchema)) t: z.infer<typeof tzSchema>) {
    const per = periods(q);
    const gte = new Date(`${per.from}T00:00:00.000Z`);
    const lt = new Date(Date.parse(`${per.to}T00:00:00.000Z`) + 86_400_000);
    const rows = await this.prisma.$queryRaw<{ dow: number; hour: number; entries: number; completes: number }[]>`
      SELECT (EXTRACT(ISODOW FROM local)::int - 1) AS dow, EXTRACT(HOUR FROM local)::int AS hour,
        COUNT(*)::int AS entries, COUNT(*) FILTER (WHERE status = 'COMPLETE')::int AS completes
      FROM (
        SELECT (s."startedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${t.tz} AS local, s.status
        FROM "RespondentSession" s
        WHERE s."organizationId" = ${u.organizationId} AND s."isTest" = false AND s."startedAt" >= ${gte} AND s."startedAt" < ${lt}
      ) x
      GROUP BY 1, 2`;
    const entries = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    const completes = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    for (const r of rows) {
      entries[r.dow][r.hour] = Number(r.entries);
      completes[r.dow][r.hour] = Number(r.completes);
    }
    const max = Math.max(0, ...entries.flat());
    return { from: per.from, to: per.to, tz: t.tz, entries, completes, max, total: entries.flat().reduce((a, b) => a + b, 0) };
  }

  /**
   * From the value of every complete to profit, in the reporting currency: completes value,
   * minus rejected completes, gives revenue; minus vendor payout gives profit. Pending
   * completes are part of revenue and shown separately as "still to approve".
   */
  @Get('waterfall')
  async waterfall(@CurrentUser() u: AuthUser, @Query(new ZodPipe(periodSchema)) q: z.infer<typeof periodSchema>) {
    const org = u.organizationId;
    const per = periods(q);
    const gte = new Date(`${per.from}T00:00:00.000Z`);
    const lt = new Date(Date.parse(`${per.to}T00:00:00.000Z`) + 86_400_000);
    const [rows, t] = await Promise.all([
      this.prisma.$queryRaw<{ currency: string; gross: number; rejected: number; pending: number; payout: number }[]>`
        SELECT pc.currency,
          COALESCE(SUM(s.revenue), 0)::float8 AS gross,
          COALESCE(SUM(s.revenue) FILTER (WHERE s.approval = 'REJECTED'), 0)::float8 AS rejected,
          COALESCE(SUM(s.revenue) FILTER (WHERE s.approval = 'PENDING'), 0)::float8 AS pending,
          COALESCE(SUM(s.payout) FILTER (WHERE s.approval <> 'REJECTED'), 0)::float8 AS payout
        FROM "RespondentSession" s
        JOIN "ProjectCountry" pc ON pc.id = s."projectCountryId"
        WHERE s."organizationId" = ${org} AND s."isTest" = false AND s.status = 'COMPLETE'
          AND s."startedAt" >= ${gte} AND s."startedAt" < ${lt}
        GROUP BY 1`,
      this.reports.rateTable(org),
    ]);
    const pick = (k: 'gross' | 'rejected' | 'pending' | 'payout') => convert(rows.map((r) => ({ currency: r.currency, amount: Number(r[k]) })), t);
    const gross = pick('gross');
    const rejected = pick('rejected');
    const pending = pick('pending');
    const payout = pick('payout');
    const revenue = r2(gross.amount - rejected.amount);
    const profit = r2(revenue - payout.amount);
    const missing = [...new Set([...gross.missing, ...payout.missing])].sort();
    return {
      from: per.from,
      to: per.to,
      currency: t.base,
      steps: [
        { key: 'gross', label: 'Completes value', value: gross.amount, kind: 'start' },
        { key: 'rejected', label: 'Rejected', value: -rejected.amount, kind: 'change' },
        { key: 'revenue', label: 'Revenue', value: revenue, kind: 'subtotal' },
        { key: 'payout', label: 'Vendor payout', value: -payout.amount, kind: 'change' },
        { key: 'profit', label: 'Profit', value: profit, kind: 'total' },
      ],
      pending: pending.amount,
      margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
      missing,
    };
  }
}
