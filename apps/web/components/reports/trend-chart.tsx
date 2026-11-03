'use client';
import { useState } from 'react';
import type { SummaryRow } from './types';

/** Daily completes as bars, with clicks and revenue in the hover tooltip. One series, so no legend. */
export function TrendChart({ days }: { days: SummaryRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (days.length === 0) return <p className="py-10 text-center text-sm text-muted">No traffic in this range.</p>;
  const H = 160;
  const max = Math.max(1, ...days.map((d) => d.completes));
  const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const h = hover == null ? null : days[hover];
  const fmt = (k: string) => new Date(`${k}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));
  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative w-6 shrink-0 text-right text-[11px] text-muted" style={{ height: H }}>
          {ticks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ top: H - (t / max) * H }}>{t}</span>)}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => <div key={t} className="absolute inset-x-0 border-t border-line/70" style={{ top: H - (t / max) * H }} />)}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {days.map((d, i) => (
              <button
                key={d.key}
                type="button"
                className="group relative flex h-full min-w-0 flex-1 items-end focus:outline-none"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${fmt(d.key)}: ${d.completes} completes, ${d.clicks} clicks`}
              >
                <span
                  className={`block w-full rounded-t-[4px] ${hover === i ? 'bg-brand' : 'bg-brand/75'}`}
                  style={{ height: d.completes ? Math.max(2, (d.completes / max) * H) : 0 }}
                />
              </button>
            ))}
          </div>
          {h && hover != null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 w-44 -translate-y-full rounded-lg border border-line bg-panel p-2.5 text-xs shadow-lg"
              style={{ left: `clamp(0px, calc(${((hover + 0.5) / days.length) * 100}% - 88px), calc(100% - 176px))` }}
            >
              <div className="font-medium">{fmt(h.key)}</div>
              <div className="mt-1 flex justify-between"><span className="text-muted">Completes</span><span className="tabular-nums">{h.completes}</span></div>
              <div className="flex justify-between"><span className="text-muted">Clicks</span><span className="tabular-nums">{h.clicks}</span></div>
              <div className="flex justify-between"><span className="text-muted">Conversion</span><span className="tabular-nums">{h.conversion}%</span></div>
            </div>
          )}
        </div>
      </div>
      <div className="ml-8 mt-1 flex text-[11px] text-muted">
        {days.map((d, i) => (
          // Every other label is hidden on phones so dates never collide.
          <span key={d.key} className={`min-w-0 flex-1 overflow-visible whitespace-nowrap ${i % (labelEvery * 2) !== 0 ? 'max-sm:invisible' : ''}`}>{i % labelEvery === 0 ? fmt(d.key) : ''}</span>
        ))}
      </div>
    </div>
  );
}
