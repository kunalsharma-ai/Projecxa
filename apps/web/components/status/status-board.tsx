'use client';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, CircleSlash, Wrench } from 'lucide-react';

/** The public status page (docs/STATUS_PAGE.md): also shown as a preview in Super Admin → Status page. */
export type Health = 'up' | 'degraded' | 'down' | 'maintenance';
export interface DayStat { date: string; uptime: number | null; minutes: number; downMinutes: number; degradedMinutes: number }
export interface StatusComponent { key: string; label: string; description: string; status: Health; uptime90: number | null; downMinutes90: number; days: DayStat[] }
export interface IncidentUpdate { at: string; state: string; message: string; by?: string }
export interface Incident { id: string; title: string; impact: 'minor' | 'major' | 'maintenance'; state: string; components: string[]; updates: IncidentUpdate[]; startsAt: string; endsAt: string | null; resolvedAt: string | null; createdAt: string }
export interface StatusPage {
  title: string; intro: string; overall: 'operational' | 'degraded' | 'outage' | 'maintenance'; components: StatusComponent[];
  incidents: { active: Incident[]; upcoming: Incident[]; recent: Incident[] }; checkedAt: string;
}

export const STATE_LABEL: Record<string, string> = {
  investigating: 'Investigating', identified: 'Cause found', monitoring: 'Fixed, watching', resolved: 'Resolved',
  scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed',
};
export const IMPACT_LABEL: Record<Incident['impact'], string> = { minor: 'Some things slow or failing', major: 'Down for many people', maintenance: 'Planned maintenance' };

const OVERALL = {
  operational: { text: 'Everything is working', icon: CheckCircle2, cls: 'bg-ok text-white' },
  degraded: { text: 'Some things are slow or not working', icon: AlertTriangle, cls: 'bg-warn text-white' },
  outage: { text: 'SampTrek is having problems', icon: CircleSlash, cls: 'bg-bad text-white' },
  maintenance: { text: 'Planned maintenance in progress', icon: Wrench, cls: 'bg-info text-white' },
} as const;
const HEALTH = {
  up: { text: 'Working', cls: 'text-ok' },
  degraded: { text: 'Slow or partly working', cls: 'text-warn' },
  down: { text: 'Not working', cls: 'text-bad' },
  maintenance: { text: 'Maintenance', cls: 'text-info' },
} as const;

const fmt = (d: string) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const minutes = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

function barClass(d: DayStat) {
  if (d.uptime === null) return 'bg-line';
  if (d.uptime < 99) return 'bg-bad';
  if (d.uptime < 99.9 || d.degradedMinutes > 30) return 'bg-warn';
  return 'bg-ok';
}

export function StatusBoard({ page, showDays = 90 }: { page: StatusPage; showDays?: number }) {
  const o = OVERALL[page.overall];
  return (
    <div className="space-y-6">
      <div className={clsx('flex items-center gap-3 rounded-xl px-5 py-4 text-base font-semibold shadow-sm', o.cls)} role="status">
        <o.icon className="h-6 w-6 shrink-0" />{o.text}
        <span className="ml-auto hidden text-xs font-normal opacity-90 sm:inline">Checked {fmt(page.checkedAt)}</span>
      </div>

      {page.incidents.active.map((i) => <IncidentCard key={i.id} i={i} components={page.components} />)}
      {page.incidents.upcoming.map((i) => <IncidentCard key={i.id} i={i} components={page.components} />)}

      <div className="card divide-y divide-line">
        {page.components.map((c) => {
          const h = HEALTH[c.status];
          const days = c.days.slice(-showDays);
          return (
            <div key={c.key} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <div className="font-medium">{c.label}</div>
                  <div className="text-xs text-muted">{c.description}</div>
                </div>
                <div className={clsx('text-sm font-medium', h.cls)}>{h.text}</div>
              </div>
              <div className="mt-3 flex h-8 items-stretch gap-px" aria-label={`Uptime of ${c.label} over the last ${days.length} days`}>
                {days.map((d) => (
                  <span key={d.date} className={clsx('min-w-0 flex-1 rounded-[2px]', barClass(d))}
                    title={d.uptime === null ? `${day(d.date)}: no data` : `${day(d.date)}: ${d.uptime}% up${d.downMinutes ? `, down ${minutes(d.downMinutes)}` : ''}${d.degradedMinutes ? `, slow ${minutes(d.degradedMinutes)}` : ''}`} />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-muted">
                <span>{days.length} days ago</span>
                <span>{c.uptime90 === null ? 'No data yet' : `${c.uptime90}% uptime`}</span>
                <span>Today</span>
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold">Past incidents (14 days)</h2>
        {page.incidents.recent.length === 0 ? <p className="text-sm text-muted">No incidents in the last 14 days.</p> : (
          <div className="space-y-3">{page.incidents.recent.map((i) => <IncidentCard key={i.id} i={i} components={page.components} />)}</div>
        )}
      </div>
    </div>
  );
}

export function IncidentCard({ i, components }: { i: Incident; components: { key: string; label: string }[] }) {
  const tone = i.resolvedAt ? 'border-line' : i.impact === 'major' ? 'border-bad/60' : i.impact === 'minor' ? 'border-warn/60' : 'border-info/60';
  const names = i.components.map((k) => components.find((c) => c.key === k)?.label ?? k);
  return (
    <div className={clsx('card border-l-4 p-4', tone)}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{i.title}</h3>
        <span className={clsx('chip', i.resolvedAt ? 'bg-ok/15 text-ok' : i.impact === 'major' ? 'bg-bad/15 text-bad' : i.impact === 'minor' ? 'bg-warn/15 text-warn' : 'bg-info/15 text-info')}>{STATE_LABEL[i.state] ?? i.state}</span>
      </div>
      <div className="mt-0.5 text-xs text-muted">
        {i.impact === 'maintenance' ? `${fmt(i.startsAt)}${i.endsAt ? ` to ${fmt(i.endsAt)}` : ''}` : `Since ${fmt(i.startsAt)}${i.resolvedAt ? `, resolved ${fmt(i.resolvedAt)}` : ''}`}
        {names.length > 0 && ` · ${names.join(', ')}`}
      </div>
      <ol className="mt-3 space-y-2 border-l border-line pl-3">
        {[...i.updates].reverse().map((u, n) => (
          <li key={n} className="text-sm">
            <span className="font-medium">{STATE_LABEL[u.state] ?? u.state}</span> <span className="text-xs text-muted">{fmt(u.at)}</span>
            <p className="whitespace-pre-line text-muted">{u.message}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
