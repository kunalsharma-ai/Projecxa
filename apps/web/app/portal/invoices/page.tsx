'use client';
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading, money, PageHeader } from '@/components/ui';
import { get } from '@/lib/api';
import { downloadFile } from '@/lib/download';

interface Invoice { id: string; number: string; status: 'SENT' | 'PAID'; currency: string; total: number; completes: number; issuedAt: string | null; dueAt: string | null; paidAt: string | null; overdue: boolean; project: { projectCode: string; name: string } }
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

export default function PortalInvoicesPage() {
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    get<Invoice[]>('/portal/client/invoices').then(setRows).catch(setError);
  }, []);
  return (
    <>
      <PageHeader title="Invoices" subtitle="Invoices we have sent you, with the PDF." />
      <ErrorBox error={error} />
      {!rows ? (
        !error && <Loading />
      ) : rows.length === 0 ? (
        <Empty>No invoices yet.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-line bg-sunken/60"><tr><th className="th">Invoice</th><th className="th">Project</th><th className="th">Issued</th><th className="th">Due</th><th className="th">Status</th><th className="th text-right">Completes</th><th className="th text-right">Total</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="td font-medium">{r.number}</td>
                  <td className="td">{r.project.projectCode} <span className="text-muted">{r.project.name}</span></td>
                  <td className="td">{day(r.issuedAt)}</td>
                  <td className="td">{day(r.dueAt)}</td>
                  <td className="td">{r.status === 'PAID' ? <span className="chip bg-ok/15 text-ok">Paid {day(r.paidAt)}</span> : r.overdue ? <span className="chip bg-bad/15 text-bad">Overdue</span> : <span className="chip bg-info/15 text-info">Due</span>}</td>
                  <td className="td text-right tabular-nums">{r.completes.toLocaleString()}</td>
                  <td className="td text-right tabular-nums">{money(r.total, r.currency)}</td>
                  <td className="td text-right"><button className="btn-ghost px-2 py-1 text-xs" onClick={() => downloadFile(`/portal/client/invoices/${r.id}/pdf`, `${r.number}.pdf`).catch(setError)}><Download className="h-3.5 w-3.5" /> PDF</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
