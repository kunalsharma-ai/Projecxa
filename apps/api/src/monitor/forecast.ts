/**
 * Profit forecasting: when a project will finish, what it will cost and the margin it will make,
 * from the pace of the last 72 hours and the money earned so far. Pure functions, so every number
 * is unit-testable; MonitorService feeds them live markets (docs/PROFIT_FORECAST.md).
 */
import type { AlertSettings, Candidate, Pace } from './monitor.rules';

/** The forecast needs this many completes in a currency before the margin alert can fire. */
export const MIN_FORECAST_COMPLETES = 5;

const DAY = 86_400_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pctOf = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : null);

export interface ForecastVendorIn {
  cpi: number;
  target: number;
  completes: number;
  status: string;
  perDay: number;
}

export interface ForecastMarketIn {
  id: string;
  countryCode: string;
  status: string;
  currency: string;
  /** Client CPI. */
  cpi: number;
  target: number;
  completes: number;
  /** Earned and owed so far for live completes. */
  revenue: number;
  cost: number;
  pace: Pace;
  vendors: ForecastVendorIn[];
}

export type CostBasis = 'vendor_pace' | 'vendor_capacity' | 'actual' | 'planned' | 'none' | 'done';

export interface MarketForecast {
  id: string;
  countryCode: string;
  currency: string;
  remaining: number;
  perDay: number;
  /** Predicted day the market reaches its target; null when nothing is coming in. */
  finishAt: Date | null;
  /** Payout assumed for each remaining complete. */
  costPerComplete: number | null;
  costBasis: CostBasis;
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number | null;
}

export interface CurrencyForecast {
  currency: string;
  completes: number;
  target: number;
  /** So far. */
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number | null;
  /** At target, from the bid: client CPI × target, average vendor payout × target. */
  plannedRevenue: number;
  plannedCost: number;
  plannedMarginPct: number | null;
  /** Predicted at finish: what is earned so far plus the remaining completes at the current vendor mix. */
  forecastRevenue: number;
  forecastCost: number;
  forecastProfit: number;
  forecastMarginPct: number | null;
}

export type Confidence = 'low' | 'medium' | 'high';

export interface ProjectForecast {
  generatedAt: Date;
  /** Latest predicted market finish; null when an open market has no pace yet. */
  finishAt: Date | null;
  fieldEndAt: Date | null;
  /** Whole days past the field end date (0 when on time or no end date). */
  daysLate: number;
  /** Markets with completes to go and no completes in the last 72 hours. */
  unknownMarkets: string[];
  confidence: Confidence;
  /** Margin floor in percent that this project's alert uses (project override or organisation default). */
  marginFloorPct: number;
  marginDropPts: number;
  currencies: CurrencyForecast[];
  markets: MarketForecast[];
}

/**
 * What each remaining complete will cost. The vendors delivering now set the price, weighted by
 * their pace; without pace, by the completes each open link still has to deliver; then the
 * average payout so far; then the average payout of all the market's links.
 */
export function remainingCostPerComplete(m: ForecastMarketIn): { cpc: number | null; basis: CostBasis } {
  const open = m.vendors.filter((v) => v.status === 'ACTIVE' && v.target > v.completes);
  const paced = open.filter((v) => v.perDay > 0);
  const weighted = (vs: ForecastVendorIn[], w: (v: ForecastVendorIn) => number) => {
    const total = vs.reduce((a, v) => a + w(v), 0);
    return total > 0 ? vs.reduce((a, v) => a + v.cpi * w(v), 0) / total : null;
  };
  const byPace = weighted(paced, (v) => v.perDay);
  if (byPace != null) return { cpc: byPace, basis: 'vendor_pace' };
  const byCapacity = weighted(open, (v) => v.target - v.completes);
  if (byCapacity != null) return { cpc: byCapacity, basis: 'vendor_capacity' };
  if (m.completes > 0) return { cpc: m.cost / m.completes, basis: 'actual' };
  if (m.vendors.length) return { cpc: m.vendors.reduce((a, v) => a + v.cpi, 0) / m.vendors.length, basis: 'planned' };
  return { cpc: null, basis: 'none' };
}

export function forecastMarket(m: ForecastMarketIn, now: Date): MarketForecast {
  const remaining = Math.max(0, m.target - m.completes);
  const { cpc, basis } = remaining === 0 ? { cpc: null, basis: 'done' as const } : remainingCostPerComplete(m);
  const finishAt = remaining === 0 ? now : m.pace.etaDays != null ? new Date(now.getTime() + m.pace.etaDays * DAY) : null;
  const revenue = m.revenue + remaining * m.cpi;
  const cost = m.cost + remaining * (cpc ?? 0);
  return {
    id: m.id,
    countryCode: m.countryCode,
    currency: m.currency,
    remaining,
    perDay: m.pace.perDay,
    finishAt,
    costPerComplete: cpc == null ? null : r2(cpc),
    costBasis: basis,
    revenue: r2(revenue),
    cost: r2(cost),
    profit: r2(revenue - cost),
    marginPct: pctOf(revenue - cost, revenue),
  };
}

