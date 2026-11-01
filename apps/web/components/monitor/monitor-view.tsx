'use client';
import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronRight, Info, Pause, Play } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { Empty, ErrorBox, Progress, StatusChip } from '@/components/ui';
import { patch, post } from '@/lib/api';
import { flag } from '@/lib/countries';

export type PaceStatus = 'done' | 'on_track' | 'slightly_behind' | 'behind' | 'overdue' | 'stalled' | 'not_started' | 'no_deadline';
export interface Pace { status: PaceStatus; perDay: number; requiredPerDay: number | null; remaining: number; etaDays: number | null; daysLeft: number | null }
export interface Metrics { target: number; completes: number; terminates: number; entries24h: number; quality24h: number; dropped24h: number; completes72h: number; firstEntryAt: string | null; lastEntryAt: string | null; medianLoiMinutes: number | null }
export interface MarketView {
  project: { id: string; projectCode: string; name: string; status: string; fieldStartAt: string | null; fieldEndAt: string | null };
  country: { id: string; countryCode: string; status: string; irPercent: number; loiMinutes: number; currency: string };
  metrics: Metrics;
  pace: Pace;
  ir: number | null;
  allocations: { id: string; vendor: { id: string; name: string; code: string }; status: string; metrics: Metrics; pace: Pace; qualityShare24h: number | null; dropShare24h: number | null }[];
}
export interface AlertRow {
  id: string; rule: string; severity: 'info' | 'warn' | 'bad'; title: string; detail: string; state: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  autoAction: string | null; webhookStatus: string | null; firstSeenAt: string; lastSeenAt: string; acknowledgedAt: string | null; resolvedAt: string | null;
  acknowledgedBy: string | null; resolvedByName: string | null;
  project: { id: string; projectCode: string; name: string } | null;
}
export interface MonitorData { generatedAt: string; markets: MarketView[]; alerts: AlertRow[]; settings: Record<string, number> }

const PACE: Record<PaceStatus, { label: string; tone: string }> = {
  done: { label: 'Done', tone: 'bg-ok/15 text-ok' },
  on_track: { label: 'On track', tone: 'bg-ok/15 text-ok' },
  slightly_behind: { label: 'Slightly behind', tone: 'bg-warn/15 text-warn' },
  behind: { label: 'Behind', tone: 'bg-bad/15 text-bad' },
  overdue: { label: 'Overdue', tone: 'bg-bad/15 text-bad' },
  stalled: { label: 'Stalled', tone: 'bg-warn/15 text-warn' },
  not_started: { label: 'Not started', tone: 'bg-sunken text-muted' },
  no_deadline: { label: 'No end date', tone: 'bg-info/15 text-info' },
};
export function PaceChip({ status }: { status: PaceStatus }) {
  const p = PACE[status];
  return <span className={clsx('chip whitespace-nowrap', p.tone)}>{p.label}</span>;
}

const SEV = {
  bad: { icon: AlertOctagon, tone: 'text-bad', ring: 'border-l-bad', label: 'Critical' },
  warn: { icon: AlertTriangle, tone: 'text-warn', ring: 'border-l-warn', label: 'Warning' },
  info: { icon: Info, tone: 'text-info', ring: 'border-l-info', label: 'Info' },
} as const;

