import clsx from 'clsx';
import Link from 'next/link';
import type { Display } from '@/lib/ai';

const TONE = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' } as const;
const TEXT = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' } as const;

/** Tables, bar charts and figures built on the server from real records. */
export function DisplayBlock({ d }: { d: Display }) {
  if (d.type === 'stats') {
    return (
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted">{d.title}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {d.items.map((s) => (
            <div key={s.label} className="min-w-0 rounded-lg border border-line px-3 py-2">
              <div className="truncate text-xs text-muted">{s.label}</div>
              <div className={clsx('truncate font-semibold tabular-nums', s.tone && TEXT[s.tone])} title={s.value}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (d.type === 'bars') {
    const max = Math.max(1, ...d.items.map((i) => i.value));
    return (
      <figure>
        <figcaption className="mb-1.5 text-xs font-medium text-muted">{d.title}</figcaption>
        <div className="space-y-1.5">
          {d.items.map((i) => (
            <div key={i.label} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2 text-xs">
              <span className="truncate" title={i.label}>{i.label}</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${i.label}: ${i.value}${d.unit ?? ''}`}>
                <div className={clsx('h-full rounded-full', i.tone ? TONE[i.tone] : 'bg-brand')} style={{ width: `${Math.min(100, (i.value / max) * 100)}%` }} />
              </div>
              <span className="tabular-nums text-muted">{i.value}{d.unit ?? ''}</span>
            </div>
          ))}
        </div>
      </figure>
    );
  }
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-xs font-medium text-muted">{d.title}</div>
      <div className="max-h-80 overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[480px] text-xs">
          <thead className="sticky top-0 bg-sunken"><tr>{d.columns.map((c) => <th key={c.key} className={clsx('px-2.5 py-1.5 text-left font-medium text-muted', c.align === 'right' && 'text-right')}>{c.label}</th>)}</tr></thead>
          <tbody>
            {d.rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {d.columns.map((c, j) => {
                  const v = r[c.key];
                  const text = v === null || v === undefined || v === '' ? '–' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
                  const href = j === 0 ? d.links?.[i] : null;
                  return <td key={c.key} className={clsx('px-2.5 py-1.5 align-top', c.align === 'right' && 'text-right tabular-nums')}>{href ? <Link href={href} className="font-medium text-brand hover:underline">{text}</Link> : text}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
