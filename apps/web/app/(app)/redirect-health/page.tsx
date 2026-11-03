'use client';
import clsx from 'clsx';
import { Activity, CheckCircle2, CircleAlert, Link2, RefreshCw, Send, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { Empty, ErrorBox, Loading, OutcomeChip, PageHeader, Section } from '@/components/ui';
import { get, post } from '@/lib/api';

type Health = 'healthy' | 'watch' | 'failing' | 'idle';
type WindowKey = '1h' | '24h' | '7d';

interface ProjectRow {
  project: { id: string; projectCode: string; name: string; status: string; redirectMode: string };
  entries: number;
  redirects: number;
  fallbacks: number;
  blocked: number;
  apiFallbacks: number;
  p50Ms: number | null;
  p95Ms: number | null;
  expired: number;
  gateDropped: number;
  callbacksDelivered: number;
  callbacksRetrying: number;
  callbacksDead: number;
  lastRedirectAt: string | null;
  health: Health;
  reasons: string[];
}

interface HealthData {
  window: { key: WindowKey; from: string; to: string; bucketMinutes: number };
  thresholds: { fallbackWatch: number; fallbackFail: number; minRedirects: number; p95WatchMs: number; p95FailMs: number; noReturnWatch: number; minExpired: number };
  health: Health;
  reasons: string[];
  totals: { entries: number; redirects: number; fallbacks: number; blocked: number; apiFallbacks: number; expired: number; gateDropped: number; p95Ms: number | null; callbacksDelivered: number; callbacksRetrying: number; callbacksDead: number };
  previous: { redirects: number; fallbacks: number; p95Ms: number | null };
  outcomes: { status: string; count: number }[];
  series: { at: string; ok: number; fallback: number }[];
  fallbackReasons: ReasonRow[];
  projects: ProjectRow[];
  callbackHosts: { host: string; delivered: number; failing: number; pending: number; lastError: string | null; lastStatusCode: number | null }[];
  callbackProblems: { id: string; state: string; url: string; attempts: number; lastStatusCode: number | null; lastError: string | null; updatedAt: string; nextAttemptAt: string; targetType: string; project: { id: string; projectCode: string } | null }[];
}
type ReasonRow = { reason: string; example: string; count: number; lastAt: string; projects: { id: string; projectCode: string }[] };

interface LinkCheck { projectCountryId: string; projectId: string; projectCode: string; countryCode: string; language: string; ok: boolean; status: number | null; ms: number; detail: string }

const WINDOWS: [WindowKey, string][] = [['1h', 'Last hour'], ['24h', '24 hours'], ['7d', '7 days']];
const HEALTH: Record<Health, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  healthy: { label: 'Healthy', tone: 'bg-ok/15 text-ok', icon: CheckCircle2 },
  watch: { label: 'Watch', tone: 'bg-warn/15 text-warn', icon: TriangleAlert },
  failing: { label: 'Failing', tone: 'bg-bad/15 text-bad', icon: CircleAlert },
  idle: { label: 'No traffic', tone: 'bg-sunken text-muted', icon: Activity },
};
const CB_STATE: Record<string, string> = { DEAD_LETTER: 'Gave up', FAILED: 'Failed', RETRY_SCHEDULED: 'Retrying' };

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '–');
const ms = (v: number | null) => (v === null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function HealthChip({ health }: { health: Health }) {
  const h = HEALTH[health];
  const Icon = h.icon;
  return <span className={clsx('chip inline-flex items-center gap-1', h.tone)}><Icon className="h-3.5 w-3.5" aria-hidden />{h.label}</span>;
}

export default function RedirectHealthPage() {
  const me = useMe();
  const editable = canEdit(me);
  const [win, setWin] = useState<WindowKey>('24h');
  const [projectId, setProjectId] = useState('');
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [checks, setChecks] = useState<LinkCheck[] | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('project')) setProjectId(q.get('project')!);
    const w = q.get('window');
    if (w === '1h' || w === '24h' || w === '7d') setWin(w);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await get<HealthData>(`/redirect-health?window=${win}${projectId ? `&projectId=${projectId}` : ''}`));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [win, projectId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const q = new URLSearchParams();
    if (projectId) q.set('project', projectId);
    if (win !== '24h') q.set('window', win);
    window.history.replaceState(null, '', `/redirect-health${q.size ? `?${q}` : ''}`);
  }, [win, projectId]);

  const runChecks = async () => {
    setChecking(true);
    try {
      setChecks(await post<LinkCheck[]>(projectId ? `/redirect-health/check-links/${projectId}` : '/redirect-health/check-links'));
    } catch (e) {
      setError(e);
    } finally {
      setChecking(false);
    }
  };

  const replay = async (id: string) => {
    try {
      await post(`/callbacks/${id}/replay`);
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const projectOptions = useMemo(() => (data?.projects ?? []).map((p) => p.project), [data]);
  const [allProjects, setAllProjects] = useState<{ id: string; projectCode: string; name: string }[]>([]);
  useEffect(() => {
    if (!projectId && projectOptions.length) setAllProjects(projectOptions);
  }, [projectId, projectOptions]);

  return (
    <>
      <PageHeader
        title="Redirect health"
        subtitle="Are respondents reaching the right place? Redirects, fallbacks, vendor callbacks and client survey links, with test traffic left out."
        actions={
          <>
            <Link href="/monitor" className="btn-ghost"><Activity className="h-4 w-4" /> Fieldwork monitor</Link>
            {editable && <button className="btn-primary" onClick={runChecks} disabled={checking}><Link2 className={clsx('h-4 w-4', checking && 'animate-pulse')} /> {checking ? 'Checking links…' : 'Check survey links'}</button>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="Time window">
          {WINDOWS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={win === k} onClick={() => setWin(k)} className={clsx('rounded-md px-3 py-1 text-sm', win === k ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>{label}</button>
          ))}
        </div>
        <label className="sr-only" htmlFor="rh-project">Project</label>
        <select id="rh-project" className="input w-auto min-w-0 max-w-full py-1.5 text-sm" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">All projects</option>
          {allProjects.map((p) => <option key={p.id} value={p.id}>{p.projectCode} · {p.name}</option>)}
        </select>
        <button type="button" className="btn-ghost px-2.5 py-1.5 text-sm" onClick={load} disabled={loading} aria-label="Refresh"><RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} /></button>
        {data && <span className="text-xs text-muted">Updated {new Date(data.window.to).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · refreshes every minute</span>}
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading label="Loading redirect health" /> : (
        <div className="space-y-5">
          <Overall data={data} />
          {checks && <LinkChecks checks={checks} onClose={() => setChecks(null)} />}
          <Tiles data={data} />
          <Section title="Redirects over time" actions={<Legend />}>
            <Timeline series={data.series} windowKey={data.window.key} />
          </Section>
          <Section title={projectId ? 'Project' : `Projects (${data.projects.length})`}>
            <ProjectsTable rows={data.projects} />
          </Section>
          <div className="grid gap-5 xl:grid-cols-2">
            <Section title="Why redirects fell back">
              {data.fallbackReasons.length === 0 ? <Empty>No redirect fell back in this window.</Empty> : (
                <ul className="divide-y divide-line">
                  {data.fallbackReasons.map((r) => (
                    <li key={r.reason} className="flex items-start gap-3 py-2.5">
                      <span className="mt-0.5 min-w-[2.5rem] rounded-md bg-bad/10 px-1.5 py-0.5 text-center text-sm font-semibold tabular-nums text-bad">{r.count}</span>
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-sm">{r.example}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                          <span>Last {ago(r.lastAt)}</span>
                          {r.projects.map((p) => <Link key={p.id} className="text-brand hover:underline" href={`/projects/${p.id}?tab=redirects`}>{p.projectCode} redirects</Link>)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Outcomes routed">
              <Outcomes outcomes={data.outcomes} />
            </Section>
          </div>
          <Section title="Vendor callbacks">
            <Callbacks data={data} editable={editable} onReplay={replay} />
          </Section>
          <p className="text-xs text-muted">
            Failing: {Math.round(data.thresholds.fallbackFail * 100)}% or more of redirects fell back (at least {data.thresholds.minRedirects}), p95 redirect time over {data.thresholds.p95FailMs / 1000} s, or a vendor callback gave up.
            Watch: {Math.round(data.thresholds.fallbackWatch * 100)}% fell back, p95 over {data.thresholds.p95WatchMs} ms, callbacks retrying, or {Math.round(data.thresholds.noReturnWatch * 100)}% of respondents never came back from the survey.
          </p>
        </div>
      )}
    </>
  );
}

function Overall({ data }: { data: HealthData }) {
  const failing = data.projects.filter((p) => p.health === 'failing').length;
  const watch = data.projects.filter((p) => p.health === 'watch').length;
  const tone = data.health === 'failing' ? 'border-bad/30 bg-bad/10' : data.health === 'watch' ? 'border-warn/30 bg-warn/10' : data.health === 'healthy' ? 'border-ok/30 bg-ok/10' : 'border-line bg-panel';
  const all = data.reasons;
  return (
    <div className={clsx('rounded-xl border p-4', tone)} role="status">
      <div className="flex flex-wrap items-center gap-2">
        <HealthChip health={data.health} />
        <span className="font-medium">
          {data.health === 'idle' ? 'No respondent traffic in this window.' : failing ? `${failing} project${failing === 1 ? '' : 's'} failing${watch ? `, ${watch} to watch` : ''}` : watch ? `${watch} project${watch === 1 ? '' : 's'} to watch` : 'Every project is routing respondents normally.'}
        </span>
      </div>
      {all.length > 0 && <ul className="mt-2 ml-5 list-disc space-y-0.5 text-sm">{all.slice(0, 5).map((r) => <li key={r}>{r}</li>)}</ul>}
    </div>
  );
}

function Delta({ now, before, invert, fmt }: { now: number | null; before: number | null; invert?: boolean; fmt: (v: number) => string }) {
  if (now === null || before === null || !Number.isFinite(before)) return <span className="text-xs text-muted">no earlier data</span>;
  const d = now - before;
  if (Math.abs(d) < 1e-9) return <span className="text-xs text-muted">same as before</span>;
  const worse = invert ? d < 0 : d > 0;
  return <span className={clsx('text-xs', worse ? 'text-bad' : 'text-ok')}>{d > 0 ? '▲' : '▼'} {fmt(Math.abs(d))} vs previous</span>;
}

function Tiles({ data }: { data: HealthData }) {
  const t = data.totals;
  const rate = t.redirects ? t.fallbacks / t.redirects : 0;
  const tiles = [
    { label: 'Redirects', value: t.redirects.toLocaleString(), sub: <Delta now={t.redirects} before={data.previous.redirects || null} invert fmt={(v) => v.toLocaleString()} /> },
    { label: 'Fell back', value: pct(t.fallbacks, t.redirects), tone: rate >= data.thresholds.fallbackFail ? 'text-bad' : rate >= data.thresholds.fallbackWatch ? 'text-warn' : '', sub: <span className="text-xs text-muted">{t.fallbacks} redirects{t.apiFallbacks ? `, ${t.apiFallbacks} from API rules` : ''}</span> },
    { label: 'p95 redirect time', value: ms(t.p95Ms), tone: t.p95Ms !== null && t.p95Ms >= data.thresholds.p95FailMs ? 'text-bad' : t.p95Ms !== null && t.p95Ms >= data.thresholds.p95WatchMs ? 'text-warn' : '', sub: <Delta now={t.p95Ms} before={data.previous.p95Ms} fmt={(v) => ms(Math.round(v))} /> },
    { label: 'Never came back', value: pct(t.expired, t.entries), sub: <span className="text-xs text-muted">{t.expired} of {t.entries} entries{t.gateDropped ? `; ${t.gateDropped} left at the gate` : ''}</span> },
    { label: 'Vendor callbacks', value: `${t.callbacksDelivered}`, tone: t.callbacksDead ? 'text-bad' : '', sub: <span className={clsx('text-xs', t.callbacksDead ? 'text-bad' : 'text-muted')}>delivered{t.callbacksRetrying ? `, ${t.callbacksRetrying} pending` : ''}{t.callbacksDead ? `, ${t.callbacksDead} gave up` : ''}</span> },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {tiles.map((x) => (
        <div key={x.label} className="card min-w-0 p-4">
          <div className="text-xs text-muted">{x.label}</div>
          <div className={clsx('mt-1 text-2xl font-semibold tabular-nums', x.tone)}>{x.value}</div>
          <div className="mt-1">{x.sub}</div>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-brand" />Routed</span>
      <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-bad" />Fell back</span>
    </div>
  );
}

function Timeline({ series, windowKey }: { series: HealthData['series']; windowKey: WindowKey }) {
  const max = Math.max(1, ...series.map((s) => s.ok + s.fallback));
  const label = (iso: string) => {
    const d = new Date(iso);
    if (windowKey === '7d') return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };
  const every = windowKey === '24h' ? 4 : windowKey === '7d' ? 4 : 2;
  const total = series.reduce((a, s) => a + s.ok + s.fallback, 0);
  if (!total) return <Empty>No redirects in this window.</Empty>;
  return (
    <figure>
      <div className="flex h-40 items-end gap-[2px]" role="img" aria-label={`Redirects per ${windowKey === '1h' ? '5 minutes' : windowKey === '24h' ? 'hour' : '6 hours'}: ${total} in total`}>
        {series.map((s) => {
          const n = s.ok + s.fallback;
          return (
            <div key={s.at} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${label(s.at)}: ${s.ok} routed, ${s.fallback} fell back`}>
              <div className="rounded-t-sm bg-bad" style={{ height: `${(s.fallback / max) * 100}%` }} />
              <div className={clsx('bg-brand', !s.fallback && 'rounded-t-sm')} style={{ height: `${(s.ok / max) * 100}%`, minHeight: n ? 2 : 0 }} />
              {!n && <div className="h-px bg-line" />}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] text-muted">
        {series.map((s, i) => <div key={s.at} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">{i % every === 0 ? label(s.at) : ''}</div>)}
      </div>
      <figcaption className="sr-only">Stacked bars of routed and fallback redirects</figcaption>
    </figure>
  );
}

function ProjectsTable({ rows }: { rows: ProjectRow[] }) {
  if (!rows.length) return <Empty>No live projects and no traffic in this window.</Empty>;
  return (
    <>
    <ul className="space-y-3 md:hidden">
      {rows.map((r) => (
        <li key={r.project.id} className="rounded-lg border border-line p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/projects/${r.project.id}?tab=redirects`} className="font-medium text-brand hover:underline">{r.project.projectCode}</Link>
              <div className="truncate text-xs text-muted">{r.project.name}</div>
            </div>
            <HealthChip health={r.health} />
          </div>
          {r.reasons.length > 0 && <ul className="mt-1.5 space-y-0.5 text-xs">{r.reasons.map((x) => <li key={x} className={r.health === 'failing' ? 'text-bad' : 'text-warn'}>{x}</li>)}</ul>}
          <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
            {([
              ['Redirects', r.redirects],
              ['Fell back', r.fallbacks ? pct(r.fallbacks, r.redirects) : '0'],
              ['p95', ms(r.p95Ms)],
              ['Entries', r.entries],
              ['No return', r.expired],
              ['Callbacks', `${r.callbacksDelivered}${r.callbacksDead ? ` · ${r.callbacksDead} failed` : ''}`],
            ] as [string, string | number][]).map(([k, v]) => <div key={k}><dt className="text-muted">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
          </dl>
        </li>
      ))}
    </ul>
    <div className="-mx-1 hidden overflow-x-auto px-1 md:block">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr>
            <th className="th">Project</th>
            <th className="th">Health</th>
            <th className="th text-right">Entries</th>
            <th className="th text-right">Redirects</th>
            <th className="th text-right">Fell back</th>
            <th className="th text-right">p95</th>
            <th className="th text-right">Never came back</th>
            <th className="th text-right">Callbacks</th>
            <th className="th whitespace-nowrap">Last</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.project.id} className="border-t border-line align-top">
              <td className="td">
                <Link href={`/projects/${r.project.id}?tab=redirects`} className="font-medium text-brand hover:underline">{r.project.projectCode}</Link>
                <div className="max-w-[16rem] truncate text-xs text-muted">{r.project.name}</div>
                {r.reasons.length > 0 && <ul className="mt-1 space-y-0.5 text-xs">{r.reasons.map((x) => <li key={x} className={r.health === 'failing' ? 'text-bad' : 'text-warn'}>{x}</li>)}</ul>}
              </td>
              <td className="td"><HealthChip health={r.health} /></td>
              <td className="td text-right tabular-nums">{r.entries}</td>
              <td className="td text-right tabular-nums">{r.redirects}</td>
              <td className={clsx('td text-right tabular-nums', r.redirects && r.fallbacks / r.redirects >= 0.2 && 'font-semibold text-bad')}>{r.fallbacks ? `${r.fallbacks} (${pct(r.fallbacks, r.redirects)})` : '0'}</td>
              <td className="td text-right tabular-nums">{ms(r.p95Ms)}</td>
              <td className="td text-right tabular-nums">{r.expired ? `${r.expired} (${pct(r.expired, r.entries)})` : '0'}</td>
              <td className="td text-right tabular-nums">
                {r.callbacksDelivered}
                {r.callbacksRetrying > 0 && <span className="text-warn"> · {r.callbacksRetrying} pending</span>}
                {r.callbacksDead > 0 && <span className="text-bad"> · {r.callbacksDead} gave up</span>}
              </td>
              <td className="td whitespace-nowrap text-muted">{ago(r.lastRedirectAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

function Outcomes({ outcomes }: { outcomes: HealthData['outcomes'] }) {
  const total = outcomes.reduce((a, o) => a + o.count, 0);
  if (!total) return <Empty>No outcomes in this window.</Empty>;
  return (
    <ul className="space-y-2">
      {outcomes.map((o) => (
        <li key={o.status} className="grid grid-cols-[8.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm">
          <OutcomeChip status={o.status} />
          <div className="h-2 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-brand" style={{ width: `${(o.count / total) * 100}%` }} /></div>
          <span className="text-right tabular-nums">{o.count} <span className="text-xs text-muted">{pct(o.count, total)}</span></span>
        </li>
      ))}
    </ul>
  );
}

function Callbacks({ data, editable, onReplay }: { data: HealthData; editable: boolean; onReplay: (id: string) => void }) {
  return (
    <div className="space-y-4">
      {data.callbackProblems.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-medium">Needs attention</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {data.callbackProblems.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <span className={clsx('chip', c.state === 'RETRY_SCHEDULED' ? 'bg-warn/15 text-warn' : 'bg-bad/15 text-bad')}>{CB_STATE[c.state] ?? c.state}</span>
                <span className="min-w-0 flex-1 break-all font-mono text-xs">{c.url}</span>
                <span className="text-xs text-muted">
                  {c.project && <Link className="text-brand hover:underline" href={`/projects/${c.project.id}`}>{c.project.projectCode}</Link>}
                  {c.project ? ' · ' : ''}{c.attempts} attempt{c.attempts === 1 ? '' : 's'}{c.lastStatusCode ? ` · HTTP ${c.lastStatusCode}` : c.lastError ? ` · ${c.lastError.slice(0, 60)}` : ''} · {c.state === 'RETRY_SCHEDULED' ? `next try ${new Date(c.nextAttemptAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ago(c.updatedAt)}
                </span>
                {editable && c.state !== 'RETRY_SCHEDULED' && <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => onReplay(c.id)}><Send className="h-3.5 w-3.5" /> Send again</button>}
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="text-sm text-muted">No vendor callback is failing or waiting to retry.</p>}
      {data.callbackHosts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr><th className="th">Receiving host</th><th className="th text-right">Delivered</th><th className="th text-right">Pending</th><th className="th text-right">Failed</th><th className="th">Last error</th></tr></thead>
            <tbody>
              {data.callbackHosts.map((h) => (
                <tr key={h.host} className="border-t border-line">
                  <td className="td font-mono text-xs">{h.host}</td>
                  <td className="td text-right tabular-nums">{h.delivered}</td>
                  <td className={clsx('td text-right tabular-nums', h.pending && 'text-warn')}>{h.pending}</td>
                  <td className={clsx('td text-right tabular-nums', h.failing && 'font-semibold text-bad')}>{h.failing}</td>
                  <td className="td max-w-[18rem] truncate text-xs text-muted">{h.lastError ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LinkChecks({ checks, onClose }: { checks: LinkCheck[]; onClose: () => void }) {
  const bad = checks.filter((c) => !c.ok);
  return (
    <Section title={`Survey link check: ${checks.length - bad.length} of ${checks.length} reachable`} actions={<button className="btn-ghost px-2.5 py-1 text-xs" onClick={onClose}>Close</button>}>
      {!checks.length ? <Empty>No live market has a client survey link to check.</Empty> : (
        <ul className="divide-y divide-line">
          {[...bad, ...checks.filter((c) => c.ok)].map((c) => (
            <li key={c.projectCountryId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              {c.ok ? <CheckCircle2 className="h-4 w-4 text-ok" aria-label="Reachable" /> : <CircleAlert className="h-4 w-4 text-bad" aria-label="Problem" />}
              <Link className="font-medium text-brand hover:underline" href={`/projects/${c.projectId}`}>{c.projectCode}</Link>
              <span className="text-muted">{c.countryCode} · {c.language}</span>
              <span className={clsx('min-w-0 flex-1', !c.ok && 'text-bad')}>{c.detail}{c.status ? ` (HTTP ${c.status})` : ''}</span>
              <span className="text-xs tabular-nums text-muted">{ms(c.ms)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">Each live link was opened once with the test token <code>projexa-link-check</code>; your survey platform may show it as a visit.</p>
    </Section>
  );
}
