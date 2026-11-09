'use client';
import clsx from 'clsx';
import { AlertTriangle, CalendarClock, ChevronDown, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { InfoTip } from '@/components/help';
import { money } from '@/components/ui';
import { get } from '@/lib/api';

type Basis = 'vendor_pace' | 'vendor_capacity' | 'actual' | 'planned' | 'none' | 'done';
interface CurrencyForecast {
  currency: string;
  completes: number;
  target: number;
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number | null;
  plannedRevenue: number;
  plannedCost: number;
  plannedMarginPct: number | null;
  forecastRevenue: number;
  forecastCost: number;
  forecastProfit: number;
  forecastMarginPct: number | null;
}
interface MarketForecast { id: string; countryCode: string; currency: string; remaining: number; perDay: number; finishAt: string | null; costPerComplete: number | null; costBasis: Basis; profit: number; marginPct: number | null }
export interface ProjectForecast {
  generatedAt: string;
  finishAt: string | null;
  fieldEndAt: string | null;
  daysLate: number;
  unknownMarkets: string[];
  confidence: 'low' | 'medium' | 'high';
  marginFloorPct: number;
  marginDropPts: number;
  currencies: CurrencyForecast[];
  markets: MarketForecast[];
}

const BASIS: Record<Basis, string> = {
  vendor_pace: 'vendors delivering now, by pace',
  vendor_capacity: 'open vendor links, by what they still owe',
  actual: 'average payout so far',
  planned: 'average vendor payout',
  none: 'no vendors yet',
  done: 'target reached',
};
const date = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const pct = (n: number | null) => (n == null ? '—' : `${n}%`);

/** Low margin by the same test the alert uses: under the floor, or the set points under plan. */
export function marginIsLow(f: ProjectForecast, c: CurrencyForecast) {
  if (c.forecastMarginPct == null) return false;
  return c.forecastMarginPct < f.marginFloorPct || (c.plannedMarginPct != null && c.plannedMarginPct - c.forecastMarginPct >= f.marginDropPts);
}

/**
 * Predicted finish date, cost and margin for a live project (docs/PROFIT_FORECAST.md).
 * Reloads whenever `refreshKey` changes, so it follows the project page's 30-second refresh.
 */
export function ForecastPanel({ projectId, refreshKey }: { projectId: string; refreshKey?: unknown }) {
  const [f, setF] = useState<ProjectForecast | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    get<{ forecast: ProjectForecast | null }>(`/monitor/forecast?projectId=${projectId}`)
      .then((r) => setF(r.forecast))
      .catch(() => {});
  }, [projectId, refreshKey]);

  if (!f) return null;
  const many = f.currencies.length > 1;
  const finishHint = f.unknownMarkets.length
    ? `no recent completes in ${f.unknownMarkets.join(', ')}`
    : f.daysLate > 0
      ? `${f.daysLate} day${f.daysLate === 1 ? '' : 's'} after the field end date`
      : f.fieldEndAt
        ? `on time · field ends ${date(f.fieldEndAt)}`
        : 'no field end date set';

  return (
    <section className="mb-6" aria-label="Forecast">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">Forecast at finish <InfoTip id="project.forecast" /></h2>
        <span className={clsx('chip text-xs', f.confidence === 'high' ? 'bg-ok/10 text-ok' : f.confidence === 'medium' ? 'bg-warn/10 text-warn' : 'bg-sunken text-muted')}>
          {f.confidence} confidence
        </span>
      </div>
      {f.currencies.filter((c) => marginIsLow(f, c)).map((c) => (
        <div key={c.currency} role="alert" className={clsx('mb-3 flex items-start gap-2 rounded-lg border p-3 text-sm', c.forecastProfit < 0 ? 'border-bad/40 bg-bad/10' : 'border-warn/40 bg-warn/10')}>
          <AlertTriangle className={clsx('mt-0.5 h-4 w-4 shrink-0', c.forecastProfit < 0 ? 'text-bad' : 'text-warn')} aria-hidden />
          <span>
            {many ? `${c.currency}: ` : ''}Margin is heading for <b>{pct(c.forecastMarginPct)}</b>
            {c.forecastMarginPct! < f.marginFloorPct ? `, under the ${f.marginFloorPct}% floor` : `, ${f.marginDropPts}+ points under the planned ${pct(c.plannedMarginPct)}`}.
            {' '}Move traffic to cheaper vendors, close costly links or review the CPI with the client.
          </span>
        </div>
      ))}
      <div className="grid gap-3 lg:grid-cols-[1fr_4fr]">
        <div className="card min-w-0 p-4">
          <div className="flex items-center gap-1 text-xs text-muted"><CalendarClock className="h-3.5 w-3.5" aria-hidden /> Finish date</div>
          <div className={clsx('text-lg font-bold tabular-nums', f.daysLate > 0 && 'text-bad')}>{f.finishAt ? date(f.finishAt) : 'Not yet known'}</div>
          <div className="text-xs text-muted">{finishHint}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {f.currencies.map((c) => (
          [
            ['Revenue at finish', money(c.forecastRevenue, c.currency), `${money(c.revenue, c.currency)} so far`, null],
            ['Cost at finish', money(c.forecastCost, c.currency), `${money(c.cost, c.currency)} so far`, null],
            ['Profit at finish', money(c.forecastProfit, c.currency), `${pct(c.forecastMarginPct)} margin`, c.forecastProfit < 0 ? 'text-bad' : c.forecastProfit > 0 ? 'text-ok' : null],
            ['Margin vs plan', pct(c.forecastMarginPct), `plan ${pct(c.plannedMarginPct)} · floor ${f.marginFloorPct}%`, marginIsLow(f, c) ? 'text-warn' : null],
          ] as const
        ).map(([label, value, hint, tone]) => (
          <div key={`${c.currency}-${label}`} className="card min-w-0 p-4">
            <div className="flex items-center gap-1 truncate text-xs text-muted">{label === 'Profit at finish' && <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden />}{label}{many ? ` · ${c.currency}` : ''}</div>
            <div className={clsx('truncate text-lg font-bold tabular-nums', tone)}>{value}</div>
            <div className="truncate text-xs text-muted">{hint}</div>
          </div>
        )))}
        </div>
      </div>
      <button className="mt-2 inline-flex items-center gap-1 text-xs text-muted hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden /> By market
      </button>
      {open && (
        <div className="card mt-2 overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>{['Market', 'To go', 'Per day', 'Finish', 'Cost per remaining complete', 'Profit at finish', 'Margin'].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {f.markets.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="px-3 py-2 font-medium">{m.countryCode}</td>
                  <td className="px-3 py-2 tabular-nums">{m.remaining}</td>
                  <td className="px-3 py-2 tabular-nums">{m.perDay}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{m.remaining === 0 ? 'Done' : m.finishAt ? date(m.finishAt) : 'Not yet known'}</td>
                  <td className="px-3 py-2"><span className="tabular-nums">{m.costPerComplete == null ? '—' : money(m.costPerComplete, m.currency)}</span> <span className="text-xs text-muted">{BASIS[m.costBasis]}</span></td>
                  <td className={clsx('px-3 py-2 tabular-nums', m.profit < 0 && 'text-bad')}>{money(m.profit, m.currency)}</td>
                  <td className="px-3 py-2 tabular-nums">{pct(m.marginPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
