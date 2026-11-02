'use client';
import clsx from 'clsx';
import { useState } from 'react';
import { Empty } from '@/components/ui';

export interface Heat { tz: string; entries: number[][]; completes: number[][]; max: number; total: number }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Respondent entries by weekday and hour (viewer's time zone): when fieldwork actually happens. */
export function TrafficHeatmap({ data }: { data: Heat }) {
  const [view, setView] = useState<'entries' | 'completes'>('entries');
  const [cell, setCell] = useState<[number, number] | null>(null);
  if (data.total === 0) return <Empty>No respondent traffic in this period.</Empty>;
  const grid = view === 'entries' ? data.entries : data.completes;
  const max = Math.max(1, ...grid.flat());
  const peak = grid.flatMap((row, d) => row.map((v, h) => ({ v, d, h }))).sort((a, b) => b.v - a.v)[0];
  const label = (d: number, h: number) => `${DAYS[d]} ${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Count">
          {(['entries', 'completes'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={clsx('rounded-md px-2.5 py-1 text-xs', view === k ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>
              {k === 'entries' ? 'Entries' : 'Completes'}
            </button>
          ))}
        </div>
        <div className="text-xs text-muted" aria-live="polite">
          {cell ? `${label(cell[0], cell[1])}: ${grid[cell[0]][cell[1]].toLocaleString()} ${view}` : peak && peak.v > 0 ? `Busiest: ${label(peak.d, peak.h)} (${peak.v.toLocaleString()})` : ''} · {data.tz}
        </div>
      </div>
      <div>
        <table className="w-full table-fixed border-separate" style={{ borderSpacing: 2 }} aria-label={`${view} by weekday and hour`}>
          <thead>
            <tr>
              <th className="w-8" />
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} scope="col" className="overflow-visible whitespace-nowrap p-0 text-left text-[10px] font-normal text-muted">{h % 3 === 0 ? h : ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, d) => (
              <tr key={d}>
                <th scope="row" className="pr-1 text-left text-xs font-normal text-muted">{DAYS[d]}</th>
                {row.map((v, h) => (
                  <td
                    key={h}
                    tabIndex={0}
                    onMouseEnter={() => setCell([d, h])}
                    onMouseLeave={() => setCell(null)}
                    onFocus={() => setCell([d, h])}
                    onBlur={() => setCell(null)}
                    title={`${label(d, h)}: ${v}`}
                    className={clsx('h-4 rounded-[3px] p-0 sm:h-5 outline-none focus-visible:ring-2 focus-visible:ring-brand', cell?.[0] === d && cell?.[1] === h && 'ring-1 ring-ink')}
                    style={{ background: v ? `rgb(var(--brand) / ${0.12 + 0.88 * (v / max)})` : 'rgb(var(--sunken))' }}
                  >
                    <span className="sr-only">{`${label(d, h)}: ${v}`}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted">
        Fewer
        {[0.12, 0.34, 0.56, 0.78, 1].map((o) => <span key={o} className="h-2.5 w-4 rounded-sm" style={{ background: `rgb(var(--brand) / ${o})` }} />)}
        More
      </div>
    </div>
  );
}
