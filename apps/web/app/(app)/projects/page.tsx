'use client';
import { CopyIcon, Copyable } from '@/components/copy';
import { ChevronLeft, ChevronRight, Download, LayoutTemplate, Pause, Play, Plus, Search, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useBriefAvailability } from '@/components/project/brief-reader';
import { useEffect, useState } from 'react';
import { DataGrid, type GridColumn, type Sort } from '@/components/data-grid';
import { Empty, ErrorBox, Loading, PageHeader, Progress, StatusChip } from '@/components/ui';
import { get, post } from '@/lib/api';
import { flag } from '@/lib/countries';
import { downloadCsv } from '@/lib/csv';
import { CATEGORIES } from '@/lib/types';
import { useCustomOptions } from '@/components/form/option-select';

interface Row {
  id: string; projectCode: string; workOrderNo: string | null; name: string; status: string; category: string;
  client: { name: string }; projectManager: { name: string }; salesPerson: { name: string } | null; type: string;
  countries: string[]; liveCountries: number; links: { live: number; total: number }; targetCompletes: number; completes: number; terminates: number;
  overquotas: number; dropouts: number; inProgress: number; qualityFails: number; loiMinutes: number | null; irPercent: number | null;
  redirectMode: string; fieldStartAt: string | null; fieldEndAt: string | null; createdAt: string;
}

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '–');
type Pick = { has: (id: string) => boolean; toggle: (id: string) => void };
const columns = (pick: Pick): GridColumn<Row>[] => [
  {
    id: 'project', header: 'Project', sortKey: 'name', pinned: true, width: 320,
    cell: (r) => (
      <div className="flex max-w-[340px] items-start gap-2.5">
        <input type="checkbox" className="mt-1 shrink-0" aria-label={`Select ${r.name}`} checked={pick.has(r.id)} onChange={() => pick.toggle(r.id)} />
        <div className="min-w-0">
          <Link href={`/projects/${r.id}`} className="block truncate font-medium text-brand hover:underline">{r.name}</Link>
          <div className="flex items-center text-xs text-muted"><span className="truncate">{r.projectCode}{r.workOrderNo ? ` · ${r.workOrderNo}` : ''} · {r.category} · {r.redirectMode.toLowerCase()}</span><CopyIcon text={r.projectCode} label={`${r.name} project ID`} /></div>
        </div>
      </div>
    ),
  },
  { id: 'status', header: 'Status', sortKey: 'status', cell: (r) => <StatusChip status={r.status} /> },
  { id: 'code', header: 'Project ID', sortKey: 'code', defaultHidden: true, cell: (r) => <Copyable text={r.projectCode} label="project ID" mono className="text-xs" /> },
  { id: 'client', header: 'Client', sortKey: 'client', cell: (r) => <span className="whitespace-nowrap">{r.client.name}</span> },
  {
    id: 'markets', header: 'Markets', title: 'Markets in this project',
    cell: (r) => (
      <span title={`${r.countries.length} markets: ${r.countries.join(', ')}`} className="whitespace-nowrap">
        <span className="text-base leading-none">{[...new Set(r.countries)].slice(0, 5).map(flag).join(' ')}</span>
        {new Set(r.countries).size > 5 && <span className="ml-1 text-xs text-muted">+{new Set(r.countries).size - 5}</span>}
      </span>
    ),
  },
  {
    id: 'links', header: 'Links', title: 'Entry links taking respondents now / all links',
    cell: (r) => <span className={r.links.total && r.links.live === r.links.total ? 'text-ok' : r.links.live ? '' : 'text-muted'} title={`${r.links.live} of ${r.links.total} vendor links accept respondents now`}>{r.links.live}/{r.links.total}</span>,
  },
  { id: 'completes', header: 'Completes', width: 170, cell: (r) => <Progress value={r.completes} max={r.targetCompletes} /> },
  { id: 'terms', header: 'Terms', align: 'right', cell: (r) => r.terminates },
  { id: 'overquota', header: 'Overquota', align: 'right', cell: (r) => r.overquotas },
  { id: 'dropouts', header: 'Dropouts', align: 'right', cell: (r) => r.dropouts },
  { id: 'inProgress', header: 'In survey', align: 'right', defaultHidden: true, cell: (r) => r.inProgress },
  { id: 'quality', header: 'Quality fails', align: 'right', defaultHidden: true, cell: (r) => r.qualityFails },
  { id: 'loi', header: 'LOI', align: 'right', cell: (r) => r.loiMinutes ?? '–' },
  { id: 'ir', header: 'IR', align: 'right', cell: (r) => (r.irPercent != null ? `${r.irPercent}%` : '–') },
  { id: 'manager', header: 'Manager', sortKey: 'manager', cell: (r) => <span className="whitespace-nowrap">{r.projectManager.name}</span> },
  { id: 'sales', header: 'Sales person', defaultHidden: true, cell: (r) => r.salesPerson?.name ?? '–' },
  { id: 'fieldEnd', header: 'Field ends', sortKey: 'fieldEnd', defaultHidden: true, cell: (r) => <span className="whitespace-nowrap">{day(r.fieldEndAt)}</span> },
  { id: 'created', header: 'Created', sortKey: 'created', cell: (r) => <span className="whitespace-nowrap text-muted">{day(r.createdAt)}</span> },
];

