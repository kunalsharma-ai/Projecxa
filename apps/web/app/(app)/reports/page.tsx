'use client';
import clsx from 'clsx';
import { CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { defaultFilters, FilterBar } from '@/components/reports/filter-bar';
import { AnswersView } from '@/components/project/answers-view';
import { CsvButton, SummaryTable, summaryCsv } from '@/components/reports/summary-table';
import { TrendChart } from '@/components/reports/trend-chart';
import { ViewsBar, viewFilters, type SavedView } from '@/components/reports/views-bar';
import { filterQuery, moneyLines, type Filters, type Options, type SummaryRow } from '@/components/reports/types';
import { Empty, ErrorBox, Loading, OutcomeChip, PageHeader, Section } from '@/components/ui';
import { get } from '@/lib/api';
import { flag } from '@/lib/countries';
import { downloadCsv } from '@/lib/csv';
import { STATUS_LABEL } from '@/lib/types';

const TABS = ['Overall', 'Conversion', 'Clients', 'Vendors', 'Clicks', 'Answers'] as const;
type Tab = (typeof TABS)[number];

interface Overall {
  totals: SummaryRow; byDay: SummaryRow[]; topClients: SummaryRow[]; topVendors: SummaryRow[]; topProjects: SummaryRow[];
  counts: { clients: number; vendors: number; projects: number }; currencyNote: string;
}
interface Summary { rows: SummaryRow[]; totals: SummaryRow | null; currencyNote: string }
interface Page<T> { total: number; page: number; pageSize: number; truncated: boolean; rows: T[]; byType?: Record<string, number> }
interface ConversionRow {
  id: string; projectId: string; projectCode: string; workOrderNo: string | null; projectName: string; client: string; countryCode: string; currency: string;
  vendor: string; vendorCode: string; uid: string; token: string; status: string; statusDetail: string | null; approval: string; verified: boolean;
  revenue: number | null; payout: number | null; loiMinutes: number | null; startedAt: string; outcomeAt: string | null;
}
interface ClickRow { id: string; at: string; type: string; status: string | null; source: string; projectCode: string; countryCode: string; vendor: string; uid: string; sessionStatus: string }

const PAGE_SIZE = 100;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const dt = (s: string | null) => (s ? new Date(s).toLocaleString() : '');
const EVENT_LABEL: Record<string, string> = { ENTRY: 'Entry', OUTCOME: 'Outcome', DUPLICATE_ENTRY: 'Repeat entry', OUTCOME_REPEAT: 'Repeated outcome', OUTCOME_CONFLICT: 'Conflicting outcome' };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ReportsPage />
    </Suspense>
  );
}

function ReportsPage() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>('Overall');
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [preset, setPreset] = useState('30');
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [view, setView] = useState<string | null>(null);
  const apply = (v: SavedView | null) => {
    setView(v?.id ?? null);
    if (!v) return;
    setTab(v.tab as Tab);
    setPreset(v.period);
    setFilters(viewFilters(v));
  };

  useEffect(() => {
    get<Options>('/reports/options').then(setOptions).catch(setError);
  }, []);
  // Deep links from search: /reports?clientId=…, ?vendorId=… or ?projectId=…
  useEffect(() => {
    const pick = (k: 'clientId' | 'vendorId' | 'projectId') => params.get(k) ?? '';
    if (!pick('clientId') && !pick('vendorId') && !pick('projectId')) return;
    setFilters((f) => ({ ...f, clientId: pick('clientId'), vendorId: pick('vendorId'), projectId: pick('projectId') }));
    setTab(pick('vendorId') ? 'Vendors' : pick('clientId') ? 'Clients' : 'Overall');
  }, [params]);

  return (
    <>
      <PageHeader title="Reports" subtitle="Fieldwork performance across clients, vendors and markets. Test traffic is never counted." actions={<Link href="/reports/schedules" className="btn-ghost"><CalendarClock className="h-4 w-4" /> Scheduled reports</Link>} />
      <ViewsBar tab={tab} filters={filters} preset={preset} current={view} onApply={apply} />
      <FilterBar value={filters} onChange={(f) => { setFilters(f); setView(null); }} options={options} preset={preset} onPreset={(p) => { setPreset(p); setView(null); }} />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx('-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm', tab === t ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink')}>
            {t}
          </button>
        ))}
      </div>
      {error ? <ErrorBox error={error} /> : (
        <>
          {tab === 'Overall' && <OverallTab filters={filters} />}
          {tab === 'Conversion' && <ConversionTab filters={filters} />}
          {tab === 'Clients' && <GroupedTab filters={filters} kind="client" />}
          {tab === 'Vendors' && <GroupedTab filters={filters} kind="vendor" />}
          {tab === 'Clicks' && <ClicksTab filters={filters} />}
          {tab === 'Answers' && <AnswersTab projectId={filters.projectId} options={options} onPick={(projectId) => setFilters({ ...filters, projectId })} />}
        </>
      )}
    </>
  );
}

