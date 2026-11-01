'use client';
import clsx from 'clsx';
import { RefreshCw, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { AlertsList, MarketsTable, type AlertRow, type MonitorData } from '@/components/monitor/monitor-view';
import { ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { get, post } from '@/lib/api';

const VIEWS = [['ACTIVE', 'Active'], ['RESOLVED', 'Resolved']] as const;

export default function MonitorPage() {
  const me = useMe();
  const editable = canEdit(me);
  const [data, setData] = useState<MonitorData | null>(null);
  const [view, setView] = useState<'ACTIVE' | 'RESOLVED'>('ACTIVE');
  const [resolved, setResolved] = useState<AlertRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState<string | null>(null);

  const load = useCallback(() => get<MonitorData>('/monitor').then(setData).catch(setError), []);
  const loadResolved = useCallback(() => get<AlertRow[]>('/alerts?state=RESOLVED').then(setResolved).catch(setError), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (view === 'RESOLVED') loadResolved();
  }, [view, loadResolved]);

  const reload = () => {
    load();
    if (view === 'RESOLVED') loadResolved();
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await post<{ opened: number; updated: number; resolved: number; actions: string[] }>('/monitor/run');
      setRan(`${r.opened} new, ${r.resolved} cleared${r.actions.length ? `, ${r.actions.length} autopilot action${r.actions.length === 1 ? '' : 's'}` : ''}`);
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setRunning(false);
    }
  };

  const counts = useMemo(() => {
    const m = data?.markets ?? [];
    return {
      markets: m.length,
      onTrack: m.filter((x) => x.pace.status === 'on_track' || x.pace.status === 'done').length,
      atRisk: m.filter((x) => ['behind', 'overdue', 'stalled'].includes(x.pace.status)).length,
      critical: (data?.alerts ?? []).filter((a) => a.severity === 'bad').length,
    };
  }, [data]);

  return (
    <>
      <PageHeader
        title="Fieldwork monitor"
        subtitle="Pace, incidence, LOI and vendor quality for every live market, checked every five minutes."
        actions={
          <>
            {me?.user.role === 'ADMIN' && <Link href="/settings#alerts" className="btn-ghost"><Settings2 className="h-4 w-4" /> Thresholds</Link>}
            {editable && <button className="btn-primary" onClick={run} disabled={running}><RefreshCw className={clsx('h-4 w-4', running && 'animate-spin')} /> Check now</button>}
          </>
        }
      />
      <ErrorBox error={error} />
      {!data ? <Loading label="Loading fieldwork" /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Live markets', counts.markets, ''],
              ['On track or done', counts.onTrack, 'text-ok'],
              ['Behind or stalled', counts.atRisk, counts.atRisk ? 'text-warn' : ''],
              ['Critical alerts', counts.critical, counts.critical ? 'text-bad' : ''],
            ].map(([label, v, tone]) => (
              <div key={label as string} className="card p-4">
                <div className="text-xs text-muted">{label}</div>
                <div className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone as string)}>{v}</div>
              </div>
            ))}
          </div>

          <Section
            title="Alerts"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {ran && <span className="text-xs text-muted" role="status">Checked: {ran}</span>}
                <div className="flex rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="Alert view">
                  {VIEWS.map(([k, label]) => (
                    <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={clsx('rounded-md px-3 py-1 text-xs', view === k ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>
                      {label}{k === 'ACTIVE' ? ` (${data.alerts.length})` : ''}
                    </button>
                  ))}
                </div>
              </div>
            }
          >
            {view === 'ACTIVE' ? <AlertsList alerts={data.alerts} editable={editable} onChange={reload} /> : !resolved ? <Loading /> : <AlertsList alerts={resolved} editable={editable} onChange={reload} />}
          </Section>

          <Section title="Live markets" actions={<span className="text-xs text-muted">Updated {new Date(data.generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>}>
            <MarketsTable markets={data.markets} editable={editable} onChange={reload} settings={data.settings} />
          </Section>
        </div>
      )}
    </>
  );
}
