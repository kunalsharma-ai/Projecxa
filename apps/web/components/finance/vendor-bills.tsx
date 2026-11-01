'use client';
import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BillDocument, type Bill } from '@/components/finance/bill-document';
import { BillStatus } from '@/components/finance/bill-status';
import { Empty, ErrorBox, Loading, Section } from '@/components/ui';
import { get } from '@/lib/api';

const amt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const date = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

/** Vendor portal: the bills we approved or paid for this vendor. */
export function VendorBills() {
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [open, setOpen] = useState<Bill | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { get<Bill[]>('/portal/vendor/bills').then(setBills).catch(setError); }, []);

  if (open) {
    return (
      <div>
        <div className="no-print mb-3 flex items-center justify-between">
          <button className="flex items-center gap-1 text-sm text-muted hover:text-ink" onClick={() => setOpen(null)}><ArrowLeft className="h-4 w-4" /> All statements</button>
          <button className="btn-ghost" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print or save PDF</button>
        </div>
        <BillDocument bill={open} />
      </div>
    );
  }
  return (
    <Section title="Payment statements">
      <p className="mb-3 text-sm text-muted">Bills for your approved completes once they are approved for payment, and when they were paid. Send your own invoice with the bill number as reference.</p>
      <ErrorBox error={error} />
      {!bills ? <Loading /> : bills.length === 0 ? <Empty>No statements yet.</Empty> : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[600px] text-sm">
            <thead><tr><th className="th">Bill</th><th className="th">Status</th><th className="th text-right">Completes</th><th className="th text-right">Total</th><th className="th">Due</th><th className="th">Paid</th></tr></thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id} className="border-t border-line hover:bg-sunken/50">
                  <td className="td"><button className="font-mono text-brand hover:underline" onClick={() => get<Bill>(`/portal/vendor/bills/${b.id}`).then(setOpen).catch(setError)}>{b.number}</button></td>
                  <td className="td"><BillStatus status={b.status} overdue={b.overdue} /></td>
                  <td className="td text-right tabular-nums">{b.completes}</td>
                  <td className="td text-right tabular-nums">{b.currency} {amt.format(b.total)}</td>
                  <td className="td">{date(b.dueAt)}</td>
                  <td className="td">{b.paidAt ? `${date(b.paidAt)}${b.paymentReference ? ` · ${b.paymentReference}` : ''}` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