/** Loads `path` whenever it changes; only the latest request's answer is kept. */
function useLatest<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const n = useRef(0);
  useEffect(() => {
    const mine = ++n.current;
    setData(null);
    setError(null);
    get<T>(path)
      .then((r) => mine === n.current && setData(r))
      .catch((e) => mine === n.current && setError(e));
  }, [path]);
  return { data, error };
}

function Tile({ label, value, sub }: { label: string; value: string | number | string[]; sub?: string }) {
  const lines = Array.isArray(value) ? value : [String(value)];
  return (
    <div className="card min-w-0 p-4">
      <div className="text-xs text-muted">{label}</div>
      {lines.map((l, i) => (
        <div key={l} className={clsx('truncate font-semibold tabular-nums', i === 0 ? 'mt-1' : '', lines.length > 1 ? 'text-base' : 'text-xl')}>{l}</div>
      ))}
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

function OverallTab({ filters }: { filters: Filters }) {
  const { data: d, error } = useLatest<Overall>(`/reports/overall${filterQuery(filters)}`);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const t = d.totals;
  const mix: [string, number][] = [
    ['Complete', t.completes], ['Terminate', t.terminates], ['Quota full', t.quotaFull], ['Quality, duplicate or security', t.qualityFail], ['Partial or error', t.partial], ['Still in survey', t.inProgress],
  ];
  const Top = ({ title, rows, href }: { title: string; rows: SummaryRow[]; href?: (r: SummaryRow) => string }) => (
    <Section title={title}>
      {rows.length === 0 ? <Empty>No traffic.</Empty> : (
        <ol className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                {href ? <Link href={href(r)} className="block truncate font-medium hover:text-brand">{r.label}</Link> : <div className="truncate font-medium">{r.label}</div>}
                {r.sublabel && <div className="truncate text-xs text-muted">{r.sublabel}</div>}
              </div>
              <div className="shrink-0 text-right">
                <div className="tabular-nums">{r.completes.toLocaleString()} completes</div>
                <div className="text-xs text-muted tabular-nums">{r.conversion}% of {r.clicks.toLocaleString()} clicks</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
  return (
    <>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-4">
        <Tile label="Clicks" value={t.clicks.toLocaleString()} />
        <Tile label="Completes" value={t.completes.toLocaleString()} sub={`${t.pending} pending · ${t.rejected} rejected`} />
        <Tile label="Conversion" value={`${t.conversion}%`} />
        <Tile label="Median LOI" value={t.medianLoiMinutes == null ? '–' : `${t.medianLoiMinutes} min`} />
        <Tile label="Revenue" value={moneyLines(t, 'revenue')} />
        <Tile label="Payout" value={moneyLines(t, 'payout')} />
        <Tile label="Profit" value={moneyLines(t, 'profit')} sub={t.margin == null ? undefined : `${t.margin}% margin`} />
        <Tile label="Projects with traffic" value={d.counts.projects} sub={`${plural(d.counts.clients, 'client')} · ${plural(d.counts.vendors, 'vendor')}`} />
      </div>
      <p className="mb-6 mt-2 text-xs text-muted">{d.currencyNote} Revenue and payout leave out rejected completes.</p>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Section title="Completes per day (UTC)">
          {filters.from && filters.to ? <TrendChart days={d.byDay} /> : <TrendChart days={d.byDay.slice(-90)} />}
        </Section>
        <Section title="Outcome mix">
          <dl className="space-y-2.5 text-sm">
            {mix.map(([l, v]) => (
              <div key={l}>
                <div className="flex justify-between gap-3"><dt className="text-muted">{l}</dt><dd className="tabular-nums">{v.toLocaleString()} <span className="text-xs text-muted">({t.clicks ? Math.round((v / t.clicks) * 1000) / 10 : 0}%)</span></dd></div>
                <div className="mt-1 h-1.5 rounded-full bg-sunken"><div className="h-1.5 rounded-full bg-chart-1/75 transition-[width] duration-[var(--dur-slow)]" style={{ width: `${t.clicks ? (v / t.clicks) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </dl>
        </Section>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Top title="Top clients" rows={d.topClients} />
        <Top title="Top vendors" rows={d.topVendors} />
        <Top title="Top projects" rows={d.topProjects} href={(r) => `/projects/${r.key}`} />
      </div>
    </>
  );
}

function GroupedTab({ filters, kind }: { filters: Filters; kind: 'client' | 'vendor' }) {
  const [byMarket, setByMarket] = useState(false);
  const groupBy = kind === 'client' ? (byMarket ? 'country' : 'client') : byMarket ? 'vendor_country' : 'vendor';
  const { data, error } = useLatest<Summary>(`/reports/summary${filterQuery(filters, { groupBy })}`);
  const name = kind === 'client' ? (byMarket ? 'Market' : 'Client') : 'Vendor';
  const sub = kind === 'vendor' && byMarket ? 'Market' : undefined;
  const rows = data?.rows.map((r) => (groupBy === 'country' ? { ...r, label: `${flag(r.label)} ${r.label}` } : r)) ?? [];
  return (
    <Section
      title={kind === 'client' ? 'Client report' : 'Vendor report'}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={byMarket} onChange={(e) => setByMarket(e.target.checked)} />
            {kind === 'client' ? 'By market instead' : 'Split by market'}
          </label>
          <CsvButton disabled={!rows.length} onClick={() => summaryCsv(`${groupBy}-report.csv`, name, rows, sub ?? (byMarket ? null : 'Code'))} />
        </div>
      }
    >
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : (
        <>
          <SummaryTable rows={rows} totals={data.totals} nameHeader={name} subHeader={sub} />
          <p className="-mb-2 mt-7 text-xs text-muted">{data.currencyNote}</p>
        </>
      )}
    </Section>
  );
}

function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const last = Math.max(1, Math.ceil(total / size));
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span className="tabular-nums">{total === 0 ? 0 : (page - 1) * size + 1}–{Math.min(total, page * size)} of {total.toLocaleString()}</span>
      <button className="btn-ghost px-2 py-1 text-xs" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <button className="btn-ghost px-2 py-1 text-xs" disabled={page >= last} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

function StatusFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className="input w-44 py-1.5" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Filter by status">
      <option value="">All statuses</option>
      {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}

function useExport() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function run<T>(path: string, write: (r: Page<T>) => void) {
    setBusy(true);
    setNote(null);
    try {
      const r = await get<Page<T>>(path);
      write(r);
      if (r.truncated) setNote(`Export holds the newest ${r.rows.length.toLocaleString()} of ${r.total.toLocaleString()} rows. Narrow the filters for the rest.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }
  return { busy, note, run };
}

function ConversionTab({ filters }: { filters: Filters }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filters, status]);
  const q = (extra: Record<string, string | number>) => `/reports/conversion${filterQuery(filters, { status, ...extra })}`;
  const { data, error } = useLatest<Page<ConversionRow>>(q({ page, pageSize: PAGE_SIZE }));
  const exp = useExport();
  const exportCsv = () =>
    exp.run<ConversionRow>(q({ export: 1 }), (r) =>
      downloadCsv(
        'conversion-report.csv',
        ['Project', 'Work order', 'Client', 'Market', 'Vendor', 'Vendor code', 'UID', 'Session token', 'Status', 'Status detail', 'Approval', 'S2S verified', 'Revenue', 'Payout', 'Currency', 'LOI (min)', 'Started', 'Outcome at'],
        r.rows.map((s) => [s.projectCode, s.workOrderNo, s.client, s.countryCode, s.vendor, s.vendorCode, s.uid, s.token, s.status, s.statusDetail, s.approval, s.verified ? 'yes' : 'no', s.revenue, s.payout, s.currency, s.loiMinutes, s.startedAt, s.outcomeAt]),
      ),
    );
  return (
    <Section
      title="Conversion report"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusFilter value={status} onChange={setStatus} />
          <CsvButton disabled={!data?.total || exp.busy} onClick={exportCsv} />
        </div>
      }
    >
      {exp.note && <p className="-mt-1 mb-4 text-xs text-warn">{exp.note}</p>}
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : data.rows.length === 0 ? <Empty>No respondents match these filters.</Empty> : (
        <>
          <div className="-mx-5 -mt-5 overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead className="border-b border-line bg-sunken/60">
                <tr><th className="th">UID</th><th className="th">Project</th><th className="th">Client</th><th className="th">Market</th><th className="th">Vendor</th><th className="th">Status</th><th className="th">Approval</th><th className="th text-right">LOI</th><th className="th text-right">Revenue</th><th className="th text-right">Payout</th><th className="th">Started</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((s) => (
                  <tr key={s.id}>
                    <td className="td max-w-[180px] truncate font-mono text-xs" title={`Session token ${s.token}`}>{s.uid}</td>
                    <td className="td"><Link href={`/projects/${s.projectId}`} className="hover:text-brand">{s.projectCode}</Link></td>
                    <td className="td max-w-[160px] truncate">{s.client}</td>
                    <td className="td">{flag(s.countryCode)} {s.countryCode}</td>
                    <td className="td max-w-[160px] truncate">{s.vendor}</td>
                    <td className="td"><OutcomeChip status={s.status} />{s.statusDetail && <span className="ml-1.5 text-xs text-muted">{s.statusDetail.toLowerCase().replace(/_/g, ' ')}</span>}{s.verified && <span className="chip ml-1.5 bg-info/15 text-info" title="Confirmed server to server">S2S</span>}</td>
                    <td className="td text-xs">{s.approval === 'NOT_APPLICABLE' ? '–' : s.approval.toLowerCase()}</td>
                    <td className="td text-right tabular-nums">{s.loiMinutes ?? '–'}</td>
                    <td className="td text-right tabular-nums">{s.revenue == null ? '–' : `${s.currency} ${s.revenue.toFixed(2)}`}</td>
                    <td className="td text-right tabular-nums">{s.payout == null ? '–' : `${s.currency} ${s.payout.toFixed(2)}`}</td>
                    <td className="td text-xs text-muted">{dt(s.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end"><Pager page={page} total={data.total} size={PAGE_SIZE} onPage={setPage} /></div>
        </>
      )}
    </Section>
  );
}

function ClicksTab({ filters }: { filters: Filters }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filters, status]);
  const q = (extra: Record<string, string | number>) => `/reports/clicks${filterQuery(filters, { status, ...extra })}`;
  const { data, error } = useLatest<Page<ClickRow>>(q({ page, pageSize: PAGE_SIZE }));
  const exp = useExport();
  const exportCsv = () =>
    exp.run<ClickRow>(q({ export: 1 }), (r) =>
      downloadCsv('clicks-report.csv', ['Time', 'Event', 'Event status', 'Source', 'Project', 'Market', 'Vendor', 'UID', 'Current respondent status'], r.rows.map((e) => [e.at, e.type, e.status, e.source, e.projectCode, e.countryCode, e.vendor, e.uid, e.sessionStatus])),
    );
  return (
    <Section
      title="Clicks report"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <StatusFilter value={status} onChange={setStatus} />
          <CsvButton disabled={!data?.total || exp.busy} onClick={exportCsv} />
        </div>
      }
    >
      {exp.note && <p className="-mt-1 mb-4 text-xs text-warn">{exp.note}</p>}
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {Object.entries(data.byType ?? {}).map(([k, v]) => <span key={k} className="chip bg-sunken text-ink">{EVENT_LABEL[k] ?? k}: <span className="tabular-nums">{v.toLocaleString()}</span></span>)}
          </div>
          {data.rows.length === 0 ? <Empty>No events match these filters.</Empty> : (
            <>
              <div className="-mx-5 overflow-x-auto border-t border-line">
                <table className="w-full min-w-[900px]">
                  <thead className="border-b border-line bg-sunken/60">
                    <tr><th className="th">Time</th><th className="th">Event</th><th className="th">Status</th><th className="th">Source</th><th className="th">Project</th><th className="th">Market</th><th className="th">Vendor</th><th className="th">UID</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.rows.map((e) => (
                      <tr key={e.id}>
                        <td className="td text-xs text-muted">{dt(e.at)}</td>
                        <td className="td">{EVENT_LABEL[e.type] ?? e.type}</td>
                        <td className="td">{e.status ? <OutcomeChip status={e.status} /> : '–'}</td>
                        <td className="td text-xs">{e.source.toLowerCase().replace(/_/g, ' ')}</td>
                        <td className="td">{e.projectCode}</td>
                        <td className="td">{flag(e.countryCode)} {e.countryCode}</td>
                        <td className="td max-w-[160px] truncate">{e.vendor}</td>
                        <td className="td max-w-[180px] truncate font-mono text-xs">{e.uid}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex justify-end"><Pager page={page} total={data.total} size={PAGE_SIZE} onPage={setPage} /></div>
            </>
          )}
        </>
      )}
    </Section>
  );
}

/** Gate survey and prescreener answers are per project (each project has its own questions). */
function AnswersTab({ projectId, options, onPick }: { projectId: string; options: Options | null; onPick: (id: string) => void }) {
  const project = options?.projects.find((p) => p.id === projectId);
  if (!project) {
    return (
      <Section title="Gate survey and prescreener answers">
        <p className="mb-3 text-sm text-muted">Answers are reported per project, because each project asks its own questions. Pick a project:</p>
        <select className="input max-w-md" value="" onChange={(e) => onPick(e.target.value)} aria-label="Project">
          <option value="">Choose a project…</option>
          {options?.projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode} · {p.name}</option>)}
        </select>
      </Section>
    );
  }
  return (
    <>
      <p className="mb-4 text-sm text-muted">
        <Link href={`/projects/${project.id}`} className="font-medium text-brand hover:underline">{project.projectCode} · {project.name}</Link>. The date range does not apply here; use the status and market filters below.
      </p>
      <AnswersView projectId={project.id} projectCode={project.projectCode} />
    </>
  );
}