export function forecastProject(
  markets: ForecastMarketIn[],
  opts: { now: Date; fieldEndAt: Date | null; marginFloorPct: number; marginDropPts: number },
): ProjectForecast {
  const per = markets.map((m) => forecastMarket(m, opts.now));
  const open = per.filter((m) => m.remaining > 0);
  const unknownMarkets = open.filter((m) => !m.finishAt).map((m) => m.countryCode);
  const finishAt = unknownMarkets.length || !per.length ? null : new Date(Math.max(...per.map((m) => m.finishAt!.getTime())));
  const daysLate = finishAt && opts.fieldEndAt && finishAt > opts.fieldEndAt ? Math.ceil((finishAt.getTime() - opts.fieldEndAt.getTime()) / DAY) : 0;

  const byCur = new Map<string, CurrencyForecast>();
  markets.forEach((m, i) => {
    const f = per[i];
    const c = byCur.get(m.currency) ?? { currency: m.currency, completes: 0, target: 0, revenue: 0, cost: 0, profit: 0, marginPct: null, plannedRevenue: 0, plannedCost: 0, plannedMarginPct: null, forecastRevenue: 0, forecastCost: 0, forecastProfit: 0, forecastMarginPct: null };
    c.completes += m.completes;
    c.target += m.target;
    c.revenue += m.revenue;
    c.cost += m.cost;
    c.plannedRevenue += m.cpi * m.target;
    if (m.vendors.length) c.plannedCost += (m.vendors.reduce((a, v) => a + v.cpi, 0) / m.vendors.length) * m.target;
    c.forecastRevenue += f.revenue;
    c.forecastCost += f.cost;
    byCur.set(m.currency, c);
  });
  const currencies = [...byCur.values()].map((c) => ({
    ...c,
    revenue: r2(c.revenue),
    cost: r2(c.cost),
    profit: r2(c.revenue - c.cost),
    marginPct: pctOf(c.revenue - c.cost, c.revenue),
    plannedRevenue: r2(c.plannedRevenue),
    plannedCost: r2(c.plannedCost),
    plannedMarginPct: c.plannedCost > 0 ? pctOf(c.plannedRevenue - c.plannedCost, c.plannedRevenue) : null,
    forecastRevenue: r2(c.forecastRevenue),
    forecastCost: r2(c.forecastCost),
    forecastProfit: r2(c.forecastRevenue - c.forecastCost),
    forecastMarginPct: pctOf(c.forecastRevenue - c.forecastCost, c.forecastRevenue),
  }));

  const completes = markets.reduce((a, m) => a + m.completes, 0);
  const confidence: Confidence = unknownMarkets.length || completes < 10 ? 'low' : completes < 50 || per.some((m) => m.costBasis === 'planned') ? 'medium' : 'high';
  return { generatedAt: opts.now, finishAt, fieldEndAt: opts.fieldEndAt, daysLate, unknownMarkets, confidence, marginFloorPct: opts.marginFloorPct, marginDropPts: opts.marginDropPts, currencies, markets: per };
}

const fmt = (n: number, cur: string) => `${cur} ${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/**
 * Margin alert for one project: fires per currency once enough completes are in and the forecast
 * margin is under the floor, or has fallen the set number of points under the planned margin.
 */
export function marginRules(key: string, label: string, f: ProjectForecast): Candidate[] {
  const out: Candidate[] = [];
  for (const c of f.currencies) {
    if (c.completes < MIN_FORECAST_COMPLETES || c.forecastMarginPct == null) continue;
    const m = c.forecastMarginPct;
    const below = m < f.marginFloorPct;
    const dropped = c.plannedMarginPct != null && c.plannedMarginPct - m >= f.marginDropPts;
    if (!below && !dropped) continue;
    const vs = below ? `floor ${f.marginFloorPct}%` : `planned ${c.plannedMarginPct}%`;
    out.push({
      dedupeKey: `${key}:${c.currency}:margin_low`,
      rule: 'margin_low',
      severity: c.forecastProfit < 0 ? 'bad' : 'warn',
      title: `${label} margin is heading for ${m}% (${vs})`,
      detail: `Forecast profit ${fmt(c.forecastProfit, c.currency)} on ${fmt(c.forecastRevenue, c.currency)} revenue at the current vendor mix. Move traffic to cheaper vendors, close costly links or review the CPI with the client.`,
      metrics: { currency: c.currency, forecastMarginPct: m, plannedMarginPct: c.plannedMarginPct, floorPct: f.marginFloorPct, forecastProfit: c.forecastProfit, forecastRevenue: c.forecastRevenue },
    });
  }
  return out;
}

/** Project override first, then the organisation's alert settings. */
export function marginFloorOf(s: AlertSettings, projectFloor: number | null | undefined) {
  return projectFloor ?? s.marginFloorPct;
}
