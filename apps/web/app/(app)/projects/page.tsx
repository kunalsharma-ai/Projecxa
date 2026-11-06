'use client';
import { ChevronLeft, ChevronRight, Download, LayoutTemplate, Plus, Search, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useBriefAvailability } from '@/components/project/brief-reader';
import { useEffect, useState } from 'react';
import { DataGrid, type GridColumn, type Sort } from '@/components/data-grid';
import { Empty, ErrorBox, Loading, PageHeader, Progress, StatusChip } from '@/components/ui';
import { get } from '@/lib/api';
import { flag } from '@/lib/countries';
import { downloadCsv } from '@/lib/csv';
import { CATEGORIES } from '@/lib/types';

interface Row {
  id: string; projectCode: string; workOrderNo: string | null; name: string; status: string; category: string;
  client: { name: string }; projectManager: { name: string }; salesPerson: { name: string } | null; type: string;
  countries: string[]; liveCountries: number; links: { live: number; total: number }; targetCompletes: number; completes: number; terminates: number;
  overquotas: number; dropouts: number; inProgress: number; qualityFails: number; loiMinutes: number | null; irPercent: number | null;
  redirectMode: string; fieldStartAt: string | null; fieldEndAt: string | null; createdAt: string;
}

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '–');
const COLUMNS: GridColumn<Row>[] = [
  {
    id: 'project', header: 'Project', sortKey: 'name', pinned: true, width: 300,
    cell: (r) => (
      <div className="max-w-[320px]">
        <Link href={`/projects/${r.id}`} className="block truncate font-medium text-brand hover:underline">{r.name}</Link>
        <div className="truncate text-xs text-muted">{r.projectCode}{r.workOrderNo ? ` · ${r.workOrderNo}` : ''} · {r.category} · {r.redirectMode.toLowerCase()}</div>
      </div>
    ),
  },
  { id: 'status', header: 'Status', sortKey: 'status', cell: (r) => <StatusChip status={r.status} /> },
  { id: 'code', header: 'Project ID', sortKey: 'code', defaultHidden: true, cell: (r) => <span className="font-mono text-xs">{r.projectCode}</span> },
  { id: 'client', header: 'Client', sortKey: 'client', cell: (r) => <span className="whitespace-nowrap">{r.client.name}</span> },
  {
    id: 'markets', header: 'Markets', title: 'Markets in this project',
    cell: (r) => (
      <span title={r.countries.join(', ')} className="whitespace-nowrap">
        <span className="text-base leading-none">{r.countries.slice(0, 5).map(flag).join(' ')}</span>
        {r.countries.length > 5 && <span className="ml-1 text-xs text-muted">+{r.countries.length - 5}</span>}
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

export default function ProjectsPage() {
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort | null>(null);
  const [data, setData] = useState<{ total: number; items: Row[]; pageSize: number } | null>(null);
  const [error, setError] = useState<unknown>(null);

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
  }, [status, category, q, page, sort]);

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
          {['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED', 'INVOICED'].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
        </select>
        <select className="input" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="Category">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : (
        <DataGrid
          id="projects"
          columns={COLUMNS}
          rows={data.items}
          rowKey={(r) => r.id}
          sort={sort}
          onSort={(s) => { setSort(s); setPage(1); }}
          empty={<Empty>No projects match these filters.</Empty>}
          toolbar={<span className="text-xs text-muted">{data.total} project{data.total === 1 ? '' : 's'}{sort ? '' : ' · newest first'} · click a header to sort, drag its edge to resize</span>}
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
