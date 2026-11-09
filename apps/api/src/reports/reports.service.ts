/**
 * Fieldwork reports (spec module 14, the five reports of the legacy Fieldwork platform):
 * overall, conversion (respondent level), client, vendor and clicks (event level).
 *
 * Rules shared by every report:
 * - Scoped to the caller's organization; test sessions (test links, QA studio) never count.
 * - "Clicks" are respondent sessions (one per vendor UID entry).
 * - Revenue and payout count completes that are not rejected; rejected completes are
 *   reported separately so reconciliation is visible.
 * - Money is summed in each market's own currency (`money`), and also converted into the
 *   organisation's reporting currency with the manual exchange rates (`reporting`). Amounts in
 *   a currency without a rate are left out of the converted figures and listed in `missing`.
 * - Dates are UTC calendar days; `to` is inclusive.
 */
import { Injectable } from '@nestjs/common';
import { SPEEDER_DETAIL, SURVEY_START } from '../projects/field-metrics';
import { aggregate, countIf, mdate, msBetween, numOut, percentileCont } from '../prisma/agg';
import { Prisma, RespondentStatus } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const id = z.string().min(1).max(64);

export const filterSchema = z
  .object({
    from: day.optional(),
    to: day.optional(),
    clientId: id.optional(),
    vendorId: id.optional(),
    projectId: id.optional(),
    countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, { message: '`from` must be on or before `to`', path: ['from'] });
export type ReportFilter = z.infer<typeof filterSchema>;

export const GROUPS = ['client', 'vendor', 'project', 'country', 'day', 'week', 'month', 'vendor_country'] as const;
export type GroupBy = (typeof GROUPS)[number];

const STATUSES = Object.values(RespondentStatus);
export const listSchema = z.object({
  status: z.enum(STATUSES as [RespondentStatus, ...RespondentStatus[]]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  /** Export mode: one response with up to EXPORT_LIMIT rows, for CSV download. */
  export: z.enum(['1', 'true']).optional(),
});
export const EXPORT_LIMIT = 50_000;

export interface SummaryRow {
  key: string;
  label: string;
  sublabel: string | null;
  clicks: number;
  completes: number;
  terminates: number;
  quotaFull: number;
  qualityFail: number;
  partial: number;
  inProgress: number;
  approved: number;
  pending: number;
  rejected: number;
  revenue: number;
  payout: number;
  profit: number;
  /** Profit as a share of revenue, in percent; null without revenue or when the row mixes currencies. */
  margin: number | null;
  /** Completes / clicks, in percent. */
  conversion: number;
  /** Median minutes from entry to complete; null without completes. */
  medianLoiMinutes: number | null;
  /** LOI: mean minutes from survey start (after the gate) to complete; null without completes. */
  loiMinutes: number | null;
  /** IR: completes ÷ (completes + terminates), in percent; null when nobody qualified or screened out. */
  ir: number | null;
  /** Completes turned into quality fails by the speeder check (not counted in qualityFail). */
  speeders: number;
  currencies: string[];
  /** Revenue, payout and profit per currency (the honest view while sums mix currencies). */
  money: { currency: string; revenue: number; payout: number; profit: number }[];
  /** The same money converted into the reporting currency with today's manual rates. */
  reporting: ReportingMoney;
}

export interface ReportingMoney {
  currency: string;
  revenue: number;
  payout: number;
  profit: number;
  /** Profit as a share of converted revenue, in percent; null without converted revenue. */
  margin: number | null;
  /** Currencies in this row that have money but no exchange rate (left out of the figures above). */
  missing: string[];
}

/** Rates into the reporting currency: 1 unit of `currency` = `rate` units of `base`. */
export interface RateTable {
  base: string;
  rates: Map<string, number>;
  /** When the newest rate was saved; null when only the reporting currency is used. */
  updatedAt: Date | null;
}

/** Converts per-currency money into the reporting currency. Pure, so it is easy to test. */
export function convertMoney(money: SummaryRow['money'], t: RateTable): ReportingMoney {
  let revenue = 0;
  let payout = 0;
  const missing = new Set<string>();
  for (const m of money) {
    const rate = m.currency === t.base ? 1 : t.rates.get(m.currency);
    if (rate == null) {
      if (m.revenue || m.payout) missing.add(m.currency);
      continue;
    }
    revenue += m.revenue * rate;
    payout += m.payout * rate;
  }
  revenue = round(revenue, 2);
  payout = round(payout, 2);
  return { currency: t.base, revenue, payout, profit: round(revenue - payout, 2), margin: revenue > 0 ? pct(revenue - payout, revenue) : null, missing: [...missing].sort() };
}

/** The related rows a session group is labelled with (the joins of the SQL version). */
interface Joined {
  project: { id: string; projectCode: string; name: string; client: { id: string; name: string; code: string } };
  country: { countryCode: string; currency: string };
  vendor: { id: string; name: string; code: string };
}

/** Key, label and sublabel of a session group for each grouping. */
const KEY: Record<GroupBy, (j: Joined, bucket: string) => [string, string, string | null]> = {
  client: (j) => [j.project.client.id, j.project.client.name, j.project.client.code],
  vendor: (j) => [j.vendor.id, j.vendor.name, j.vendor.code],
  project: (j) => [j.project.id, j.project.projectCode, j.project.name],
  country: (j) => [j.country.countryCode, j.country.countryCode, null],
  day: (_j, b) => [b, b, null],
  week: (_j, b) => [b, b, null],
  month: (_j, b) => [b, b, null],
  vendor_country: (j) => [`${j.vendor.id}:${j.country.countryCode}`, j.vendor.name, j.country.countryCode],
};

/** The UTC calendar bucket of `startedAt` for the time groupings (weeks start on Monday). */
function bucketExpr(groupBy: GroupBy | null): unknown {
  if (groupBy === 'day') return { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone: 'UTC' } };
  if (groupBy === 'month') return { $dateToString: { format: '%Y-%m', date: '$startedAt', timezone: 'UTC' } };
  if (groupBy === 'week') return { $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: '$startedAt', unit: 'week', startOfWeek: 'monday', timezone: 'UTC' } }, timezone: 'UTC' } };
  return '';
}