const STATUSES = ['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED', 'INVOICED'];

export default function ProjectsPage() {
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort | null>(null);
  const [data, setData] = useState<{ total: number; items: Row[]; pageSize: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [bulk, setBulk] = useState<{ busy: boolean; note: string | null; failed: string[] }>({ busy: false, note: null, failed: [] });
  const pick: Pick = { has: (id) => picked.includes(id), toggle: (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])) };

  /** Live ⇄ Hold for every ticked project; each is checked on its own (a project without a live link stays as it is). */
  async function setStatusFor(status: 'LIVE' | 'HOLD') {
    setBulk({ busy: true, note: null, failed: [] });
    try {
      const r = await post<{ changed: number; results: { id: string; ok: boolean; error?: string; issues?: string[]; notReady?: { market: string; problems: string[] }[] }[] }>('/projects/bulk-status', { ids: picked, status });
      const name = (id: string) => data?.items.find((x) => x.id === id)?.name ?? id;
      const failed = r.results.filter((x) => !x.ok).map((x) => `${name(x.id)}: ${x.error}${x.issues?.length ? ` (${x.issues.join('; ')})` : ''}`);
      const partial = r.results.filter((x) => x.ok && x.notReady?.length).map((x) => `${name(x.id)} is live, but not in ${x.notReady!.map((n) => `${n.market} (${n.problems.join(' and ')})`).join(', ')}`);
      setBulk({ busy: false, note: `${r.changed} of ${picked.length} ${status === 'LIVE' ? 'set live' : 'put on hold'}.`, failed: [...failed, ...partial] });
      setPicked(r.results.filter((x) => !x.ok).map((x) => x.id));
      setReloadKey((k) => k + 1);
    } catch (e) {
      setBulk({ busy: false, note: null, failed: [] });
      setError(e);
    }
  }
  // Deep links such as /projects?status=LIVE (from the dashboard's project counts).
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('status');
    if (s && STATUSES.includes(s)) setStatus(s);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) params.set('status', status);
    if (category) params.set('category', category);
    if (q) params.set('q', q);
    if (sort) {
      params.set('sort', sort.key);
      params.set('dir', sort.dir);
    }
    let current = true; // ignore responses for filters the user has already changed
    const t = setTimeout(() => get<typeof data>(`/projects?${params}`).then((d) => current && setData(d)).catch(setError), q ? 250 : 0);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [status, category, q, page, sort, reloadKey]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const [exporting, setExporting] = useState(false);

  /** Every project matching the filters (not just this page), 100 per request. */
  async function exportCsv() {
    setExporting(true);
    try {
      const rows: Row[] = [];
      for (let p = 1; ; p++) {
        const params = new URLSearchParams({ page: String(p), pageSize: '100' });
        if (status) params.set('status', status);
        if (category) params.set('category', category);
        if (q) params.set('q', q);
        if (sort) {
          params.set('sort', sort.key);
          params.set('dir', sort.dir);
        }
        const d = await get<{ total: number; items: Row[] }>(`/projects?${params}`);
        rows.push(...d.items);
        if (rows.length >= d.total || d.items.length === 0 || p >= 100) break;
      }
      downloadCsv(
        `samptrek-projects-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Project ID', 'Work order', 'Name', 'Status', 'Category', 'Type', 'Client', 'Project manager', 'Sales person', 'Markets', 'Live links', 'Total links', 'Target', 'Completes', 'Terminates', 'Overquotas', 'Dropouts', 'In progress', 'Quality fails', 'LOI (min)', 'IR %', 'Redirect mode', 'Created'],
        rows.map((r) => [r.projectCode, r.workOrderNo, r.name, r.status, r.category, r.type, r.client.name, r.projectManager?.name, r.salesPerson?.name, r.countries.join(' '), r.links.live, r.links.total, r.targetCompletes, r.completes, r.terminates, r.overquotas, r.dropouts, r.inProgress, r.qualityFails, r.loiMinutes, r.irPercent, r.redirectMode, r.createdAt.slice(0, 10)]),
      );
    } catch (e) {
      setError(e);
    } finally {
      setExporting(false);
    }
  }

  const briefAvailable = useBriefAvailability();
  const ownCategories = useCustomOptions('category');
  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={data ? `${data.total} projects` : undefined}
        actions={
          <>
            <button className="btn-ghost" disabled={!data?.total || exporting} onClick={exportCsv}><Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'CSV'}</button>
            <Link href="/projects/templates" className="btn-ghost"><LayoutTemplate className="h-4 w-4" /> Templates</Link>
            {briefAvailable && <Link href="/projects/new?brief=1" className="btn-ghost"><Sparkles className="h-4 w-4" /> From a brief</Link>}
            <Link href="/projects/new" className="btn-primary"><Plus className="h-4 w-4" /> Create project</Link>
          </>
        }
      />
      <div className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_180px_220px]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input className="input pl-9" placeholder="Search name, project ID or work order" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </label>
        <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Project status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
        </select>
        <select className="input" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="Category">
          <option value="">All categories</option>
          {[...CATEGORIES, ...ownCategories.filter((c) => !CATEGORIES.includes(c))].map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <ErrorBox error={error} />
      {(picked.length > 0 || bulk.note) && (
        <div className="card mb-4 p-3 text-sm" role="status">
          <div className="flex flex-wrap items-center gap-2">
            {picked.length > 0 && (
              <>
                <span className="font-medium">{picked.length} selected</span>
                <button className="btn-primary px-3 py-1.5 text-xs" disabled={bulk.busy} onClick={() => setStatusFor('LIVE')}><Play className="h-3.5 w-3.5" /> Set live</button>
                <button className="btn-ghost px-3 py-1.5 text-xs" disabled={bulk.busy} onClick={() => setStatusFor('HOLD')}><Pause className="h-3.5 w-3.5" /> Put on hold</button>
                <button className="btn-ghost px-2 py-1.5 text-xs" onClick={() => setPicked([])}><X className="h-3.5 w-3.5" /> Clear</button>
              </>
            )}
            {bulk.note && <span className="text-muted">{bulk.note}</span>}
          </div>
          {bulk.failed.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-warn">{bulk.failed.map((f) => <li key={f}>{f}</li>)}</ul>
          )}
        </div>
      )}
      {!data ? (
        <Loading />
      ) : (
        <DataGrid
          id="projects"
          columns={columns(pick)}
          rows={data.items}
          rowKey={(r) => r.id}
          sort={sort}
          onSort={(s) => { setSort(s); setPage(1); }}
          empty={<Empty>No projects match these filters.</Empty>}
          toolbar={<span className="flex flex-wrap items-center gap-3 text-xs text-muted"><label className="flex items-center gap-1.5 text-ink"><input type="checkbox" checked={data.items.length > 0 && data.items.every((r) => picked.includes(r.id))} onChange={(e) => setPicked(e.target.checked ? [...new Set([...picked, ...data.items.map((r) => r.id)])] : picked.filter((id) => !data.items.some((r) => r.id === id)))} /> Select page</label><span>{data.total} project{data.total === 1 ? '' : 's'}{sort ? '' : ' · newest first'} · tick projects to set them live or on hold together</span></span>}
        />
      )}
      {data && pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <button className="btn-ghost px-2" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
          <span className="tabular-nums text-muted">Page {page} of {pages}</span>
          <button className="btn-ghost px-2" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}
    </>
  );
}