const ago = (d: string | null) => {
  if (!d) return '–';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
const days = (n: number | null) => (n == null ? '–' : n === 0 ? 'now' : n < 1 ? `${Math.round(n * 24)}h` : `${n}d`);

/** Alert cards with acknowledge and resolve. */
export function AlertsList({ alerts, editable, onChange, showProject = true }: { alerts: AlertRow[]; editable: boolean; onChange: () => void; showProject?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const act = async (id: string, what: 'acknowledge' | 'resolve') => {
    setBusy(id);
    setError(null);
    try {
      await post(`/alerts/${id}/${what}`);
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  if (!alerts.length) return <Empty>No alerts. Fieldwork looks healthy.</Empty>;
  return (
    <div className="space-y-2">
      <ErrorBox error={error} />
      {alerts.map((a) => {
        const s = SEV[a.severity];
        const Icon = s.icon;
        return (
          <article key={a.id} className={clsx('rounded-lg border border-l-4 border-line bg-panel p-3', s.ring, a.state === 'RESOLVED' && 'opacity-75')}>
            <div className="flex flex-wrap items-start gap-3">
              <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', s.tone)} aria-label={s.label} />
              <div className="min-w-0 flex-1 basis-[calc(100%-2rem)] sm:basis-0">
                <div className="font-medium">{a.title}</div>
                <p className="mt-0.5 text-sm text-muted">{a.detail}</p>
                {a.autoAction && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-brand"><Bot className="h-3.5 w-3.5" /> Autopilot: {a.autoAction}</p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  {showProject && a.project && <Link href={`/projects/${a.project.id}`} className="font-mono hover:text-brand hover:underline">{a.project.projectCode}</Link>}
                  <span>First seen {ago(a.firstSeenAt)}</span>
                  {a.lastSeenAt !== a.firstSeenAt && a.state !== 'RESOLVED' && <span>still true {ago(a.lastSeenAt)}</span>}
                  {a.state === 'ACKNOWLEDGED' && <span>Acknowledged by {a.acknowledgedBy ?? 'someone'}</span>}
                  {a.state === 'RESOLVED' && <span>Resolved {ago(a.resolvedAt)}{a.resolvedByName ? ` · ${a.resolvedByName}` : ''}</span>}
                  {a.webhookStatus && !/^2\d\d$/.test(a.webhookStatus) && <span className="text-warn">Webhook {a.webhookStatus}</span>}
                </div>
              </div>
              {editable && a.state !== 'RESOLVED' && (
                <div className="ml-7 flex gap-1.5 sm:ml-0">
                  {a.state === 'OPEN' && <button className="btn-ghost px-2.5 py-1 text-xs" disabled={busy === a.id} onClick={() => act(a.id, 'acknowledge')}>Acknowledge</button>}
                  <button className="btn-ghost px-2.5 py-1 text-xs" disabled={busy === a.id} onClick={() => act(a.id, 'resolve')}><CheckCircle2 className="h-3.5 w-3.5" /> Resolve</button>
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** Live markets with pace, incidence and LOI; expand a row for its vendor links. */
export function MarketsTable({ markets, editable, onChange, showProject = true, settings }: { markets: MarketView[]; editable: boolean; onChange: () => void; showProject?: boolean; settings?: Record<string, number> }) {
  const irDrop = settings?.irDropPct ?? 30;
  const qualityPct = settings?.qualityPct ?? 25;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const toggle = async (m: MarketView, aid: string, status: string) => {
    setBusy(aid);
    setError(null);
    try {
      await patch(`/projects/${m.project.id}/countries/${m.country.id}/allocations/${aid}`, { status: status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' });
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  if (!markets.length) return <Empty>No live markets. Markets show here once a project is live.</Empty>;
  return (
    <>
      <ErrorBox error={error} />
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr>
              <th className="th">Market</th><th className="th">Pace</th><th className="th">Progress</th>
              <th className="th text-right" title="Completes per day over the last 3 days, against what is needed to finish by the field end date">Per day / needed</th>
              <th className="th text-right">ETA</th><th className="th text-right">IR / plan</th><th className="th text-right">LOI / plan</th>
              <th className="th text-right" title="Entries in the last 24 hours">24h entries</th><th className="th">Last entry</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => {
              const key = m.country.id;
              const loi = m.metrics.medianLoiMinutes;
              const lowIr = m.ir != null && m.ir < m.country.irPercent * (1 - irDrop / 100);
              return (
                <Fragment key={key}>
                  <tr className="border-t border-line hover:bg-sunken/50">
                    <td className="td">
                      <button className="flex items-center gap-1.5 text-left" aria-expanded={!!open[key]} onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
                        {open[key] ? <ChevronDown className="h-3.5 w-3.5 text-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-muted" />}
                        <span>{flag(m.country.countryCode)} {m.country.countryCode}</span>
                        {showProject && <span className="font-mono text-xs text-muted">{m.project.projectCode}</span>}
                      </button>
                      {showProject && <Link href={`/projects/${m.project.id}`} className="ml-5 block max-w-[220px] truncate text-xs text-muted hover:text-brand">{m.project.name}</Link>}
                    </td>
                    <td className="td"><PaceChip status={m.pace.status} />{m.country.status !== 'LIVE' && <div className="mt-1"><StatusChip status={m.country.status} /></div>}</td>
                    <td className="td"><Progress value={m.metrics.completes} max={m.metrics.target} /></td>
                    <td className="td text-right tabular-nums">{m.pace.perDay} <span className="text-muted">/ {m.pace.requiredPerDay ?? '–'}</span></td>
                    <td className="td text-right tabular-nums">{days(m.pace.etaDays)}{m.pace.daysLeft != null && <div className="text-xs text-muted">{m.pace.daysLeft > 0 ? `${days(m.pace.daysLeft)} left` : 'ended'}</div>}</td>
                    <td className={clsx('td text-right tabular-nums', lowIr && 'text-bad')}>{m.ir ?? '–'}{m.ir != null && '%'} <span className="text-muted">/ {m.country.irPercent}%</span></td>
                    <td className="td text-right tabular-nums">{loi != null ? Math.round(loi * 10) / 10 : '–'} <span className="text-muted">/ {m.country.loiMinutes}</span></td>
                    <td className="td text-right tabular-nums">{m.metrics.entries24h}</td>
                    <td className="td whitespace-nowrap text-muted">{ago(m.metrics.lastEntryAt)}</td>
                  </tr>
                  {open[key] && (
                    <tr className="bg-sunken/40">
                      <td colSpan={9} className="px-4 pb-3 pt-1">
                        {m.allocations.length === 0 ? <p className="py-2 text-sm text-muted">No vendor links in this market.</p> : (
                          <table className="w-full text-sm">
                            <thead><tr><th className="th">Vendor link</th><th className="th">Status</th><th className="th">Progress</th><th className="th text-right">Per day</th><th className="th text-right" title="Share of the last 24h entries rejected for quality, duplicates or security">Quality rejects 24h</th><th className="th text-right">Drop-out 24h</th><th className="th">Last entry</th>{editable && <th className="th" />}</tr></thead>
                            <tbody>
                              {m.allocations.map((a) => (
                                <tr key={a.id} className="border-t border-line">
                                  <td className="td">{a.vendor.name} <span className="font-mono text-xs text-muted">{a.vendor.code}</span></td>
                                  <td className="td"><StatusChip status={a.status} /></td>
                                  <td className="td"><Progress value={a.metrics.completes} max={a.metrics.target} /></td>
                                  <td className="td text-right tabular-nums">{a.pace.perDay}</td>
                                  <td className={clsx('td text-right tabular-nums', (a.qualityShare24h ?? 0) >= qualityPct && 'font-medium text-bad')}>{a.qualityShare24h == null ? '–' : `${a.qualityShare24h}%`} <span className="text-xs text-muted">of {a.metrics.entries24h}</span></td>
                                  <td className="td text-right tabular-nums">{a.dropShare24h == null ? '–' : `${a.dropShare24h}%`}</td>
                                  <td className="td text-muted">{ago(a.metrics.lastEntryAt)}</td>
                                  {editable && (
                                    <td className="td text-right">
                                      {a.status !== 'CLOSED' && (
                                        <button className="btn-ghost px-2.5 py-1 text-xs" disabled={busy === a.id} onClick={() => toggle(m, a.id, a.status)}>
                                          {a.status === 'ACTIVE' ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Activate</>}
                                        </button>
                                      )}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
