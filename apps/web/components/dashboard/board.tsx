'use client';
/**
 * Neon command center panels (docs/NEON_DESIGN.md): Gantt timeline, Kanban by stage, health radar,
 * recent activity, coverage globe, revenue vs cost donut, supplier performance bars and quick actions.
 * Data comes from GET /dashboard/board and the main dashboard; nothing here is sample data.
 */
import clsx from 'clsx';
import { geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { BarChart3, FilePlus2, FolderKanban, ListChecks, Plus, ReceiptText, Sparkles, Truck, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { Empty } from '@/components/ui';
import { NUMERIC } from './markets-map';

export interface Board {
  timeline: { id: string; code: string; name: string; client: string; status: string; start: string; end: string; planned: boolean; target: number; completes: number; percent: number }[];
  kanban: { id: string; label: string; count: number; projects: { id: string; code: string; name: string; status: string; percent: number }[] }[];
  health: { score: number | null; axes: { id: string; label: string; value: number | null; hint: string }[] };
  activity: { id: string; title: string; action: string; subject: string | null; href: string | null; actor: string | null; at: string }[];
  suppliers: { id: string; name: string; code: string; score: number; grade: string | null }[];
  coverage: { markets: number; liveMarkets: number; countryCodes: string[]; vendors: number; activeVendors: number; clients: number };
}

/** The panel frame used by every widget here (matches Section, with an optional icon). */
export function Panel({ title, icon, action, children, className }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx('card flex h-full min-w-0 flex-col', className)}>
      <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">{icon}{title}</h2>
        {action}
      </div>
      <div className="min-h-0 flex-1 px-5 pb-5">{children}</div>
    </section>
  );
}

// ─── Gantt ───
const BAR = ['from-[#8b5cf6] to-[#6d28d9]', 'from-[#60a5fa] to-[#2563eb]', 'from-[#22d3ee] to-[#0d9488]', 'from-[#4ade80] to-[#16a34a]', 'from-[#fbbf24] to-[#ea580c]', 'from-[#f472b6] to-[#c026d3]'];
const month = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });

