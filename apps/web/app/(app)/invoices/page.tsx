'use client';
import clsx from 'clsx';
import { Download } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { InvoiceStatus } from '@/components/project/finance-tab';
import { Empty, ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { get } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';

interface Row {
  id: string; number: string; status: string; currency: string; total: number; completes: number; createdAt: string; issuedAt: string | null; dueAt: string | null; paidAt: string | null; overdue: boolean;
  project: { id: string; projectCode: string; name: string }; client: { id: string; name: string; code: string };
}
const STATUSES = ['', 'DRAFT', 'SENT', 'PAID', 'VOID'] as const;
const amt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const date = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

function Invoices() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get('status') ?? '';
  const projectId = params.get('projectId') ?? '';
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setRows(null);
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (projectId) q.set('projectId', projectId);
    get<Row[]>(`/invoices?${q}`).then(setRows).catch(setError);
  }, [status, projectId]);

  const totals = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of rows ?? []) if (r.status !== 'VOID') by.set(r.currency, (by.get(r.currency) ?? 0) + r.total);
    return [...by];
  }, [rows]);

  const setStatus = (s: string) => {
    const q = new URLSearchParams(params.toString());
    if (s) q.set('status', s);
    else q.delete('status');
    router.replace(`/invoices${q.size ? `?${q}` : ''}`);
  };

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Client invoices for approved completes. Create them from a project's Reconcile & invoice tab."
        actions={
          <button
            className="btn-ghost"
            disabled={!rows?.length}
            onClick={() => downloadCsv(`samptrek-invoices-${new Date().toISOString().slice(0, 10)}.csv`,
              ['Number', 'Status', 'Client', 'Project', 'Project name', 'Currency', 'Total', 'Completes', 'Created', 'Issued', 'Due', 'Paid'],
              (rows ?? []).map((r) => [r.number, r.overdue ? 'OVERDUE' : r.status, r.client.name, r.project.projectCode, r.project.name, r.currency, r.total.toFixed(2), r.completes, r.createdAt.slice(0, 10), r.issuedAt?.slice(0, 10), r.dueAt?.slice(0, 10), r.paidAt?.slice(0, 10)]))}
          >
            <Download className="h-4 w-4" /> CSV
          </button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="Status">
          {STATUSES.map((s) => (
            <button key={s || 'all'} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={clsx('rounded-md px-3 py-1.5 text-sm', status === s ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>
              {s ? s.charAt(0) + s.slice(1).toLowerCase() : 'All'}
            </button>
          ))}
        </div>
        {projectId && <button className="chip border border-line text-muted hover:bg-sunken" onClick={() => router.replace(status ? `/invoices?status=${status}` : '/invoices')}>One project only ×</button>}
        {totals.length > 0 && <span className="ml-auto text-sm text-muted">Total: {totals.map(([c, t]) => `${c} ${amt.format(t)}`).join(' · ')}</span>}
      </div>
      <ErrorBox error={error} />
      <Section title={`${rows?.length ?? ''} invoice${rows?.length === 1 ? '' : 's'}`}>
        {!rows ? <Loading /> : rows.length === 0 ? (
          <Empty>No invoices here yet.</Empty>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr><th className="th">Number</th><th className="th">Status</th><th className="th">Client</th><th className="th">Project</th><th className="th text-right">Completes</th><th className="th text-right">Total</th><th className="th">Due</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line hover:bg-sunken/50">
                    <td className="td"><Link href={`/invoices/${r.id}`} className="font-mono text-brand hover:underline">{r.number}</Link></td>
                    <td className="td"><InvoiceStatus status={r.status} overdue={r.overdue} /></td>
                    <td className="td">{r.client.name}</td>
                    <td className="td"><Link href={`/projects/${r.project.id}`} className="hover:underline">{r.project.projectCode}</Link> <span className="text-xs text-muted">{r.project.name}</span></td>
                    <td className="td text-right tabular-nums">{r.completes}</td>
                    <td className="td text-right tabular-nums">{r.currency} {amt.format(r.total)}</td>
                    <td className={clsx('td', r.overdue && 'text-bad')}>{r.status === 'PAID' ? `Paid ${date(r.paidAt)}` : date(r.dueAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

export default function InvoicesPage() {
  return <Suspense fallback={<Loading />}><Invoices /></Suspense>;
}
