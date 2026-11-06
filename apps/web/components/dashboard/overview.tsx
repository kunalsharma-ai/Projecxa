'use client';
import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, Building2, CheckCircle2, FlaskConical, FolderKanban, Minus, PauseCircle, PlayCircle, Truck, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

type Trend = number | null;
export interface SnapshotPeriod {
  id: 'today' | 'yesterday' | 'week' | 'month';
  label: string;
  from: string;
  to: string;
  compare: string;
  clicks: number;
  completes: number;
  conversion: number | null;
  revenue: number;
  cost: number;
  profit: number;
  missing: string[];
  trend: { clicks: Trend; completes: Trend; revenue: Trend };
}
export interface Snapshot {
  currency: string;
  projects: { all: number; live: number; test: number; hold: number; closed: number; draft: number; invoiced: number };
  clients: { total: number; active: number };
  vendors: { total: number; active: number };
  periods: SnapshotPeriod[];
}

const num = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const amt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Change({ value, label }: { value: Trend; label: string }) {
  if (value == null) return null;
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return (
    <span className={clsx('inline-flex items-center text-[11px] font-medium', value > 0 ? 'text-ok' : value < 0 ? 'text-bad' : 'text-muted')} title={`${value > 0 ? '+' : ''}${value}% ${label}`}>
      <Icon className="h-3 w-3" aria-hidden />{Math.abs(value)}%
      <span className="sr-only"> {value > 0 ? 'up' : value < 0 ? 'down' : 'no change'} {label}</span>
    </span>
  );
}

function Stat({ href, label, value, sub, icon: Icon, tone }: { href: string; label: string; value: number; sub?: string; icon: LucideIcon; tone: string }) {
  return (
    <Link href={href} className="group flex min-w-0 items-center gap-3 rounded-xl border border-line bg-panel p-3 transition-colors hover:border-brand/50 hover:bg-sunken/40">
      <span className={clsx('icon-tile h-9 w-9 shrink-0 rounded-lg', tone)}><Icon className="h-4 w-4" aria-hidden /></span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold leading-tight tabular-nums">{num.format(value)}</span>
        <span className="block truncate text-xs font-medium text-muted">{label}</span>
        {sub && <span className="block truncate text-[11px] text-muted">{sub}</span>}
      </span>
    </Link>
  );
}

/**
 * The dashboard's simple overview: how many projects in each state, how many clients and vendors, and
 * clicks / completes / revenue for today, yesterday, the last 7 days and this month. Everything links to
 * the list or report behind it. Detailed charts live below it (see app/(app)/page.tsx).
 */
export function Overview({ s }: { s: Snapshot }) {
  const p = s.projects;
  return (
    <div className="space-y-4" data-tour="overview">
      <div className="grid gap-4 xl:grid-cols-[5fr_2fr]">
        <section className="card p-4" aria-labelledby="ov-projects">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="ov-projects" className="text-sm font-semibold">Projects</h2>
            <Link href="/projects" className="text-xs text-brand hover:underline">All projects</Link>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Stat href="/projects" label="All projects" value={p.all} sub={[p.draft && `${num.format(p.draft)} draft`, p.invoiced && `${num.format(p.invoiced)} invoiced`].filter(Boolean).join(' · ') || undefined} icon={FolderKanban} tone="tone-violet" />
            <Stat href="/projects?status=LIVE" label="Live" value={p.live} icon={PlayCircle} tone="tone-green" />
            <Stat href="/projects?status=TEST" label="Test" value={p.test} icon={FlaskConical} tone="tone-cyan" />
            <Stat href="/projects?status=HOLD" label="On hold" value={p.hold} icon={PauseCircle} tone="tone-amber" />
            <Stat href="/projects?status=CLOSED" label="Closed" value={p.closed} icon={CheckCircle2} tone="tone-red" />
          </div>
        </section>
        <section className="card p-4" aria-labelledby="ov-network">
          <h2 id="ov-network" className="mb-3 text-sm font-semibold">Clients and vendors</h2>
          <div className="grid grid-cols-2 gap-2">
            <Stat href="/clients" label="Clients" value={s.clients.total} sub={`${num.format(s.clients.active)} active`} icon={Building2} tone="tone-blue" />
            <Stat href="/vendors" label="Vendors" value={s.vendors.total} sub={`${num.format(s.vendors.active)} active`} icon={Truck} tone="tone-pink" />
          </div>
        </section>
      </div>

      <section className="card p-4" aria-labelledby="ov-traffic">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="ov-traffic" className="text-sm font-semibold">Clicks, completes and revenue</h2>
          <span className="text-xs text-muted">Live traffic only · days in UTC · money in {s.currency}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {s.periods.map((w) => (
            <Link
              key={w.id}
              href={`/reports?from=${w.from}&to=${w.to}`}
              className="flex min-w-0 flex-col rounded-xl border border-line bg-panel p-3 transition-colors hover:border-brand/50 hover:bg-sunken/40"
              aria-label={`${w.label}: ${num.format(w.clicks)} clicks, ${num.format(w.completes)} completes, ${s.currency} ${amt.format(w.revenue)} revenue. Open the report`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{w.label}</span>
                <span className="text-[11px] text-muted">{w.from === w.to ? short(w.from) : `${short(w.from)} – ${short(w.to)}`}</span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2">
                <div className="min-w-0">
                  <dt className="text-[11px] text-muted">Clicks</dt>
                  <dd className="truncate text-lg font-bold tabular-nums">{num.format(w.clicks)}</dd>
                  <dd><Change value={w.trend.clicks} label={w.compare} /></dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[11px] text-muted">Completes</dt>
                  <dd className="truncate text-lg font-bold tabular-nums">{num.format(w.completes)}</dd>
                  <dd><Change value={w.trend.completes} label={w.compare} /></dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[11px] text-muted">Revenue</dt>
                  <dd className="truncate text-lg font-bold tabular-nums" title={`${s.currency} ${amt.format(w.revenue)}`}>{amt.format(w.revenue)}</dd>
                  <dd><Change value={w.trend.revenue} label={w.compare} /></dd>
                </div>
              </dl>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 border-t border-line pt-2 text-[11px] tabular-nums text-muted">
                <span>Conversion <b className="font-semibold text-ink">{w.conversion == null ? '–' : `${w.conversion}%`}</b></span>
                <span>Cost <b className="font-semibold text-ink">{amt.format(w.cost)}</b></span>
                <span>Profit <b className={clsx('font-semibold', w.profit < 0 ? 'text-bad' : 'text-ink')}>{amt.format(w.profit)}</b></span>
              </div>
              {w.missing.length > 0 && <span className="mt-1 text-[11px] text-warn">No exchange rate for {w.missing.join(', ')}: left out of money</span>}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
