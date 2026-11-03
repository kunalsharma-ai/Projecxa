'use client';
import Link from 'next/link';
import { Empty } from '@/components/ui';

export interface Waterfall {
  currency: string;
  steps: { key: string; label: string; value: number; kind: 'start' | 'change' | 'subtotal' | 'total' }[];
  pending: number;
  margin: number | null;
  missing: string[];
}

const money = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** From the value of every complete to profit: rejected completes and vendor payout taken away step by step. */
export function WaterfallChart({ data }: { data: Waterfall }) {
  const start = data.steps[0]?.value ?? 0;
  if (!start) return <Empty>No completes in this period.</Empty>;
  const top = Math.max(start, ...data.steps.map((s) => s.value));
  const bars: { key: string; label: string; value: number; from: number; to: number; kind: string }[] = [];
  let level = 0;
  for (const s of data.steps) {
    if (s.kind === 'change') {
      bars.push({ ...s, from: level + s.value, to: level });
      level += s.value;
    } else {
      bars.push({ ...s, from: 0, to: s.value });
      level = s.value;
    }
  }
  const pct = (v: number) => `${Math.max(0, (v / top) * 100)}%`;
  const color = (k: string, v: number) => (k === 'change' ? 'rgb(var(--bad) / 0.75)' : k === 'total' ? (v < 0 ? 'rgb(var(--bad))' : 'rgb(var(--ok))') : 'rgb(var(--brand) / 0.8)');
  return (
    <div>
      <ul className="space-y-2.5" aria-label={`Revenue to profit in ${data.currency}`}>
        {bars.map((b) => (
          <li key={b.key} className="grid grid-cols-[minmax(6rem,8rem)_minmax(0,1fr)_4.5rem] items-center gap-2 text-sm">
            <span className={b.kind === 'change' ? 'text-muted' : 'font-medium'}>{b.label}</span>
            <span className="relative h-5 rounded bg-sunken/60">
              <span className="absolute inset-y-0 rounded" style={{ left: pct(Math.min(b.from, b.to)), width: `calc(${pct(Math.abs(b.to - b.from))} + 1px)`, background: color(b.kind, b.value) }} />
            </span>
            <span className={`text-right tabular-nums ${b.kind === 'change' ? 'text-bad' : ''}`}>{b.value < 0 ? '−' : ''}{money.format(Math.abs(b.value))}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        {data.currency}{data.margin != null ? ` · ${data.margin}% margin` : ''}{data.pending > 0 ? ` · ${data.currency} ${money.format(data.pending)} of revenue still to approve` : ''}
        {data.missing.length > 0 && <span className="text-warn"> · {data.missing.join(', ')} left out (no rate, <Link href="/settings#finance" className="underline">add one</Link>)</span>}
      </p>
    </div>
  );
}
