'use client';
import clsx from 'clsx';
import { AlertTriangle, BadgeCheck, CheckCircle2, CircleDashed, Database, Download, FileSpreadsheet, Filter, Gauge, ShieldCheck, Timer, Users } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Panel } from '@/components/dashboard/board';
import { Kpi, HBar, ProjectPicker, Ring, Tabs, Truncated, projectFromUrl, setProjectInUrl, type ProjectHead, type ProjectOption } from '@/components/insights/common';
import { Empty, ErrorBox, Loading, OutcomeChip, PageHeader, StatusChip } from '@/components/ui';
import { get } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';

interface Stage { id: string; label: string; done: number; total: number; percent: number | null; detail: string; hint: string }
interface VendorRow { id: string; name: string; entrants: number; completes: number; terminates: number; checkRejects: number; duplicates: number; security: number; qualityFails: number; rejectedCompletes: number; approved: number; rejectRate: number | null; clientRejectRate: number | null; medianMinutes: number | null; qualityScore: number | null }
interface Data {
  projects: ProjectOption[];
  project: ProjectHead | null;
  total: number;
  truncated: boolean;
  overall: number | null;
  stages: Stage[];
  counts: { entrants: number; finished: number; completes: number; approved: number; rejected: number; pendingReview: number; verified: number; checkRejects: number; billed: number; speeders: number };
  byStatus: { status: string; label: string; count: number }[];
  reasons: { code: string; label: string; status: string; count: number; percent: number | null }[];
  devices: { device: string; label: string; count: number }[];
  vendors: VendorRow[];
  quotas: { id: string; group: string; name: string; market: string; target: number; completes: number; isOpen: boolean; percent: number | null }[];
  reconciliation: { createdAt: string; submitted: number; matched: number; approved: number; rejected: number; unknown: number; mode: string } | null;
  flagged: { id: string; status: string; statusLabel: string; reason: string | null; vendor: string; country: string; device: string | null; at: string }[];
}
interface Clean { projectCode: string; total: number; truncated: boolean; columns: { key: string; label: string }[]; rows: { sessionToken: string; vendorRespondentId: string; vendor: string; market: string; device: string | null; approval: string; verified: boolean; startedAt: string; completedAt: string | null; minutes: number | null; answers: Record<string, string> }[] }

const TABS = [
  { id: 'intake', label: 'Data intake' },
  { id: 'validation', label: 'Validation' },
  { id: 'cleaning', label: 'Cleaning' },
  { id: 'quotas', label: 'Quota balance' },
  { id: 'export', label: 'Export' },
] as const;
type Tab = (typeof TABS)[number]['id'];
const STAGE_ICON: Record<string, typeof Database> = { intake: Database, validation: BadgeCheck, quality: ShieldCheck, review: Filter, quota: Gauge, billing: FileSpreadsheet };
const RECON_MODE: Record<string, string> = { final_list: 'Final list (listed approved, others rejected)', approve_listed: 'Approve listed IDs', reject_listed: 'Reject listed IDs' };

