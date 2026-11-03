'use client';
import { ReactNode } from 'react';
import { BillStatus } from '@/components/finance/bill-status';
import { TotalsFoot } from '@/components/finance/totals';
import { flag } from '@/lib/countries';

export interface Bill {
  id: string; number: string; status: 'DRAFT' | 'APPROVED' | 'PAID' | 'VOID'; currency: string; completes: number; notes: string | null;
  subtotal: number; taxName: string | null; taxPercent: number; taxAmount: number; total: number;
  vendorReference: string | null; paymentReference: string | null; periodTo: string | null;
  createdAt: string; approvedAt: string | null; dueAt: string | null; paidAt: string | null; voidedAt: string | null; overdue: boolean; payer: string;
  lines: { projectCode: string; countryCode: string; description: string; quantity: number; unitPrice: number; amount: number }[];
  vendor: { id: string; name: string; code: string };
}
const amt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const date = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '–');

/** Printable vendor bill, shared by the staff page and the vendor portal. */
export function BillDocument({ bill, children }: { bill: Bill; children?: ReactNode }) {
  return (
    <article className="print-area card p-6 sm:p-10">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="text-xl font-semibold">{bill.payer}</div>
          <div className="mt-1 text-sm text-muted">Payable to vendor</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tracking-tight">Vendor bill</div>
          <div className="mt-1 font-mono text-sm">{bill.number}</div>
          <div className="mt-2"><BillStatus status={bill.status} overdue={bill.overdue} /></div>
        </div>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-6 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Vendor</div>
          <div className="mt-1 font-medium">{bill.vendor.name}</div>
          <div className="text-muted">Vendor code {bill.vendor.code}</div>
          {bill.vendorReference && <div className="text-muted">Their invoice {bill.vendorReference}</div>}
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Covers</div>
          <div className="mt-1">{bill.completes} approved completes</div>
          <div className="text-muted">{bill.periodTo ? `Up to ${date(bill.periodTo)}` : `Up to ${date(bill.createdAt)}`}</div>
        </div>
        <dl className="space-y-1">
          <div className="flex justify-between gap-3"><dt className="text-muted">Created</dt><dd>{date(bill.createdAt)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Approved</dt><dd>{bill.approvedAt ? date(bill.approvedAt) : 'Not yet'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Due</dt><dd className={bill.overdue ? 'font-medium text-bad' : ''}>{date(bill.dueAt)}</dd></div>
          {bill.paidAt && <div className="flex justify-between gap-3"><dt className="text-muted">Paid</dt><dd>{date(bill.paidAt)}</dd></div>}
          {bill.paymentReference && <div className="flex justify-between gap-3"><dt className="text-muted">Payment ref.</dt><dd className="font-mono text-xs">{bill.paymentReference}</dd></div>}
          {bill.voidedAt && <div className="flex justify-between gap-3"><dt className="text-muted">Voided</dt><dd>{date(bill.voidedAt)}</dd></div>}
        </dl>
      </section>

      <div className="-mx-2 mt-8 overflow-x-auto px-2">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b-2 border-line text-left">
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Quantity</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Unit price</th>
              <th className="py-2 pl-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((l, i) => (
              <tr key={i} className="border-b border-line">
                <td className="py-2.5 pr-3">{flag(l.countryCode)} {l.description}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{l.quantity}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{amt.format(l.unitPrice)}</td>
                <td className="py-2.5 pl-3 text-right tabular-nums">{amt.format(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <TotalsFoot doc={bill} />
        </table>
      </div>
      {children}
      {bill.notes && <div className={children ? 'hidden print:block' : 'mt-8'}><div className="text-xs font-medium uppercase tracking-wide text-muted">Notes</div><p className="mt-1 whitespace-pre-wrap text-sm">{bill.notes}</p></div>}
    </article>
  );
}
