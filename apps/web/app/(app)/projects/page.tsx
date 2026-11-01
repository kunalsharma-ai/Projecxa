'use client';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading, PageHeader, Progress, StatusChip } from '@/components/ui';
import { get } from '@/lib/api';
import { flag } from '@/lib/countries';
import { CATEGORIES } from '@/lib/types';

interface Row {
  id: string; projectCode: string; workOrderNo: string | null; name: string; status: string; category: string;
  client: { name: string }; projectManager: { name: string };
  countries: string[]; liveCountries: number; targetCompletes: number; completes: number; terminates: number;
  overquotas: number; dropouts: number; inProgress: number; qualityFails: number; loiMinutes: number | null; irPercent: number | null;
  redirectMode: string; createdAt: string;
}

export default function ProjectsPage() {
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: Row[]; pageSize: number } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) params.set('status', status);
    if (category) params.set('category', category);
    if (q) params.set('q', q);
    const t = setTimeout(() => get<typeof data>(`/projects?${params}`).then(setData).catch(setError), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [status, category, q, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={data ? `${data.total} projects` : undefined}
        actions={<Link href="/projects/new" className="btn-primary"><Plus className="h-4 w-4" /> Create project</Link>}
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
      ) : data.items.length === 0 ? (
        <Empty>No projects match these filters.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line bg-sunken/60">
              <tr>
                <th className="th">Status</th><th className="th">Project</th><th className="th">Client</th><th className="th">Markets</th>
                <th className="th">Completes</th><th className="th text-right">Terms</th><th className="th text-right">Overquota</th>
                <th className="th text-right">Dropouts</th><th className="th text-right">LOI</th><th className="th text-right">IR</th>
                <th className="th">Manager</th><th className="th">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((r) => (
                <tr key={r.id} className="hover:bg-sunken/40">
                  <td className="td"><StatusChip status={r.status} /></td>
                  <td className="td max-w-[340px]">
                    <Link href={`/projects/${r.id}`} className="block truncate font-medium text-brand hover:underline">{r.name}</Link>
                    <div className="text-xs text-muted">{r.projectCode}{r.workOrderNo ? ` · ${r.workOrderNo}` : ''} · {r.category} · {r.redirectMode.toLowerCase()}</div>
                  </td>
                  <td className="td">{r.client.name}</td>
                  <td className="td" title={r.countries.join(', ')}>
                    <span className="text-base leading-none">{r.countries.slice(0, 5).map(flag).join(' ')}</span>
                    {r.countries.length > 5 && <span className="ml-1 text-xs text-muted">+{r.countries.length - 5}</span>}
                  </td>
                  <td className="td"><Progress value={r.completes} max={r.targetCompletes} /></td>
                  <td className="td text-right tabular-nums">{r.terminates}</td>
                  <td className="td text-right tabular-nums">{r.overquotas}</td>
                  <td className="td text-right tabular-nums">{r.dropouts}</td>
                  <td className="td text-right tabular-nums">{r.loiMinutes ?? '–'}</td>
                  <td className="td text-right tabular-nums">{r.irPercent != null ? `${r.irPercent}%` : '–'}</td>
                  <td className="td">{r.projectManager.name}</td>
                  <td className="td text-muted">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