/** Data processing & quality (docs/DATA_PROCESSING_AND_ANALYTICS.md): one project's data from intake to clean delivery. */
export default function DataProcessingPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('intake');
  const [busy, setBusy] = useState(false);

  const load = useCallback((id?: string) => {
    setError(null);
    get<Data>(`/data-processing${id ? `?projectId=${encodeURIComponent(id)}` : ''}`).then((d) => { setData(d); if (d.project) setProjectInUrl(d.project.id); }).catch(setError);
  }, []);
  useEffect(() => load(projectFromUrl()), [load]);

  const exportClean = async () => {
    if (!data?.project) return;
    setBusy(true);
    try {
      const c = await get<Clean>(`/data-processing/clean?projectId=${encodeURIComponent(data.project.id)}`);
      downloadCsv(
        `${c.projectCode}-clean-data.csv`,
        ['Session token', 'Vendor respondent ID', 'Vendor', 'Market', 'Device', 'Approval', 'Verified by survey platform', 'Started', 'Completed', 'Minutes', ...c.columns.map((x) => x.label)],
        c.rows.map((r) => [r.sessionToken, r.vendorRespondentId, r.vendor, r.market, r.device, r.approval, r.verified ? 'yes' : 'no', r.startedAt, r.completedAt, r.minutes, ...c.columns.map((x) => r.answers[x.key] ?? '')]),
      );
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  if (error && !data) return <ErrorBox error={error} />;
  if (!data) return <Loading label="Loading data processing" />;
  if (!data.project) {
    return (<><PageHeader title="Data processing & quality" /><Empty>No projects yet. Create a project and send traffic to see its data pipeline here.</Empty></>);
  }
  const { project: p, counts } = data;

  return (
    <>
      <PageHeader
        title="Data processing & quality"
        subtitle={<>From raw entrants to a clean, reconciled respondent file · <span className="font-medium text-ink">{p.code}</span> {p.name} · {p.client} <StatusChip status={p.status} /></>}
        actions={<ProjectPicker projects={data.projects} value={p.id} onChange={(id) => load(id)} tab="answers" />}
      />
      {error != null && <div className="mb-4"><ErrorBox error={error} /></div>}
      <Truncated show={data.truncated} total={data.total} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Data processing steps" />

      {tab === 'intake' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <Panel title="Processing progress" icon={<Database className="h-4 w-4 text-brand" aria-hidden />}>
            <div className="flex flex-col items-center gap-4 py-2 sm:flex-row xl:flex-col 2xl:flex-row">
              <div className="relative grid place-items-center">
                <div className="pointer-events-none absolute inset-6 rounded-full opacity-60 blur-2xl" style={{ background: 'radial-gradient(circle, rgb(var(--brand) / 0.55), transparent 70%)' }} aria-hidden />
                <Ring value={data.overall} label={data.overall === 100 ? 'Processing done' : 'Processing in progress'} />
              </div>
              <dl className="grid w-full grid-cols-2 gap-3 text-sm">
                {[
                  ['Entrants', counts.entrants],
                  ['Completes', counts.completes],
                  ['Approved', counts.approved],
                  ['Waiting for review', counts.pendingReview],
                  ['Removed by checks', counts.checkRejects],
                  ['Billed', counts.billed],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-xl border border-line bg-panel/60 px-3 py-2">
                    <dt className="text-xs text-muted">{l}</dt>
                    <dd className="text-lg font-bold tabular-nums">{(v as number).toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <p className="mt-2 text-xs text-muted">Progress is the average of the steps on the right, without the quality pass rate (that one is a rate, not a step).</p>
          </Panel>
          <Panel title="Pipeline">
            <ol className="space-y-2.5">
              {data.stages.map((s) => {
                const Icon = STAGE_ICON[s.id] ?? CircleDashed;
                const done = s.percent != null && s.percent >= 100;
                const tone = s.percent == null ? 'bg-sunken' : s.id === 'quality' ? (s.percent >= 90 ? 'from-[#4ade80] to-[#16a34a]' : s.percent >= 75 ? 'from-[#fbbf24] to-[#ea580c]' : 'from-[#fb7185] to-[#dc2626]') : done ? 'from-[#4ade80] to-[#16a34a]' : s.percent >= 50 ? 'from-[#60a5fa] to-[#7c3aed]' : 'from-[#fbbf24] to-[#ea580c]';
                return (
                  <li key={s.id} className="rounded-2xl border border-line bg-panel/60 p-3" title={s.hint}>
                    <div className="flex items-center gap-3">
                      <span className={clsx('icon-tile h-9 w-9 shrink-0 rounded-xl', done ? 'tone-green' : s.percent == null ? 'tone-blue' : s.id === 'quality' ? 'tone-cyan' : 'tone-violet')}>
                        {done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium">{s.label}</span>
                          <span className="text-sm font-bold tabular-nums">{s.percent == null ? '–' : `${s.percent}%`}</span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken"><div className={clsx('h-full rounded-full bg-gradient-to-r', tone)} style={{ width: `${s.percent ?? 0}%` }} /></div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted sm:truncate">{s.detail}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Panel>
          <Panel title="Outcomes of all entrants" className="xl:col-span-2">
            {data.byStatus.length === 0 ? <Empty>No entrants yet.</Empty> : (
              <ul className="space-y-2">{data.byStatus.map((s, i) => <HBar key={s.status} label={s.label} count={s.count} percent={counts.entrants ? Math.round((s.count / counts.entrants) * 1000) / 10 : null} i={i} />)}</ul>
            )}
          </Panel>
        </div>
      )}

      {tab === 'validation' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid grid-cols-2 gap-3 lg:col-span-2 xl:grid-cols-4">
            <Kpi icon={BadgeCheck} tone="tone-green" value={`${data.stages.find((s) => s.id === 'validation')?.percent ?? '–'}%`} label="Completes verified" sub={`${counts.verified} of ${counts.completes} confirmed server-to-server`} />
            <Kpi icon={ShieldCheck} tone="tone-cyan" value={`${data.stages.find((s) => s.id === 'quality')?.percent ?? '–'}%`} label="Passed entry checks" sub={`${counts.checkRejects} removed`} />
            <Kpi icon={Timer} tone="tone-amber" value={counts.speeders} label="Possible speeders" sub="Completed in under a third of the planned length" />
            <Kpi icon={Users} tone="tone-violet" value={counts.entrants - counts.finished} label="Still in the survey" sub="No outcome yet" />
          </div>
          <Panel title="Why entrants were removed or screened out">
            {data.reasons.length === 0 ? <Empty>No entrant has been removed or screened out by PROJEXA’s checks.</Empty> : (
              <ul className="space-y-2">{data.reasons.map((r, i) => <HBar key={r.code} label={r.label} count={r.count} percent={r.percent} i={i + 4} />)}</ul>
            )}
            <p className="mt-3 text-xs text-muted">Turn checks on or off in the project’s <Link className="text-brand hover:underline" href={`/projects/${p.id}?tab=gate`}>Gate & security</Link> tab.</p>
          </Panel>
          <Panel title="Devices of entrants">
            <ul className="space-y-2">{data.devices.map((d, i) => <HBar key={d.device} label={d.label} count={d.count} percent={counts.entrants ? Math.round((d.count / counts.entrants) * 1000) / 10 : null} i={i + 1} />)}</ul>
          </Panel>
        </div>
      )}

      {tab === 'cleaning' && (
        <div className="grid gap-4">
          <Panel title="Quality by vendor">
            {data.vendors.length === 0 ? <Empty>No vendor traffic yet.</Empty> : (
              <div className="-mx-5 overflow-x-auto px-5">
                <table className="w-full min-w-[760px] text-sm">
                  <thead><tr className="text-left text-xs text-muted">
                    {['Vendor', 'Entrants', 'Completes', 'Removed by checks', 'Duplicates', 'Security', 'Quality fail', 'Client rejected', 'Median minutes', 'Quality score'].map((h, i) => <th key={h} className={clsx('px-2 py-2 font-medium', i > 0 && 'text-right')}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {data.vendors.map((v) => (
                      <tr key={v.id} className="border-t border-line">
                        <td className="px-2 py-2 font-medium"><Link href={`/vendors/${v.id}`} className="hover:text-brand">{v.name}</Link></td>
                        <td className="px-2 py-2 text-right tabular-nums">{v.entrants}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{v.completes}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{v.checkRejects} <span className="text-xs text-muted">({v.rejectRate ?? 0}%)</span></td>
                        <td className="px-2 py-2 text-right tabular-nums">{v.duplicates}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{v.security}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{v.qualityFails}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{v.rejectedCompletes}{v.clientRejectRate != null && <span className="text-xs text-muted"> ({v.clientRejectRate}%)</span>}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{v.medianMinutes ?? '–'}</td>
                        <td className="px-2 py-2 text-right">
                          {v.qualityScore == null ? '–' : <span className={clsx('chip', v.qualityScore >= 90 ? 'bg-ok/15 text-ok' : v.qualityScore >= 75 ? 'bg-warn/15 text-warn' : 'bg-bad/15 text-bad')}>{v.qualityScore}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">Quality score = share of the vendor’s entrants not removed by checks and not rejected by the client.</p>
          </Panel>
          <Panel title="Removed and rejected respondents" action={<Link href={`/projects/${p.id}?tab=respondents`} className="text-xs text-brand hover:underline">All respondents</Link>}>
            {data.flagged.length === 0 ? <Empty>Nobody has been removed or rejected.</Empty> : (
              <div className="-mx-5 overflow-x-auto px-5">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="text-left text-xs text-muted">{['Outcome', 'Reason', 'Vendor', 'Market', 'Device', 'When'].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {data.flagged.map((f) => (
                      <tr key={f.id} className="border-t border-line">
                        <td className="px-2 py-2"><OutcomeChip status={f.status} /></td>
                        <td className="px-2 py-2">{f.reason ?? '–'}</td>
                        <td className="px-2 py-2">{f.vendor}</td>
                        <td className="px-2 py-2">{f.country}</td>
                        <td className="px-2 py-2 capitalize">{f.device ?? '–'}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-muted">{new Date(f.at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title="Review and reconciliation">
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <div><div className="text-2xl font-bold tabular-nums">{counts.approved}</div><div className="text-muted">approved</div></div>
              <div><div className="text-2xl font-bold tabular-nums">{counts.rejected}</div><div className="text-muted">rejected</div></div>
              <div><div className="text-2xl font-bold tabular-nums">{counts.pendingReview}</div><div className="text-muted">waiting</div></div>
              <div className="min-w-[14rem] flex-1 text-muted">
                {data.reconciliation
                  ? <>Last client ID list on {new Date(data.reconciliation.createdAt).toLocaleDateString()}: {RECON_MODE[data.reconciliation.mode] ?? data.reconciliation.mode}, {data.reconciliation.submitted} IDs, {data.reconciliation.matched} matched, {data.reconciliation.unknown} unknown.</>
                  : 'No client ID list has been reconciled yet.'}
              </div>
              <Link href={`/projects/${p.id}?tab=reconcile`} className="btn-primary">Reconcile</Link>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'quotas' && (
        <Panel title="Quota balance" icon={<Gauge className="h-4 w-4 text-brand" aria-hidden />} action={<Link href={`/projects/${p.id}?tab=quotas`} className="text-xs text-brand hover:underline">Edit quotas</Link>}>
          <p className="mb-4 text-sm text-muted">PROJEXA balances the sample while in field with quota cells (respondents over a full cell go to quota full). It does not weight data after fieldwork; do that in your analysis tool with the clean data file.</p>
          {data.quotas.length === 0 ? <Empty>No quota cells or market targets.</Empty> : (
            <ul className="space-y-3">
              {data.quotas.map((q, i) => (
                <li key={q.id} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,18rem)_1fr_auto]">
                  <span className="min-w-0 truncate" title={`${q.group} · ${q.name} · ${q.market}`}>
                    <span className="font-medium">{q.name}</span> <span className="text-xs text-muted">{q.group && q.group !== 'Market' ? `${q.group} · ` : ''}{q.market}</span>
                    {!q.isOpen && <span className="chip ml-1 bg-sunken text-muted">closed</span>}
                  </span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-sunken"><span className={clsx('block h-full rounded-full bg-gradient-to-r', (q.percent ?? 0) >= 100 ? 'from-[#4ade80] to-[#16a34a]' : ['from-[#8b5cf6] to-[#6d28d9]', 'from-[#60a5fa] to-[#2563eb]', 'from-[#22d3ee] to-[#0d9488]'][i % 3])} style={{ width: `${q.percent ?? 0}%` }} /></span>
                  <span className="w-28 text-right tabular-nums"><span className="font-medium">{q.completes}</span> / {q.target}<span className="text-xs text-muted"> · {q.percent ?? 0}%</span></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === 'export' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Clean data file" icon={<FileSpreadsheet className="h-4 w-4 text-brand" aria-hidden />}>
            <p className="text-sm text-muted">Every complete that was not rejected, with vendor, market, device, approval, verification, interview length and every gate and prescreener answer. Test traffic and rejected completes are left out.</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button className="btn-primary" onClick={exportClean} disabled={busy || counts.completes === 0}><Download className="h-4 w-4" /> {busy ? 'Preparing…' : 'Download clean data (CSV)'}</button>
              <span className="text-sm text-muted">{(counts.completes - counts.rejected).toLocaleString()} rows</span>
            </div>
            {counts.pendingReview > 0 && <p className="mt-3 flex items-start gap-2 text-sm text-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{counts.pendingReview} completes are still waiting for review; they are included, marked PENDING.</p>}
          </Panel>
          <Panel title="Other exports">
            <ul className="space-y-2 text-sm">
              <li><Link className="text-brand hover:underline" href={`/projects/${p.id}?tab=answers`}>Answers tab</Link> <span className="text-muted">· every entrant’s gate and prescreener answers, with filters and CSV</span></li>
              <li><Link className="text-brand hover:underline" href={`/projects/${p.id}?tab=respondents`}>Respondents tab</Link> <span className="text-muted">· all sessions with outcomes and events</span></li>
              <li><Link className="text-brand hover:underline" href={`/projects/${p.id}?tab=reconcile`}>Reconcile & invoice</Link> <span className="text-muted">· client ID lists and invoices</span></li>
              <li><Link className="text-brand hover:underline" href={`/analytics?project=${p.id}`}>Analytics</Link> <span className="text-muted">· crosstabs and charts from these answers</span></li>
              <li><Link className="text-brand hover:underline" href="/reports">Reports</Link> <span className="text-muted">· overall, conversion, client, vendor and clicks reports, PDF and CSV</span></li>
            </ul>
          </Panel>
        </div>
      )}
    </>
  );
}