type Partial0 = {
  _id: { p: string; c: string; a: string; b: string };
  clicks: number; completes: number; terminates: number; quotaFull: number; qualityFail: number; speeders: number; partial: number; inProgress: number;
  approved: number; pending: number; rejected: number; revenue: number; payout: number; billableN: number; loiSum: number; loiN: number; lois: number[];
};

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (a: number, b: number) => (b > 0 ? round((a / b) * 100) : 0);

/** UTC day bounds: [from 00:00, to+1 00:00). */
export function dayRange(f: Pick<ReportFilter, 'from' | 'to'>) {
  const gte = f.from ? new Date(`${f.from}T00:00:00.000Z`) : undefined;
  const lt = f.to ? new Date(new Date(`${f.to}T00:00:00.000Z`).getTime() + 86_400_000) : undefined;
  return { gte, lt };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Human labels for the filters, for PDF and email headings. Only this organisation's records. */
  async labels(org: string, f: { clientId?: string; vendorId?: string; projectId?: string; countryCode?: string }) {
    const [c, v, p] = await Promise.all([
      f.clientId ? this.prisma.client.findFirst({ where: { id: f.clientId, organizationId: org }, select: { name: true } }) : null,
      f.vendorId ? this.prisma.vendor.findFirst({ where: { id: f.vendorId, organizationId: org }, select: { name: true } }) : null,
      f.projectId ? this.prisma.project.findFirst({ where: { id: f.projectId, organizationId: org }, select: { projectCode: true } }) : null,
    ]);
    return [c && `Client ${c.name}`, v && `Vendor ${v.name}`, p && `Project ${p.projectCode}`, f.countryCode && `Market ${f.countryCode}`].filter(Boolean) as string[];
  }

  /**
   * The $match for a report: the filters on related rows (client, vendor, market) become the ids of
   * this organisation's projects, vendor links and markets. Null when a filter matches nothing.
   */
  private async match(org: string, f: ReportFilter): Promise<Record<string, unknown> | null> {
    const { gte, lt } = dayRange(f);
    const m: Record<string, unknown> = { organizationId: org, isTest: false };
    if (gte || lt) m.startedAt = { ...(gte ? { $gte: mdate(gte) } : {}), ...(lt ? { $lt: mdate(lt) } : {}) };
    if (f.clientId || f.projectId) {
      const ps = await this.prisma.project.findMany({ where: { organizationId: org, ...(f.clientId ? { clientId: f.clientId } : {}), ...(f.projectId ? { id: f.projectId } : {}) }, select: { id: true } });
      if (!ps.length) return null;
      m.projectId = { $in: ps.map((p) => p.id) };
    }
    if (f.vendorId) {
      const as = await this.prisma.vendorAllocation.findMany({ where: { vendorId: f.vendorId, projectCountry: { project: { organizationId: org } } }, select: { id: true } });
      if (!as.length) return null;
      m.vendorAllocationId = { $in: as.map((a) => a.id) };
    }
    if (f.countryCode) {
      const cs = await this.prisma.projectCountry.findMany({ where: { countryCode: f.countryCode, project: { organizationId: org } }, select: { id: true } });
      if (!cs.length) return null;
      m.projectCountryId = { $in: cs.map((c) => c.id) };
    }
    return m;
  }

  /** Sessions grouped by project, market, vendor link and (for time groupings) calendar bucket. */
  private async partials(org: string, f: ReportFilter, groupBy: GroupBy | null) {
    const m = await this.match(org, f);
    if (!m) return [];
    const st = (x: string) => ({ $eq: ['$status', x] });
    const complete = st('COMPLETE');
    const billable = { $and: [complete, { $ne: ['$approval', 'REJECTED'] }] };
    const hasOutcome = { $ne: [{ $ifNull: ['$outcomeAt', null] }, null] };
    return aggregate<Partial0>(this.prisma.respondentSession, [
      { $match: m },
      {
        $group: {
          _id: { p: '$projectId', c: '$projectCountryId', a: '$vendorAllocationId', b: bucketExpr(groupBy) },
          clicks: { $sum: 1 },
          completes: countIf(complete),
          terminates: countIf(st('TERMINATE')),
          quotaFull: countIf(st('QUOTA_FULL')),
          qualityFail: countIf({ $and: [{ $in: ['$status', ['QUALITY_FAIL', 'DUPLICATE', 'SECURITY_REJECT']] }, { $ne: ['$statusDetail', SPEEDER_DETAIL] }] }),
          speeders: countIf({ $and: [st('QUALITY_FAIL'), { $eq: ['$statusDetail', SPEEDER_DETAIL] }] }),
          partial: countIf({ $in: ['$status', ['PARTIAL', 'TECHNICAL_ERROR']] }),
          inProgress: countIf(st('STARTED')),
          approved: countIf({ $and: [complete, { $eq: ['$approval', 'APPROVED'] }] }),
          pending: countIf({ $and: [complete, { $eq: ['$approval', 'PENDING'] }] }),
          rejected: countIf({ $and: [complete, { $eq: ['$approval', 'REJECTED'] }] }),
          revenue: { $sum: { $cond: [billable, { $ifNull: ['$revenue', 0] }, 0] } },
          payout: { $sum: { $cond: [billable, { $ifNull: ['$payout', 0] }, 0] } },
          billableN: countIf(billable),
          // Mean LOI from survey start, as a sum and a count so groups can be merged.
          loiSum: { $sum: { $cond: [{ $and: [complete, hasOutcome] }, { $ifNull: [msBetween(SURVEY_START, '$outcomeAt'), 0] }, 0] } },
          loiN: countIf({ $and: [complete, hasOutcome] }),
          // LOI from entry of every complete, for the median.
          lois: { $push: { $cond: [{ $and: [complete, hasOutcome] }, msBetween('$startedAt', '$outcomeAt'), '$$REMOVE'] } },
        },
      },
    ]);
  }

  /** The related rows of the groups; groups whose project, market or vendor link is gone are left out. */
  private async joined(parts: Partial0[]) {
    const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
    const [projects, countries, allocs] = await Promise.all([
      this.prisma.project.findMany({ where: { id: { in: uniq(parts.map((p) => p._id.p)) } }, select: { id: true, projectCode: true, name: true, client: { select: { id: true, name: true, code: true } } } }),
      this.prisma.projectCountry.findMany({ where: { id: { in: uniq(parts.map((p) => p._id.c)) } }, select: { id: true, countryCode: true, currency: true } }),
      this.prisma.vendorAllocation.findMany({ where: { id: { in: uniq(parts.map((p) => p._id.a)) } }, select: { id: true, vendor: { select: { id: true, name: true, code: true } } } }),
    ]);
    const P = new Map(projects.map((p) => [p.id, p]));
    const C = new Map(countries.map((c) => [c.id, c]));
    const A = new Map(allocs.map((a) => [a.id, a]));
    const out: { part: Partial0; j: Joined }[] = [];
    for (const part of parts) {
      const project = P.get(part._id.p);
      const country = C.get(part._id.c);
      const vendor = A.get(part._id.a)?.vendor;
      if (!project?.client || !country || !vendor) continue;
      out.push({ part, j: { project: project as Joined['project'], country, vendor } });
    }
    return out;
  }

  /** The organisation's reporting currency and manual exchange rates. */
  async rateTable(org: string): Promise<RateTable> {
    const [o, rates] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { baseCurrency: true } }),
      this.prisma.exchangeRate.findMany({ where: { organizationId: org } }),
    ]);
    const updated = rates.reduce<Date | null>((d, r) => (!d || r.updatedAt > d ? r.updatedAt : d), null);
    return { base: o.baseCurrency, rates: new Map(rates.map((r) => [r.currency, Number(r.rate)])), updatedAt: updated };
  }

  /** What the screen needs to explain converted figures. */
  async fxInfo(org: string) {
    const t = await this.rateTable(org);
    return { currency: t.base, rates: [...t.rates].map(([currency, rate]) => ({ currency, rate })).sort((a, b) => a.currency.localeCompare(b.currency)), updatedAt: t.updatedAt };
  }

  /** Aggregated metrics, grouped by one dimension, or a single total row when groupBy is null. */
  async summary(org: string, f: ReportFilter, groupBy: GroupBy | null): Promise<SummaryRow[]> {
    const keyOf = groupBy ? KEY[groupBy] : (): [string, string, string | null] => ['total', 'Total', null];
    const COUNTS = ['clicks', 'completes', 'terminates', 'quotaFull', 'qualityFail', 'speeders', 'partial', 'inProgress', 'approved', 'pending', 'rejected', 'revenue', 'payout', 'loiSum', 'loiN'] as const;
    type Acc = Record<(typeof COUNTS)[number], number> & { key: string; label: string; sublabel: string | null; lois: number[]; currencies: Set<string> };
    const acc = new Map<string, Acc>();
    const moneyBy = new Map<string, { key: string; currency: string; revenue: number; payout: number; n: number }>();
    for (const { part, j } of await this.joined(await this.partials(org, f, groupBy))) {
      const [key, label, sublabel] = keyOf(j, part._id.b);
      let a = acc.get(key);
      if (!a) {
        a = { key, label, sublabel, lois: [], currencies: new Set(), ...(Object.fromEntries(COUNTS.map((c) => [c, 0])) as Record<(typeof COUNTS)[number], number>) };
        acc.set(key, a);
      }
      for (const c of COUNTS) a[c] += numOut(part[c]);
      for (const l of part.lois ?? []) a.lois.push(numOut(l));
      a.currencies.add(j.country.currency);
      const mk = `${key}\u0000${j.country.currency}`;
      const mm = moneyBy.get(mk) ?? { key, currency: j.country.currency, revenue: 0, payout: 0, n: 0 };
      mm.revenue += numOut(part.revenue);
      mm.payout += numOut(part.payout);
      mm.n += numOut(part.billableN);
      moneyBy.set(mk, mm);
    }
    const timeGroup = groupBy === 'day' || groupBy === 'week' || groupBy === 'month';
    const rows: Record<string, unknown>[] = [...acc.values()]
      .sort((x, y) => (timeGroup ? (x.key < y.key ? -1 : x.key > y.key ? 1 : 0) : y.clicks - x.clicks || x.label.localeCompare(y.label)))
      .map((a) => {
        const median = percentileCont(a.lois, 0.5);
        return { ...a, loiSeconds: median == null ? null : median / 1000, avgLoiSeconds: a.loiN ? a.loiSum / a.loiN / 1000 : null, currencies: [...a.currencies] };
      });
    // Money of billable completes only: a currency without any is left out of the row.
    const moneyRows = [...moneyBy.values()].filter((m) => m.n > 0).sort((x, y) => x.currency.localeCompare(y.currency));
    const fx = await this.rateTable(org);
    const money = new Map<string, SummaryRow['money']>();
    for (const m of moneyRows) {
      const revenue = round(Number(m.revenue), 2);
      const payout = round(Number(m.payout), 2);
      const list = money.get(String(m.key)) ?? [];
      list.push({ currency: m.currency, revenue, payout, profit: round(revenue - payout, 2) });
      money.set(String(m.key), list);
    }
    return rows.map((r) => {
      const revenue = round(Number(r.revenue), 2);
      const payout = round(Number(r.payout), 2);
      const clicks = Number(r.clicks);
      const completes = Number(r.completes);
      return {
        key: String(r.key),
        label: String(r.label),
        sublabel: (r.sublabel as string | null) ?? null,
        clicks,
        completes,
        terminates: Number(r.terminates),
        quotaFull: Number(r.quotaFull),
        qualityFail: Number(r.qualityFail),
        partial: Number(r.partial),
        inProgress: Number(r.inProgress),
        approved: Number(r.approved),
        pending: Number(r.pending),
        rejected: Number(r.rejected),
        revenue,
        payout,
        profit: round(revenue - payout, 2),
        // A margin across currencies would mix units, so it is only given for single-currency rows.
        margin: revenue > 0 && (money.get(String(r.key))?.length ?? 0) === 1 ? pct(revenue - payout, revenue) : null,
        conversion: pct(completes, clicks),
        medianLoiMinutes: r.loiSeconds == null ? null : round(Number(r.loiSeconds) / 60),
        loiMinutes: r.avgLoiSeconds == null ? null : round(Number(r.avgLoiSeconds) / 60),
        ir: completes + Number(r.terminates) > 0 ? pct(completes, completes + Number(r.terminates)) : null,
        speeders: Number(r.speeders),
        currencies: ((r.currencies as string[] | null) ?? []).filter(Boolean).sort(),
        money: money.get(String(r.key)) ?? [],
        reporting: convertMoney(money.get(String(r.key)) ?? [], fx),
      };
    });
  }

  /** Overall report: totals, outcome mix, a daily trend and the top five clients, vendors and projects. */
  async overall(org: string, f: ReportFilter) {
    const [total, byDay, clients, vendors, projects, fx] = await Promise.all([
      this.summary(org, f, null),
      this.summary(org, f, 'day'),
      this.summary(org, f, 'client'),
      this.summary(org, f, 'vendor'),
      this.summary(org, f, 'project'),
      this.fxInfo(org),
    ]);
    const top = (rows: SummaryRow[]) => [...rows].sort((a, b) => b.completes - a.completes || b.clicks - a.clicks).slice(0, 5);
    return {
      totals: total[0] ?? emptyRow(fx.currency),
      byDay: fillDays(byDay, f, fx.currency),
      topClients: top(clients),
      topVendors: top(vendors),
      topProjects: top(projects),
      counts: { clients: clients.length, vendors: vendors.length, projects: projects.length },
      currencyNote: CURRENCY_NOTE,
      fx,
    };
  }

  private sessionWhere(org: string, f: ReportFilter, status?: RespondentStatus): Prisma.RespondentSessionWhereInput {
    const { gte, lt } = dayRange(f);
    return {
      organizationId: org,
      isTest: false,
      ...(gte || lt ? { startedAt: { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } } : {}),
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(f.clientId ? { project: { clientId: f.clientId } } : {}),
      ...(f.vendorId ? { vendorAllocation: { vendorId: f.vendorId } } : {}),
      ...(f.countryCode ? { projectCountry: { countryCode: f.countryCode } } : {}),
      ...(status ? { status } : {}),
    };
  }

  /** Conversion report: one row per respondent session, newest first. */
  async conversion(org: string, f: ReportFilter, l: z.infer<typeof listSchema>) {
    const where = this.sessionWhere(org, f, l.status);
    const take = l.export ? EXPORT_LIMIT : l.pageSize;
    const skip = l.export ? 0 : (l.page - 1) * l.pageSize;
    const [total, rows] = await Promise.all([
      this.prisma.respondentSession.count({ where }),
      this.prisma.respondentSession.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take,
        skip,
        select: {
          id: true,
          token: true,
          vendorRespondentId: true,
          status: true,
          statusDetail: true,
          approval: true,
          outcomeVerified: true,
          revenue: true,
          payout: true,
          startedAt: true,
          outcomeAt: true,
          project: { select: { id: true, projectCode: true, workOrderNo: true, name: true, client: { select: { name: true } } } },
          projectCountry: { select: { countryCode: true, currency: true } },
          vendorAllocation: { select: { vendor: { select: { name: true, code: true } } } },
        },
      }),
    ]);
    return {
      total,
      page: l.export ? 1 : l.page,
      pageSize: take,
      truncated: !!l.export && total > EXPORT_LIMIT,
      rows: rows.map((s) => ({
        id: s.id,
        projectId: s.project.id,
        projectCode: s.project.projectCode,
        workOrderNo: s.project.workOrderNo,
        projectName: s.project.name,
        client: s.project.client.name,
        countryCode: s.projectCountry.countryCode,
        currency: s.projectCountry.currency,
        vendor: s.vendorAllocation.vendor.name,
        vendorCode: s.vendorAllocation.vendor.code,
        uid: s.vendorRespondentId,
        token: s.token,
        status: s.status,
        statusDetail: s.statusDetail,
        approval: s.approval,
        verified: s.outcomeVerified,
        revenue: s.revenue == null ? null : Number(s.revenue),
        payout: s.payout == null ? null : Number(s.payout),
        loiMinutes: s.status === 'COMPLETE' && s.outcomeAt ? round((s.outcomeAt.getTime() - s.startedAt.getTime()) / 60_000) : null,
        startedAt: s.startedAt,
        outcomeAt: s.outcomeAt,
      })),
    };
  }

  /** Clicks report: the respondent event log (entries, outcomes, S2S confirmations, ignored repeats). */
  async clicks(org: string, f: ReportFilter, l: z.infer<typeof listSchema>) {
    const { gte, lt } = dayRange(f);
    const where: Prisma.RespondentEventWhereInput = {
      session: this.sessionWhere(org, { ...f, from: undefined, to: undefined }),
      ...(gte || lt ? { createdAt: { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } } : {}),
      ...(l.status ? { status: l.status } : {}),
    };
    const take = l.export ? EXPORT_LIMIT : l.pageSize;
    const skip = l.export ? 0 : (l.page - 1) * l.pageSize;
    const [total, rows, byType] = await Promise.all([
      this.prisma.respondentEvent.count({ where }),
      this.prisma.respondentEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        skip,
        select: {
          id: true,
          type: true,
          status: true,
          source: true,
          createdAt: true,
          session: {
            select: {
              vendorRespondentId: true,
              status: true,
              project: { select: { projectCode: true } },
              projectCountry: { select: { countryCode: true } },
              vendorAllocation: { select: { vendor: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.respondentEvent.groupBy({ by: ['type'], where, _count: { _all: true } }),
    ]);
    return {
      total,
      page: l.export ? 1 : l.page,
      pageSize: take,
      truncated: !!l.export && total > EXPORT_LIMIT,
      byType: Object.fromEntries(byType.map((t) => [t.type, t._count._all])),
      rows: rows.map((e) => ({
        id: e.id,
        at: e.createdAt,
        type: e.type,
        status: e.status,
        source: e.source,
        projectCode: e.session.project.projectCode,
        countryCode: e.session.projectCountry.countryCode,
        vendor: e.session.vendorAllocation.vendor.name,
        uid: e.session.vendorRespondentId,
        sessionStatus: e.session.status,
      })),
    };
  }

  /** Values for the filter bar. */
  async options(org: string) {
    const [clients, vendors, projects, countries] = await Promise.all([
      this.prisma.client.findMany({ where: { organizationId: org }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.vendor.findMany({ where: { organizationId: org }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.project.findMany({ where: { organizationId: org }, select: { id: true, projectCode: true, name: true, clientId: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.projectCountry.findMany({ where: { project: { organizationId: org } }, distinct: ['countryCode'], select: { countryCode: true }, orderBy: { countryCode: 'asc' } }),
    ]);
    return { clients, vendors, projects, countries: countries.map((c) => c.countryCode) };
  }
}

export const CURRENCY_NOTE = 'Converted figures use today’s exchange rates from Settings → Finance; market-currency figures are never mixed.';

function emptyRow(currency = ''): SummaryRow {
  return {
    key: 'total', label: 'Total', sublabel: null, clicks: 0, completes: 0, terminates: 0, quotaFull: 0, qualityFail: 0, partial: 0, inProgress: 0,
    approved: 0, pending: 0, rejected: 0, revenue: 0, payout: 0, profit: 0, margin: null, conversion: 0, medianLoiMinutes: null, loiMinutes: null, ir: null, speeders: 0, currencies: [], money: [],
    reporting: { currency, revenue: 0, payout: 0, profit: 0, margin: null, missing: [] },
  };
}

/** Adds zero rows for days without traffic, when the range is bounded and at most a year long. */
export function fillDays(rows: SummaryRow[], f: Pick<ReportFilter, 'from' | 'to'>, currency = ''): SummaryRow[] {
  if (!f.from || !f.to) return rows;
  const start = Date.parse(`${f.from}T00:00:00Z`);
  const end = Date.parse(`${f.to}T00:00:00Z`);
  if ((end - start) / 86_400_000 > 366) return rows;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out: SummaryRow[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const k = new Date(t).toISOString().slice(0, 10);
    out.push(byKey.get(k) ?? { ...emptyRow(currency), key: k, label: k });
  }
  return out;
}
