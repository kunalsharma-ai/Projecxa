'use client';
/**
 * Shared pieces of the Data processing and Analytics pages (docs/DATA_PROCESSING_AND_ANALYTICS.md):
 * project picker, neon tab bar, KPI tile, progress ring, gradient bars and donut.
 */
import clsx from 'clsx';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

export interface ProjectOption { id: string; code: string; name: string; status: string; sessions: number }
export interface ProjectHead { id: string; code: string; name: string; status: string; client: string }

/** Reads ?project= once on the client (the pages are client components; no Suspense boundary needed). */
export function projectFromUrl() {
  if (typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.search).get('project') ?? undefined;
}
export function setProjectInUrl(id: string) {
  const u = new URL(window.location.href);
  u.searchParams.set('project', id);
  window.history.replaceState(null, '', u.toString());
}

export function ProjectPicker({ projects, value, onChange, tab }: { projects: ProjectOption[]; value?: string; onChange: (id: string) => void; tab?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="insight-project">Project</label>
      <select id="insight-project" className="input h-10 w-auto max-w-[min(26rem,calc(100vw-2rem))]" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.code} · {p.name}{p.sessions ? ` (${p.sessions.toLocaleString()} entrants)` : ' (no traffic yet)'}</option>
        ))}
      </select>
      {value && <Link href={`/projects/${value}${tab ? `?tab=${tab}` : ''}`} className="btn-ghost h-10">Open project <ExternalLink className="h-3.5 w-3.5" /></Link>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly { id: T; label: string }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-full border border-line bg-panel/60 p-1 backdrop-blur" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={clsx('whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-colors', value === t.id ? 'bg-neon font-medium shadow' : 'text-muted hover:bg-sunken hover:text-ink')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ icon: Icon, tone, value, label, sub, subTone }: { icon: LucideIcon; tone: string; value: React.ReactNode; label: string; sub?: React.ReactNode; subTone?: 'good' | 'bad' | 'muted' }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className={clsx('icon-tile h-11 w-11 shrink-0 rounded-2xl', tone)}><Icon className="h-5 w-5" aria-hidden /></span>
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-none tabular-nums">{value}</div>
        <div className="mt-1 truncate text-sm">{label}</div>
        {sub != null && <div className={clsx('line-clamp-2 text-xs', subTone === 'good' ? 'text-ok' : subTone === 'bad' ? 'text-bad' : 'text-muted')}>{sub}</div>}
      </div>
    </div>
  );
}

/** Big neon progress ring with a number in the middle. */
export function Ring({ value, label, size = 180 }: { value: number | null; label: string; size?: number }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <svg viewBox="0 0 180 180" width={size} height={size} role="img" aria-label={`${label}: ${value == null ? 'no data' : `${value}%`}`} className="shrink-0">
      <defs>
        <linearGradient id="ring-g" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stopColor="#22d3ee" /><stop offset="50%" stopColor="rgb(var(--brand))" /><stop offset="100%" stopColor="#ec4899" /></linearGradient>
      </defs>
      <circle cx="90" cy="90" r={r} fill="none" stroke="rgb(var(--sunken))" strokeWidth="14" />
      {value != null && <circle cx="90" cy="90" r={r} fill="none" stroke="url(#ring-g)" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} transform="rotate(-90 90 90)" style={{ filter: 'drop-shadow(0 0 8px rgb(var(--brand) / 0.45))' }} />}
      <text x="90" y="92" textAnchor="middle" fontSize="30" fontWeight="800" fill="rgb(var(--ink))">{value == null ? '–' : `${Math.round(v)}%`}</text>
      <text x="90" y="114" textAnchor="middle" fontSize="9.5" fill="rgb(var(--muted))">{label}</text>
    </svg>
  );
}

export const GRADS = ['from-[#8b5cf6] to-[#6d28d9]', 'from-[#60a5fa] to-[#2563eb]', 'from-[#22d3ee] to-[#0d9488]', 'from-[#4ade80] to-[#16a34a]', 'from-[#fbbf24] to-[#ea580c]', 'from-[#f472b6] to-[#c026d3]', 'from-[#fb7185] to-[#dc2626]', 'from-[#a3e635] to-[#4d7c0f]'];
export const SOLID = ['#7c3aed', '#3b82f6', '#14b8a6', '#22c55e', '#f59e0b', '#d946ef', '#ef4444', '#84cc16'];

