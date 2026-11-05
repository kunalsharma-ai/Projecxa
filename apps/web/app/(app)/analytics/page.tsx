'use client';
import clsx from 'clsx';
import { CheckCircle2, Clock3, Download, FileText, Info, Lightbulb, Target, TrendingDown, TrendingUp, Users, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Panel } from '@/components/dashboard/board';
import { Columns, Donut, HBar, Kpi, ProjectPicker, Spark, Tabs, Truncated, projectFromUrl, setProjectInUrl, type ProjectHead, type ProjectOption } from '@/components/insights/common';
import { Empty, ErrorBox, Loading, PageHeader, StatusChip } from '@/components/ui';
import { get } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';

type Item = { label: string; count: number; percent: number | null };
interface Crosstab { row: { key: string; label: string }; col: { key: string; label: string }; base: number; columns: { label: string; base: number }[]; rows: { label: string; total: number; totalPercent: number | null; cells: { count: number; percent: number | null }[] }[] }
interface Data {
  projects: ProjectOption[];
  project: ProjectHead | null;
  total: number;
  truncated: boolean;
  base: Base;
  baseCount: number;
  kpis: { completes: number; target: number; approved: number; thisWeek: number; lastWeek: number; weekChange: number | null; medianLength: number | null; plannedLoi: number | null; incidence: number | null; plannedIr: number | null; insights: number };
  trend: { day: string; completes: number; entrants: number }[];
  dimensions: { key: string; label: string; kind: 'field' | 'question' }[];
  focus: { key: string; label: string; answered: number; items: Item[] };
  crosstab: Crosstab;
  analysis: { key: string; label: string; type: string; answered: number; items: Item[] }[];
  insights: { tone: 'good' | 'warn' | 'info'; text: string }[];
  deliverables: { id: string; kind: string; name: string; size: number; createdAt: string; sharedWithClient: boolean; note: string | null }[];
}
type Base = 'completes' | 'finished' | 'all';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'crosstabs', label: 'Crosstabs' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'deliverables', label: 'Deliverables' },
] as const;
type Tab = (typeof TABS)[number]['id'];
const BASES: { id: Base; label: string }[] = [
  { id: 'completes', label: 'Completes' },
  { id: 'finished', label: 'All finished entrants' },
  { id: 'all', label: 'Every entrant' },
];
const short = (l: string) => l.replace(/^(Gate|Prescreen): /, '');
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Reporting & analytics (docs/DATA_PROCESSING_AND_ANALYTICS.md): one project's results as KPIs, charts, crosstabs and deliverables. */
export default function AnalyticsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [sel, setSel] = useState<{ project?: string; base: Base; row?: string; col?: string; focus?: string }>({ base: 'completes' });

  const load = useCallback((s: typeof sel) => {
    const qs = new URLSearchParams();
    if (s.project) qs.set('projectId', s.project);
    qs.set('base', s.base);
    if (s.row) qs.set('row', s.row);
    if (s.col) qs.set('col', s.col);
    if (s.focus) qs.set('focus', s.focus);
    setError(null);
    get<Data>(`/analytics?${qs}`).then((d) => { setData(d); if (d.project) setProjectInUrl(d.project.id); }).catch(setError);
  }, []);
  useEffect(() => { const s = { base: 'completes' as Base, project: projectFromUrl() }; setSel(s); load(s); }, [load]);
  const change = (patch: Partial<typeof sel>) => { const s = { ...sel, ...patch }; setSel(s); load(s); };

  if (error && !data) return <ErrorBox error={error} />;
  if (!data) return <Loading label="Loading analytics" />;
  if (!data.project) return (<><PageHeader title="Reporting & analytics" /><Empty>No projects yet.</Empty></>);
  const { project: p, kpis } = data;
  const questions = data.dimensions.filter((d) => d.kind === 'question');
  const baseLabel = BASES.find((b) => b.id === data.base)?.label.toLowerCase() ?? 'completes';

  const DimSelect = ({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) => (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted" htmlFor={id}>
      {label}
      <select id={id} className="input h-10 w-full min-w-0 sm:w-64" value={value} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Respondent">{data.dimensions.filter((d) => d.kind === 'field').map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</optgroup>
        {questions.length > 0 && <optgroup label="Gate and prescreener questions">{questions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</optgroup>}
      </select>
    </label>
  );
  const BaseSelect = () => (
    <label className="flex flex-col gap-1 text-xs text-muted" htmlFor="an-base">
      Base
      <select id="an-base" className="input h-10 w-full sm:w-56" value={data.base} onChange={(e) => change({ base: e.target.value as Base })}>
        {BASES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
      </select>
    </label>
  );

  const exportCrosstab = () => {
    const c = data.crosstab;
    downloadCsv(`${p.code}-crosstab.csv`,
      [`${short(c.row.label)} \\ ${short(c.col.label)}`, 'Total', 'Total %', ...c.columns.flatMap((x) => [x.label, `${x.label} %`])],
      [...c.rows.map((r) => [r.label, r.total, r.totalPercent, ...r.cells.flatMap((x) => [x.count, x.percent])]), ['Base', c.base, 100, ...c.columns.flatMap((x) => [x.base, 100])]]);
  };
  const exportAnalysis = () => {
    downloadCsv(`${p.code}-answer-counts.csv`, ['Question', 'Answer', 'Count', '%', 'Answered'], data.analysis.flatMap((a) => a.items.map((i) => [a.label, i.label, i.count, i.percent, a.answered])));
  };

  const rowItems = (() => {
    // The column chart shows the crosstab's row variable across the chosen base.
    const c = data.crosstab;
    return c.rows.map((r) => ({ label: r.label, count: r.total, percent: r.totalPercent }));
  })();
  const topFocus = [...data.focus.items].sort((a, b) => b.count - a.count)[0];
  const weekUp = kpis.weekChange != null && kpis.weekChange >= 0;

  return (
    <>
      <PageHeader
        title="Reporting & analytics"
        subtitle={<>Results of <span className="font-medium text-ink">{p.code}</span> {p.name} · {p.client} <StatusChip status={p.status} /></>}
        actions={<ProjectPicker projects={data.projects} value={p.id} onChange={(id) => change({ project: id, row: undefined, col: undefined, focus: undefined })} />}
      />
      {error != null && <div className="mb-4"><ErrorBox error={error} /></div>}
      <Truncated show={data.truncated} total={data.total} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Analytics views" />

      {tab === 'dashboard' && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon={Users} tone="tone-violet" value={`N=${kpis.completes.toLocaleString()}`} label="Completes" sub={kpis.target ? `of ${kpis.target.toLocaleString()} target · ${kpis.approved} approved` : `${kpis.approved} approved`} />
            <Kpi icon={Clock3} tone="tone-blue" value={kpis.medianLength == null ? '–' : `${kpis.medianLength} min`} label="Median interview length" sub={kpis.plannedLoi ? `${kpis.plannedLoi} min planned` : undefined} />
            <Kpi icon={weekUp ? TrendingUp : TrendingDown} tone={weekUp ? 'tone-green' : 'tone-red'} value={kpis.weekChange == null ? kpis.thisWeek : `${kpis.weekChange > 0 ? '+' : ''}${kpis.weekChange}%`} label={kpis.weekChange == null ? 'Completes, last 7 days' : 'vs the week before'} sub={`${kpis.thisWeek} this week · ${kpis.lastWeek} the week before`} subTone="muted" />
            <Kpi icon={Lightbulb} tone="tone-pink" value={kpis.insights} label="Key insights" sub={kpis.incidence != null ? `Incidence ${kpis.incidence}%${kpis.plannedIr ? ` (${kpis.plannedIr}% planned)` : ''}` : undefined} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <Panel title={`${short(data.crosstab.row.label)}`} action={<button className="text-xs text-brand hover:underline" onClick={() => setTab('crosstabs')}>Crosstab</button>}>
              {rowItems.length === 0 ? <Empty>No {baseLabel} with an answer yet.</Empty> : <Columns items={rowItems} />}
              <p className="mt-2 text-xs text-muted">Share of {baseLabel} (base {data.crosstab.base.toLocaleString()}).</p>
            </Panel>
            <Panel title={short(data.focus.label)} action={
              <select aria-label="Question shown in the donut" className="input h-8 max-w-[11rem] py-0 text-xs" value={data.focus.key} onChange={(e) => change({ focus: e.target.value })}>
                {data.dimensions.map((d) => <option key={d.key} value={d.key}>{short(d.label)}</option>)}
              </select>
            }>
              {data.focus.answered === 0 ? <Empty>No answers yet.</Empty> : <Donut items={data.focus.items} center={topFocus?.percent != null ? `${Math.round(topFocus.percent)}%` : '–'} sub={topFocus?.label.slice(0, 18) ?? ''} />}
            </Panel>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <Panel title="Completes per day (30 days)">
              <Spark points={data.trend.map((t) => ({ day: t.day, value: t.completes }))} label="Completes per day over the last 30 days" />
            </Panel>
            <Panel title="Key insights" icon={<Lightbulb className="h-4 w-4 text-brand" aria-hidden />}>
              {data.insights.length === 0 ? <Empty>Insights appear once the project has completes.</Empty> : (
                <ul className="space-y-2">
                  {data.insights.map((x, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      {x.tone === 'good' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : x.tone === 'warn' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />}
                      <span>{x.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted">Worked out from the numbers with fixed rules; no AI. Ask the <Link href={`/copilot?ask=${encodeURIComponent(`Summarise the results of project ${p.code}`)}`} className="text-brand hover:underline">AI copilot</Link> for a written summary.</p>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'crosstabs' && (
        <Panel title="Crosstab" action={<button className="btn-ghost h-8 px-3 text-xs" onClick={exportCrosstab}><Download className="h-3.5 w-3.5" /> CSV</button>}>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <DimSelect id="an-row" label="Rows" value={data.crosstab.row.key} onChange={(v) => change({ row: v })} />
            <DimSelect id="an-col" label="Columns" value={data.crosstab.col.key} onChange={(v) => change({ col: v })} />
            <BaseSelect />
          </div>
          {data.crosstab.base === 0 ? <Empty>No {baseLabel} answered both questions yet.</Empty> : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="px-2 py-2 text-left font-medium">{short(data.crosstab.row.label)} ↓ · {short(data.crosstab.col.label)} →</th>
                    <th className="px-2 py-2 text-right font-medium">Total</th>
                    {data.crosstab.columns.map((c) => <th key={c.label} className="px-2 py-2 text-right font-medium">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.crosstab.rows.map((r) => (
                    <tr key={r.label} className="border-t border-line">
                      <td className="px-2 py-2 font-medium">{r.label}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.totalPercent ?? 0}%<span className="block text-[11px] text-muted">{r.total}</span></td>
                      {r.cells.map((c, i) => (
                        <td key={i} className="px-2 py-2 text-right tabular-nums" style={{ background: c.percent ? `rgb(var(--brand) / ${Math.min(0.45, c.percent / 220)})` : undefined }}>
                          {c.percent ?? 0}%<span className="block text-[11px] text-muted">{c.count}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-line text-xs text-muted">
                    <td className="px-2 py-2">Base</td>
                    <td className="px-2 py-2 text-right tabular-nums">{data.crosstab.base}</td>
                    {data.crosstab.columns.map((c) => <td key={c.label} className="px-2 py-2 text-right tabular-nums">{c.base}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">Column percentages. Multi-choice answers count once per choice, so columns can add up to more than 100%. The client survey’s own answers stay in the survey platform; PROJEXA has the gate and prescreener answers and the respondent fields.</p>
        </Panel>
      )}

      {tab === 'analysis' && (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <BaseSelect />
            <button className="btn-ghost" onClick={exportAnalysis} disabled={!data.analysis.length}><Download className="h-4 w-4" /> Answer counts (CSV)</button>
          </div>
          {data.analysis.length === 0 ? <Empty>This project has no gate or prescreener choice or number questions. Add them in the project’s Gate & security tab.</Empty> : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.analysis.map((a) => (
                <Panel key={a.key} title={short(a.label)} action={<span className="text-xs text-muted">{a.answered.toLocaleString()} answered</span>}>
                  <ul className="space-y-2">{a.items.map((it, i) => <HBar key={it.label} label={it.label} count={it.count} percent={it.percent} i={i} />)}</ul>
                </Panel>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'deliverables' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Files for this project" icon={<FileText className="h-4 w-4 text-brand" aria-hidden />} action={<Link href={`/projects/${p.id}?tab=files`} className="text-xs text-brand hover:underline">Upload or share</Link>}>
            {data.deliverables.length === 0 ? <Empty>No deliverables or questionnaires uploaded yet.</Empty> : (
              <ul className="divide-y divide-line">
                {data.deliverables.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className={clsx('icon-tile h-8 w-8 rounded-xl', f.kind === 'DELIVERABLE' ? 'tone-green' : 'tone-blue')}><FileText className="h-4 w-4" aria-hidden /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{f.name}</span><span className="block text-xs text-muted">{f.kind === 'DELIVERABLE' ? 'Deliverable' : 'Questionnaire'} · {kb(f.size)} · {new Date(f.createdAt).toLocaleDateString()}{f.sharedWithClient ? ' · shared with client' : ''}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Downloads" icon={<Target className="h-4 w-4 text-brand" aria-hidden />}>
            <ul className="space-y-3 text-sm">
              <li className="flex flex-wrap items-center justify-between gap-2"><span>Crosstab as shown ({short(data.crosstab.row.label)} × {short(data.crosstab.col.label)})</span><button className="btn-ghost h-8 px-3 text-xs" onClick={exportCrosstab}><Download className="h-3.5 w-3.5" /> CSV</button></li>
              <li className="flex flex-wrap items-center justify-between gap-2"><span>Answer counts for every question</span><button className="btn-ghost h-8 px-3 text-xs" onClick={exportAnalysis} disabled={!data.analysis.length}><Download className="h-3.5 w-3.5" /> CSV</button></li>
              <li className="flex flex-wrap items-center justify-between gap-2"><span>Clean respondent data file</span><Link className="btn-ghost h-8 px-3 text-xs" href={`/data-processing?project=${p.id}`}>Data processing</Link></li>
              <li className="flex flex-wrap items-center justify-between gap-2"><span>Project report (PDF, CSV, scheduled email)</span><Link className="btn-ghost h-8 px-3 text-xs" href="/reports">Reports</Link></li>
            </ul>
          </Panel>
        </div>
      )}
    </>
  );
}
