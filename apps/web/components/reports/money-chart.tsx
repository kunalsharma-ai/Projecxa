'use client';
import clsx from 'clsx';
import { useState } from 'react';

export interface MoneyPoint { key: string; revenue: number; payout: number; profit: number; completes: number }
type Interval = 'day' | 'week' | 'month';

const SERIES = [
  { key: 'revenue', label: 'Revenue', color: 'var(--fin-1)' },
  { key: 'payout', label: 'Payout', color: 'var(--fin-2)' },
  { key: 'profit', label: 'Profit', color: 'var(--fin-3)' },
] as const;

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });

export function bucketLabel(key: string, interval: Interval, long = false) {
  if (interval === 'month') return new Date(`${key}-01T00:00:00Z`).toLocaleDateString(undefined, { month: long ? 'long' : 'short', year: long || key.endsWith('-01') ? 'numeric' : undefined, timeZone: 'UTC' });
  const d = new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return interval === 'week' && long ? `Week of ${d}` : d;
}

/** "Nice" axis ticks covering [lo, hi], always including zero. */
function ticks(lo: number, hi: number) {
  const span = Math.max(1, hi - lo);
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

/**
 * Revenue and payout per bucket (bars or lines) with profit as a line, on one money axis.
 * Hover or focus a bucket for exact values; the table view lists every number.
 */
export function MoneyChart({ points, interval, mode, currencies }: { points: MoneyPoint[]; interval: Interval; mode: 'bar' | 'line'; currencies: string[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const any = points.some((p) => p.revenue || p.payout);
  const H = 220;
  const lo = Math.min(0, ...points.map((p) => p.profit));
  const hi = Math.max(1, ...points.map((p) => Math.max(p.revenue, p.payout, p.profit)));
  const tk = ticks(lo, hi);
  const yMin = tk[0];
  const yMax = tk[tk.length - 1];
  const y = (v: number) => H - ((v - yMin) / (yMax - yMin)) * H;
  const n = points.length;
  const W = 1000;
  const bw = W / Math.max(1, n);
  const cx = (i: number) => bw * (i + 0.5);
  const path = (k: 'revenue' | 'payout' | 'profit') => points.map((p, i) => `${i ? 'L' : 'M'}${cx(i)},${y(p[k])}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const h = hover == null ? null : points[hover];
  const mixed = currencies.length > 1;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            {s.key === 'profit' || mode === 'line' ? <span className="h-0.5 w-4 rounded" style={{ background: s.color }} /> : <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />}
            {s.label}
          </span>
        ))}
        <span className="ml-auto">{mixed ? `Mixed currencies: ${currencies.join(', ')}` : currencies[0] ?? ''}</span>
        <button type="button" className="text-brand hover:underline" onClick={() => setTable(!table)}>{table ? 'Show chart' : 'Show table'}</button>
      </div>

      {table ? (
        <div className="max-h-72 overflow-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel"><tr><th className="th">{interval === 'day' ? 'Day' : interval === 'week' ? 'Week of' : 'Month'}</th><th className="th text-right">Completes</th><th className="th text-right">Revenue</th><th className="th text-right">Payout</th><th className="th text-right">Profit</th></tr></thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key} className="border-t border-line">
                  <td className="td">{bucketLabel(p.key, interval, true)}</td>
                  <td className="td text-right tabular-nums">{p.completes}</td>
                  <td className="td text-right tabular-nums">{full.format(p.revenue)}</td>
                  <td className="td text-right tabular-nums">{full.format(p.payout)}</td>
                  <td className={clsx('td text-right tabular-nums', p.profit < 0 && 'text-bad')}>{full.format(p.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !any ? (
        <p className="py-16 text-center text-sm text-muted">No completes in this period.</p>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="relative w-10 shrink-0 text-right text-[11px] text-muted" style={{ height: H }}>
              {tk.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ top: y(t) }}>{compact.format(t)}</span>)}
            </div>
            <div className="relative min-w-0 flex-1" style={{ height: H }} onMouseLeave={() => setHover(null)}>
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
                {tk.map((t) => <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} stroke="rgb(var(--line))" strokeWidth={1} strokeOpacity={t === 0 ? 1 : 0.6} vectorEffect="non-scaling-stroke" />)}
                {hover != null && <rect x={bw * hover} y={0} width={bw} height={H} fill="rgb(var(--sunken))" opacity={0.7} />}
                {mode === 'bar'
                  ? points.map((p, i) => {
                      // Two bars per bucket with a gap between them and around the group.
                      const pad = Math.min(bw * 0.18, 12);
                      const gap = Math.min(bw * 0.04, 2.5);
                      const w = Math.max(0.5, (bw - pad * 2 - gap) / 2);
                      const x0 = bw * i + pad;
                      return (
                        <g key={p.key}>
                          {(['revenue', 'payout'] as const).map((k, j) => {
                            const v = p[k];
                            if (!v) return null;
                            const top = y(v);
                            return <rect key={k} x={x0 + j * (w + gap)} y={top} width={w} height={Math.max(1, y(0) - top)} fill={SERIES[j].color} rx={Math.min(3, w / 3)} />;
                          })}
                        </g>
                      );
                    })
                  : (['revenue', 'payout'] as const).map((k, j) => <path key={k} d={path(k)} fill="none" stroke={SERIES[j].color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />)}
                <path d={path('profit')} fill="none" stroke={SERIES[2].color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              </svg>
              {/* Markers as HTML so they stay round on a stretched chart. */}
              {h && hover != null && (mode === 'line' ? (['revenue', 'payout', 'profit'] as const) : (['profit'] as const)).map((k) => (
                <span key={k} className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel" style={{ left: `${((hover + 0.5) / n) * 100}%`, top: y(h[k]), background: SERIES.find((s) => s.key === k)!.color }} />
              ))}
              <div className="absolute inset-0 flex">
                {points.map((p, i) => (
                  <button
                    key={p.key}
                    type="button"
                    className="h-full min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    aria-label={`${bucketLabel(p.key, interval, true)}: revenue ${full.format(p.revenue)}, payout ${full.format(p.payout)}, profit ${full.format(p.profit)}`}
                  />
                ))}
              </div>
              {h && hover != null && (
                <div
                  className="pointer-events-none absolute -top-2 z-10 w-48 -translate-y-full rounded-lg border border-line bg-panel p-2.5 text-xs shadow-lg"
                  style={{ left: `clamp(0px, calc(${((hover + 0.5) / n) * 100}% - 96px), calc(100% - 192px))` }}
                >
                  <div className="font-medium">{bucketLabel(h.key, interval, true)}</div>
                  {SERIES.map((s) => (
                    <div key={s.key} className="mt-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                      <span className={clsx('tabular-nums', s.key === 'profit' && h.profit < 0 && 'text-bad')}>{full.format(h[s.key])}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between border-t border-line pt-1"><span className="text-muted">Completes</span><span className="tabular-nums">{h.completes}</span></div>
                </div>
              )}
            </div>
          </div>
          <div className="ml-12 mt-1 flex text-[11px] text-muted">
            {points.map((p, i) => (
              <span key={p.key} className={clsx('min-w-0 flex-1 overflow-visible whitespace-nowrap', i % (labelEvery * 2) !== 0 && 'max-sm:invisible')}>{i % labelEvery === 0 ? bucketLabel(p.key, interval) : ''}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