/** Horizontal bar with label, count and percentage. */
export function HBar({ label, count, percent, i = 0, max }: { label: string; count: number; percent: number | null; i?: number; max?: number }) {
  const w = max ? (count / max) * 100 : percent ?? 0;
  return (
    <li className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,14rem)_1fr_auto]">
      <span className="truncate" title={label}>{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-sunken"><span className={clsx('block h-full rounded-full bg-gradient-to-r', GRADS[i % GRADS.length])} style={{ width: `${Math.max(w, count ? 2 : 0)}%` }} /></span>
      <span className="w-24 text-right tabular-nums text-muted"><span className="font-medium text-ink">{count.toLocaleString()}</span>{percent != null && ` · ${percent}%`}</span>
    </li>
  );
}

/** Vertical gradient columns (the mockup's "by age group" chart). */
export function Columns({ items }: { items: { label: string; count: number; percent: number | null }[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div>
      <div className="flex h-48 items-end justify-around gap-2 border-b border-line">
        {items.map((it, i) => (
          <div key={it.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${it.label}: ${it.count} (${it.percent ?? 0}%)`}>
            <span className="text-xs font-bold tabular-nums">{it.percent == null ? it.count : `${it.percent}%`}</span>
            <span className={clsx('w-full max-w-[48px] rounded-t-xl bg-gradient-to-b shadow-md', GRADS[i % GRADS.length])} style={{ height: `${Math.max(3, (it.count / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-around gap-2">{items.map((it) => <span key={it.label} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted" title={it.label}>{it.label}</span>)}</div>
    </div>
  );
}

/** Donut of shares with a legend (the mockup's "Purchase intent" chart). */
export function Donut({ items, center, sub }: { items: { label: string; count: number; percent: number | null }[]; center: string; sub: string }) {
  const r = 62;
  const c = 2 * Math.PI * r;
  const total = items.reduce((a, i) => a + i.count, 0);
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 160 160" className="w-[150px] shrink-0" role="img" aria-label={items.map((i) => `${i.label} ${i.percent ?? 0}%`).join(', ')}>
        <circle cx="80" cy="80" r={r} fill="none" stroke="rgb(var(--sunken))" strokeWidth="20" />
        {total > 0 && items.map((it, i) => {
          const len = (it.count / total) * c;
          const el = <circle key={it.label} cx="80" cy="80" r={r} fill="none" stroke={SOLID[i % SOLID.length]} strokeWidth="20" strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)" />;
          offset += len;
          return el;
        })}
        <text x="80" y="82" textAnchor="middle" fontSize="24" fontWeight="800" fill="rgb(var(--ink))">{center}</text>
        <text x="80" y="100" textAnchor="middle" fontSize="10" fill="rgb(var(--muted))">{sub}</text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {items.map((it, i) => (
          <li key={it.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SOLID[i % SOLID.length] }} />
            <span className="min-w-0 truncate" title={it.label}>{it.label}</span>
            <span className="ml-auto pl-3 tabular-nums">{it.percent ?? 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Small area chart of a daily series. */
export function Spark({ points, label }: { points: { day: string; value: number }[]; label: string }) {
  const W = 600;
  const H = 120;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * W;
  const y = (v: number) => H - 8 - (v / max) * (H - 20);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" preserveAspectRatio="none" role="img" aria-label={label}>
        <defs><linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="rgb(var(--brand))" stopOpacity="0.35" /><stop offset="100%" stopColor="rgb(var(--brand))" stopOpacity="0" /></linearGradient></defs>
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#spark-fill)" />
        <path d={line} fill="none" stroke="rgb(var(--brand))" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{points[0] && new Date(`${points[0].day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
        <span>peak {max.toLocaleString()} a day</span>
        <span>today</span>
      </figcaption>
    </figure>
  );
}

export function Truncated({ show, total }: { show: boolean; total: number }) {
  if (!show) return null;
  return <p className="mb-4 rounded-xl border border-warn/30 bg-warn/10 px-4 py-2 text-sm text-warn">This project has {total.toLocaleString()} entrants; the figures below use the newest 100,000.</p>;
}
