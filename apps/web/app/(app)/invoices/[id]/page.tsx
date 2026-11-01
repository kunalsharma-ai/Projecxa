'use client';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { TaxEditor, TotalsFoot } from '@/components/finance/totals';
import { InvoiceStatus } from '@/components/project/finance-tab';
import { ErrorBox, Loading } from '@/components/ui';
import { api, get } from '@/lib/api';
import { flag } from '@/lib/countries';

interface Invoice {
  id: string; number: string; status: 'DRAFT' | 'SENT' | 'PAID' | 'VOID'; currency: string; subtotal: number; taxName: string | null; taxPercent: number; taxAmount: number; total: number; completes: number; notes: string | null;
  createdAt: string; issuedAt: string | null; dueAt: string | null; paidAt: string | null; voidedAt: string | null; overdue: boolean; issuer: string;
  lines: { countryCode: string; description: string; quantity: number; unitPrice: number; amount: number }[];
  project: { id: string; projectCode: string; name: string; workOrderNo: string | null }; client: { id: string; name: string; code: string };
}
const amt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const date = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '–');

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const editable = canEdit(me);
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dueDays, setDueDays] = useState(30);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => get<Invoice>(`/invoices/${id}`).then((x) => { setInv(x); setNotes(x.notes ?? ''); }).catch(setError), [id]);
  useEffect(() => { load(); }, [load]);

  async function change(body: object, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      setInv(await api<Invoice>(`/invoices/${id}`, { method: 'PATCH', json: body }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!inv) return error ? <ErrorBox error={error} /> : <Loading />;
  const notesDirty = (inv.notes ?? '') !== notes;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/invoices" className="flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Invoices</Link>
        <div className="flex flex-wrap items-center gap-2">
          {editable && inv.status === 'DRAFT' && (
            <>
              <label className="flex items-center gap-1.5 text-sm text-muted">Due in <input type="number" min={0} max={180} className="input w-20 py-1.5" value={dueDays} onChange={(e) => setDueDays(Math.max(0, Math.min(180, Number(e.target.value) || 0)))} /> days</label>
              <button className="btn-primary" disabled={busy || notesDirty} title={notesDirty ? 'Save the notes first' : undefined} onClick={() => change({ status: 'SENT', dueDays }, `Mark ${inv.number} as sent to ${inv.client.name}? Its lines can no longer change.`)}>Mark as sent</button>
            </>
          )}
          {editable && inv.status === 'SENT' && <button className="btn-primary" disabled={busy} onClick={() => change({ status: 'PAID' }, `Record payment of ${inv.currency} ${amt.format(inv.total)} for ${inv.number}?`)}>Mark as paid</button>}
          {editable && (inv.status === 'DRAFT' || inv.status === 'SENT') && <button className="btn-danger" disabled={busy} onClick={() => change({ status: 'VOID' }, `Void ${inv.number}? Its ${inv.completes} completes go back to “ready to invoice”.`)}>Void</button>}
          <button className="btn-ghost" onClick={() => window.print()}><Printer className="h-4 w-4" />Print or save PDF</button>
        </div>
      </div>
      <ErrorBox error={error} />

      <article className="print-area card p-6 sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-xl font-semibold">{inv.issuer}</div>
            <div className="mt-1 text-sm text-muted">Fieldwork services</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tracking-tight">Invoice</div>
            <div className="mt-1 font-mono text-sm">{inv.number}</div>
            <div className="mt-2"><InvoiceStatus status={inv.status} overdue={inv.overdue} /></div>
          </div>
        </header>

        <section className="mt-8 grid grid-cols-1 gap-6 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">Bill to</div>
            <div className="mt-1 font-medium">{inv.client.name}</div>
            <div className="text-muted">Client code {inv.client.code}</div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">Project</div>
            <div className="mt-1 font-medium">{inv.project.projectCode}</div>
            <div className="text-muted">{inv.project.name}</div>
            {inv.project.workOrderNo && <div className="text-muted">Work order {inv.project.workOrderNo}</div>}
          </div>
          <dl className="space-y-1">
            <div className="flex justify-between gap-3"><dt className="text-muted">Issued</dt><dd>{inv.issuedAt ? date(inv.issuedAt) : 'Not sent yet'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Due</dt><dd className={inv.overdue ? 'font-medium text-bad' : ''}>{date(inv.dueAt)}</dd></div>
            {inv.paidAt && <div className="flex justify-between gap-3"><dt className="text-muted">Paid</dt><dd>{date(inv.paidAt)}</dd></div>}
            {inv.voidedAt && <div className="flex justify-between gap-3"><dt className="text-muted">Voided</dt><dd>{date(inv.voidedAt)}</dd></div>}
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
              {inv.lines.map((l, i) => (
                <tr key={i} className="border-b border-line">
                  <td className="py-2.5 pr-3">{flag(l.countryCode)} {l.description}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{amt.format(l.unitPrice)}</td>
                  <td className="py-2.5 pl-3 text-right tabular-nums">{amt.format(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <TotalsFoot doc={inv} />
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">{inv.completes} approved completes.{inv.taxAmount > 0 ? '' : ' No tax applied.'}</p>
        {editable && inv.status === 'DRAFT' && <TaxEditor doc={inv} busy={busy} onSave={(b) => change(b)} />}

        {editable && inv.status === 'DRAFT' ? (
          <div className="no-print mt-8">
            <label className="label" htmlFor="notes">Notes on the invoice (PO number, bank details, terms)</label>
            <textarea id="notes" className="input min-h-20" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            {notesDirty && <button className="btn-ghost mt-2" disabled={busy} onClick={() => change({ notes: notes || null })}>Save notes</button>}
          </div>
        ) : null}
        {inv.notes && <div className={editable && inv.status === 'DRAFT' ? 'hidden print:block' : 'mt-8'}><div className="text-xs font-medium uppercase tracking-wide text-muted">Notes</div><p className="mt-1 whitespace-pre-wrap text-sm">{inv.notes}</p></div>}
      </article>
    </div>
  );
}