export function GanttTimeline({ items }: { items: Board['timeline'] }) {
  const [view, setView] = useState<'gantt' | 'list'>('gantt');
  if (!items.length) return <Panel title="Project timeline"><Empty>No projects yet.</Empty></Panel>;
  const starts = items.map((i) => Date.parse(i.start));
  const ends = items.map((i) => Date.parse(i.end));
  // Whole months around the projects, at least three.
  const a = new Date(Math.min(...starts));
  const from = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1);
  const b = new Date(Math.max(...ends, Date.now()));
  let to = Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + 1, 1);
  const months: number[] = [];
  for (let t = from; t < to; t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)) months.push(t);
  while (months.length < 3) { months.push(to); to = Date.UTC(new Date(to).getUTCFullYear(), new Date(to).getUTCMonth() + 1, 1); }
  const span = to - from;
  const x = (t: number) => `${((t - from) / span) * 100}%`;
  const today = Date.now();

  return (
    <Panel title="Project timeline (Gantt)" action={
      <div className="flex rounded-full border border-line p-0.5 text-xs" role="group" aria-label="Timeline view">
        {(['gantt', 'list'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={clsx('rounded-full px-2.5 py-1', view === v ? 'bg-neon' : 'text-muted hover:bg-sunken')}>{v === 'gantt' ? 'Gantt' : 'Dates'}</button>
        ))}
      </div>
    }>
      {view === 'gantt' ? (
        <div className="text-sm">
          <div className="grid grid-cols-[minmax(0,9rem)_1fr] items-end gap-3 border-b border-line pb-1.5 text-xs text-muted sm:grid-cols-[minmax(0,12rem)_1fr]">
            <span>Project</span>
            <div className="relative h-4">{months.map((m) => <span key={m} className="absolute -translate-x-0" style={{ left: x(m) }}>{month(m)}</span>)}</div>
          </div>
          <ul className="relative">
            {items.map((p, i) => {
              const s = Date.parse(p.start);
              const e = Math.max(Date.parse(p.end), s + 86_400_000);
              return (
                <li key={p.id} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 py-1.5 sm:grid-cols-[minmax(0,12rem)_1fr]">
                  <Link href={`/projects/${p.id}`} className="truncate font-medium hover:text-brand" title={`${p.code} · ${p.name} · ${p.client}`}>{p.name}</Link>
                  <div className="relative h-5">
                    {months.map((m) => <span key={m} className="absolute inset-y-0 border-l border-line/70" style={{ left: x(m) }} aria-hidden />)}
                    {today >= from && today <= to && <span className="absolute -inset-y-1 w-px bg-bad/60" style={{ left: x(today) }} aria-hidden />}
                    <div className={clsx('absolute top-0.5 h-4 overflow-hidden rounded-full bg-gradient-to-r shadow-sm', BAR[i % BAR.length], !p.planned && 'opacity-80')}
                      style={{ left: x(s), width: `max(10px, calc(${x(e)} - ${x(s)}))` }}
                      title={`${p.code}: ${new Date(s).toLocaleDateString()} to ${new Date(e).toLocaleDateString()}${p.planned ? '' : ' (no planned end)'} · ${p.completes}/${p.target} completes`}>
                      <div className="h-full bg-white/30" style={{ width: `${p.percent}%` }} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-muted">Bars run over the planned field dates; the lighter part shows completes reached. The red line is today.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {items.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/projects/${p.id}`} className="min-w-0 truncate font-medium hover:text-brand">{p.code} · {p.name}</Link>
              <span className="shrink-0 text-xs tabular-nums text-muted">{new Date(p.start).toLocaleDateString()} – {p.planned ? new Date(p.end).toLocaleDateString() : 'open'}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ─── Kanban ───
const COLUMN_TONE: Record<string, string> = {
  setup: 'bg-[#eef0ff] text-[#3f3a99] dark:bg-white/5 dark:text-[#c9c5ff]',
  testing: 'bg-[#e3efff] text-[#1d4ed8] dark:bg-[#2563eb]/15 dark:text-[#9cc3ff]',
  fieldwork: 'bg-[#fff1df] text-[#b45309] dark:bg-[#ea580c]/15 dark:text-[#fdc28a]',
  done: 'bg-[#e3f8ea] text-[#15803d] dark:bg-[#16a34a]/15 dark:text-[#8ee5ad]',
};
const COLUMN_HEAD: Record<string, string> = { setup: 'tone-violet', testing: 'tone-blue', fieldwork: 'tone-amber', done: 'tone-green' };

export function KanbanBoard({ columns }: { columns: Board['kanban'] }) {
  return (
    <Panel title="Kanban: project stages" icon={<FolderKanban className="h-4 w-4 text-brand" aria-hidden />} action={<Link href="/projects" className="text-xs text-brand hover:underline">All projects</Link>}>
      <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
        {columns.map((c) => (
          <div key={c.id} className={clsx('flex min-w-0 flex-col rounded-2xl p-2', COLUMN_TONE[c.id])}>
            <div className="mb-2 flex items-center justify-between gap-1 px-1 text-xs font-semibold">
              <span className="truncate">{c.label}</span>
              <span className={clsx('icon-tile h-6 w-auto min-w-6 rounded-full px-1.5 text-[11px]', COLUMN_HEAD[c.id])}>{c.count}</span>
            </div>
            <ul className="space-y-1.5">
              {c.projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="block rounded-xl bg-panel/90 px-2.5 py-2 text-xs text-ink shadow-sm transition-transform hover:-translate-y-0.5">
                    <div className="truncate font-medium" title={p.name}>{p.name}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted">
                      <span className="font-mono">{p.code}</span>
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full bg-neon" style={{ width: `${p.percent}%` }} /></span>
                      <span className="tabular-nums">{p.percent}%</span>
                    </div>
                  </Link>
                </li>
              ))}
              {c.count === 0 && <li className="rounded-xl border border-dashed border-current/20 px-2 py-3 text-center text-[11px] opacity-70">None</li>}
              {c.count > c.projects.length && <li className="px-1 text-[11px] opacity-80">+{c.count - c.projects.length} more</li>}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── Health radar ───
export function HealthRadar({ health }: { health: Board['health'] }) {
  const n = health.axes.length;
  const R = 78;
  const C = 110;
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
  };
  const poly = (r: (i: number) => number) => health.axes.map((_, i) => pt(i, r(i)).join(',')).join(' ');
  return (
    <Panel title="Project health radar">
      <figure className="mx-auto max-w-[340px]">
        <svg viewBox="-30 0 280 220" className="w-full" role="img" aria-label={`Health score ${health.score ?? 'not available'}`}>
          <defs>
            <radialGradient id="hr-fill"><stop offset="0%" stopColor="rgb(var(--accent2))" stopOpacity="0.55" /><stop offset="100%" stopColor="rgb(var(--brand))" stopOpacity="0.55" /></radialGradient>
            <linearGradient id="hr-core" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stopColor="var(--neon-a)" /><stop offset="100%" stopColor="var(--neon-b)" /></linearGradient>
          </defs>
          {[0.25, 0.5, 0.75, 1].map((k) => <polygon key={k} points={poly(() => R * k)} fill="none" stroke="rgb(var(--line))" strokeWidth="1" />)}
          {health.axes.map((_, i) => <line key={i} x1={C} y1={C} x2={pt(i, R)[0]} y2={pt(i, R)[1]} stroke="rgb(var(--line))" />)}
          <polygon points={poly((i) => (R * (health.axes[i].value ?? 0)) / 100)} fill="url(#hr-fill)" stroke="rgb(var(--brand))" strokeWidth="2" />
          {health.axes.map((a, i) => { const [x, y] = pt(i, (R * (a.value ?? 0)) / 100); return <circle key={a.id} cx={x} cy={y} r="3.5" fill="rgb(var(--brand))" stroke="white" strokeWidth="1.5" />; })}
          <circle cx={C} cy={C} r="30" fill="url(#hr-core)" style={{ filter: 'drop-shadow(0 4px 10px rgb(var(--brand) / 0.6))' }} />
          <text x={C} y={C + 3} textAnchor="middle" fontSize="17" fontWeight="800" fill="white">{health.score == null ? '–' : `${health.score}%`}</text>
          <text x={C} y={C + 15} textAnchor="middle" fontSize="7" fill="white" opacity="0.9">Health score</text>
          {health.axes.map((a, i) => {
            const [x, y] = pt(i, R + 18);
            return (
              <text key={a.id} x={x} y={y + 3} textAnchor={x < C - 5 ? 'end' : x > C + 5 ? 'start' : 'middle'} fontSize="9" fill="rgb(var(--muted))">
                <title>{`${a.label}: ${a.value ?? 'no data'}${a.value != null ? '/100' : ''}. ${a.hint}`}</title>
                {a.label}
              </text>
            );
          })}
        </svg>
        <figcaption className="sr-only">{health.axes.map((a) => `${a.label} ${a.value ?? 'no data'}`).join(', ')}</figcaption>
      </figure>
    </Panel>
  );
}

// ─── Recent activity ───
const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const ACT_TONE = (a: string) => (a.startsWith('invoice') || a.startsWith('payable') ? 'tone-pink' : a.startsWith('project') ? 'tone-violet' : a.startsWith('quota') || a.startsWith('reconcil') ? 'tone-green' : a.startsWith('vendor') ? 'tone-amber' : 'tone-blue');

export function RecentActivity({ items }: { items: Board['activity'] }) {
  return (
    <Panel title="Recent activity">
      {items.length === 0 ? <Empty>Nothing yet.</Empty> : (
        <ol className="space-y-3">
          {items.slice(0, 6).map((e) => {
            const body = (
              <>
                <span className={clsx('icon-tile h-8 w-8 rounded-xl', ACT_TONE(e.action))}><ListChecks className="h-4 w-4" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.title}{e.subject && <span className="text-muted"> · {e.subject}</span>}</span>
                  <span className="block truncate text-xs text-muted">{e.actor ?? 'System'}</span>
                </span>
                <time className="shrink-0 text-[11px] text-muted" dateTime={e.at} title={new Date(e.at).toLocaleString()}>{ago(e.at)}</time>
              </>
            );
            return <li key={e.id}>{e.href ? <Link href={e.href} className="flex items-center gap-3 rounded-lg hover:bg-sunken/60">{body}</Link> : <div className="flex items-center gap-3">{body}</div>}</li>;
          })}
        </ol>
      )}
    </Panel>
  );
}

// ─── Coverage globe ───
type World = { id: string; f: GeoPermissibleObjects }[];
let worldCache: Promise<World> | null = null;
const loadWorld = () => (worldCache ??= import('world-atlas/countries-110m.json').then((m) => {
  const topo = (m.default ?? m) as unknown as Topology<{ countries: GeometryCollection }>;
  const fc = feature(topo, topo.objects.countries) as unknown as { features: (GeoPermissibleObjects & { id?: string })[] };
  return fc.features.map((f) => ({ id: String(f.id ?? ''), f }));
}));

export function CoverageGlobe({ coverage }: { coverage: Board['coverage'] }) {
  const [world, setWorld] = useState<World | null>(null);
  useEffect(() => { let on = true; loadWorld().then((w) => on && setWorld(w)).catch(() => on && setWorld([])); return () => { on = false; }; }, []);
  const active = useMemo(() => new Set(coverage.countryCodes.map((c) => NUMERIC[c]).filter(Boolean)), [coverage.countryCodes]);
  // Turn the globe toward the first market so it is in view.
  const path = useMemo(() => geoPath(geoOrthographic().scale(98).translate([100, 100]).rotate([10, -25])), []);
  return (
    <Panel title="Global project coverage">
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 200 200" className="w-[58%] max-w-[220px] shrink-0" role="img" aria-label={`${coverage.markets} markets`}>
          <defs>
            <radialGradient id="globe-sea" cx="35%" cy="30%"><stop offset="0%" stopColor="#7dd3fc" /><stop offset="55%" stopColor="#2563eb" /><stop offset="100%" stopColor="#1e1b4b" /></radialGradient>
          </defs>
          <circle cx="100" cy="100" r="98" fill="url(#globe-sea)" style={{ filter: 'drop-shadow(0 8px 20px rgb(var(--accent2) / 0.55))' }} />
          <path d={path(geoGraticule10()) ?? ''} fill="none" stroke="white" strokeOpacity="0.12" strokeWidth="0.5" />
          {world?.map((c, i) => (
            <path key={`${c.id}-${i}`} d={path(c.f) ?? ''} fill={active.has(c.id) ? '#c084fc' : 'white'} fillOpacity={active.has(c.id) ? 1 : 0.55} stroke={active.has(c.id) ? '#f0abfc' : 'none'} strokeWidth="0.6" />
          ))}
          <circle cx="100" cy="100" r="98" fill="none" stroke="white" strokeOpacity="0.35" />
        </svg>
        <dl className="space-y-3">
          {[[coverage.markets, 'Markets', `${coverage.liveMarkets} live`], [coverage.vendors, 'Suppliers', `${coverage.activeVendors} active`], [coverage.clients, 'Clients', '']].map(([v, l, s]) => (
            <div key={l as string}>
              <dt className="sr-only">{l}</dt>
              <dd className="text-2xl font-bold leading-none tabular-nums">{v}</dd>
              <div className="text-sm">{l}{s && <span className="ml-1 text-xs text-muted">· {s}</span>}</div>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}

// ─── Revenue vs cost donut ───
const amt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
export function BudgetDonut({ revenue, cost, currency, missing }: { revenue: number; cost: number; currency: string; missing: string[] }) {
  const profit = revenue - cost;
  const total = Math.max(revenue, cost, 0);
  const c = 2 * Math.PI * 70;
  const costShare = total ? Math.min(1, cost / total) : 0;
  const margin = revenue ? Math.round((profit / revenue) * 1000) / 10 : null;
  return (
    <Panel title="Revenue vs cost" icon={<BarChart3 className="h-4 w-4 text-brand" aria-hidden />}>
      <div className="flex flex-wrap items-center gap-4">
        <svg viewBox="0 0 180 180" className="w-[150px] shrink-0" role="img" aria-label={`Revenue ${currency} ${amt.format(revenue)}, cost ${amt.format(cost)}`}>
          <defs>
            <linearGradient id="bd-rest" x1="0" x2="1"><stop offset="0%" stopColor="#22d3ee" /><stop offset="100%" stopColor="#4ade80" /></linearGradient>
            <linearGradient id="bd-cost" x1="0" x2="1"><stop offset="0%" stopColor="#8b5cf6" /><stop offset="100%" stopColor="#ec4899" /></linearGradient>
          </defs>
          <circle cx="90" cy="90" r="70" fill="none" stroke="rgb(var(--sunken))" strokeWidth="18" />
          {total > 0 && <circle cx="90" cy="90" r="70" fill="none" stroke="url(#bd-rest)" strokeWidth="18" strokeDasharray={`${c} ${c}`} transform="rotate(-90 90 90)" />}
          {total > 0 && <circle cx="90" cy="90" r="70" fill="none" stroke="url(#bd-cost)" strokeWidth="18" strokeLinecap="round" strokeDasharray={`${c * costShare} ${c}`} transform="rotate(-90 90 90)" />}
          <text x="90" y="88" textAnchor="middle" fontSize="20" fontWeight="800" fill="rgb(var(--ink))">{amt.format(revenue)}</text>
          <text x="90" y="106" textAnchor="middle" fontSize="10" fill="rgb(var(--muted))">{currency} revenue</text>
        </svg>
        <ul className="min-w-0 space-y-2 text-sm">
          <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-[#8b5cf6] to-[#ec4899]" />Cost <span className="ml-auto pl-3 tabular-nums">{amt.format(cost)}</span></li>
          <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-[#22d3ee] to-[#4ade80]" />Profit <span className={clsx('ml-auto pl-3 tabular-nums', profit < 0 && 'text-bad')}>{amt.format(profit)}</span></li>
          <li className="flex items-center gap-2 text-muted"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />Margin <span className="ml-auto pl-3 tabular-nums text-ink">{margin == null ? '–' : `${margin}%`}</span></li>
          {missing.length > 0 && <li className="text-xs text-warn">{missing.join(', ')} left out: no exchange rate</li>}
        </ul>
      </div>
    </Panel>
  );
}

// ─── Supplier performance ───
const SUP = ['from-[#a855f7] to-[#6d28d9]', 'from-[#60a5fa] to-[#2563eb]', 'from-[#2dd4bf] to-[#0891b2]', 'from-[#4ade80] to-[#16a34a]', 'from-[#fcd34d] to-[#f59e0b]', 'from-[#f472b6] to-[#db2777]'];
export function SupplierBars({ suppliers }: { suppliers: Board['suppliers'] }) {
  return (
    <Panel title="Supplier performance" action={<Link href="/vendors" className="text-xs text-brand hover:underline">Scores</Link>}>
      {suppliers.length === 0 ? <Empty>Vendor scores appear after enough traffic.</Empty> : (
        <div className="flex h-44 items-end justify-around gap-2 border-b border-line pb-0">
          {suppliers.map((s, i) => (
            <Link key={s.id} href={`/vendors/${s.id}`} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${s.name}: ${s.score}/100${s.grade ? ` (grade ${s.grade})` : ''}`}>
              <span className="text-xs font-bold tabular-nums">{s.score}</span>
              <span className={clsx('w-full max-w-[44px] rounded-t-xl bg-gradient-to-b shadow-md transition-transform group-hover:-translate-y-0.5', SUP[i % SUP.length])} style={{ height: `${Math.max(6, s.score)}%` }} />
            </Link>
          ))}
        </div>
      )}
      {suppliers.length > 0 && (
        <div className="mt-1 flex justify-around gap-2">{suppliers.map((s) => <span key={s.id} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted" title={s.name}>{s.code || s.name}</span>)}</div>
      )}
    </Panel>
  );
}

// ─── Quick actions ───
export function QuickActions({ canEdit }: { canEdit: boolean }) {
  const actions = [
    ...(canEdit ? [{ href: '/projects/new', label: 'New project', icon: Plus, tone: 'tone-violet' }] : []),
    { href: '/monitor', label: 'Fieldwork', icon: FilePlus2, tone: 'tone-amber' },
    { href: '/vendors', label: 'Vendor scores', icon: Users, tone: 'tone-blue' },
    { href: '/won-bids', label: 'Won bids', icon: Truck, tone: 'tone-pink' },
    { href: '/reports', label: 'Reports', icon: BarChart3, tone: 'tone-cyan' },
    { href: '/invoices', label: 'Invoices', icon: ReceiptText, tone: 'tone-red' },
    { href: '/tasks', label: 'Tasks', icon: ListChecks, tone: 'tone-green' },
    { href: '/copilot', label: 'AI insights', icon: Sparkles, tone: 'tone-brand' },
  ].slice(0, 8);
  return (
    <Panel title="Quick actions">
      <div className="grid grid-cols-4 gap-2">
        {actions.map((a) => (
          <Link key={a.href} href={a.href} className="group flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-panel/60 p-2 text-center text-[11px] font-medium leading-tight transition-colors hover:border-brand/40 hover:bg-brand/5">
            <span className={clsx('icon-tile h-9 w-9 rounded-xl transition-transform group-hover:scale-105', a.tone)}><a.icon className="h-4 w-4" aria-hidden /></span>
            {a.label}
          </Link>
        ))}
      </div>
    </Panel>
  );
}
