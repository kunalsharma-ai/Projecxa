'use client';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BillDocument, type Bill } from '@/components/finance/bill-document';
import { TaxEditor } from '@/components/finance/totals';
import { canEdit, useMe } from '@/components/me';
import { ErrorBox, Loading } from '@/components/ui';
import { api, get } from '@/lib/api';
import { Label } from '@/components/help';

const amt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export default function BillPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const editable = canEdit(me);
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dueDays, setDueDays] = useState(30);
  const [vendorRef, setVendorRef] = useState('');
  const [payRef, setPayRef] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => get<Bill>(`/payables/bills/${id}`).then((b) => { setBill(b); setNotes(b.notes ?? ''); setVendorRef(b.vendorReference ?? ''); }).catch(setError), [id]);
  useEffect(() => { load(); }, [load]);

  async function change(body: object, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const b = await api<Bill>(`/payables/bills/${id}`, { method: 'PATCH', json: body });
      setBill(b);
      setNotes(b.notes ?? '');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!bill) return error ? <ErrorBox error={error} /> : <Loading />;
  const notesDirty = (bill.notes ?? '') !== notes;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/payables" className="flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Vendor payables</Link>
        <div className="flex flex-wrap items-center gap-2">
          {editable && (bill.status === 'DRAFT' || bill.status === 'APPROVED') && (
            <button className="btn-danger" disabled={busy} onClick={() => change({ status: 'VOID' }, `Void ${bill.number}? Its ${bill.completes} completes go back to “approved, not billed”.`)}>Void</button>
          )}
          <button className="btn-ghost" onClick={() => window.print()}><Printer className="h-4 w-4" />Print or save PDF</button>
        </div>
      </div>
      <ErrorBox error={error} />

      {editable && bill.status === 'DRAFT' && (
        <div className="no-print card mb-4 flex flex-wrap items-end gap-3 p-4">
          <label><Label>Vendor&apos;s invoice number</Label><input className="input w-48" maxLength={80} value={vendorRef} onChange={(e) => setVendorRef(e.target.value)} /></label>
          <label><Label>Pay within (days)</Label><input type="number" min={0} max={180} className="input w-24" value={dueDays} onChange={(e) => setDueDays(Math.max(0, Math.min(180, Number(e.target.value) || 0)))} /></label>
          <button className="btn-primary" disabled={busy || notesDirty} title={notesDirty ? 'Save the notes first' : undefined} onClick={() => change({ status: 'APPROVED', dueDays, ...(vendorRef.trim() ? { vendorReference: vendorRef.trim() } : {}) }, `Approve ${bill.number} for payment to ${bill.vendor.name}? Its lines can no longer change.`)}>
            Approve for payment
          </button>
        </div>
      )}
      {editable && bill.status === 'APPROVED' && (
        <div className="no-print card mb-4 flex flex-wrap items-end gap-3 p-4">
          <label><Label>Payment reference</Label><input className="input w-56" placeholder="Bank transfer ID" maxLength={120} value={payRef} onChange={(e) => setPayRef(e.target.value)} /></label>
          <button className="btn-primary" disabled={busy} onClick={() => change({ status: 'PAID', ...(payRef.trim() ? { paymentReference: payRef.trim() } : {}) }, `Record payment of ${bill.currency} ${amt.format(bill.total)} to ${bill.vendor.name}?`)}>Mark as paid</button>
        </div>
      )}

      <BillDocument bill={bill}>
        {editable && bill.status === 'DRAFT' && (
          <>
            <TaxEditor doc={bill} busy={busy} onSave={(b) => change(b)} />
            <div className="no-print mt-6">
              <label className="label" htmlFor="notes">Notes (period, remittance details)</label>
              <textarea id="notes" className="input min-h-20" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              {notesDirty && <button className="btn-ghost mt-2" disabled={busy} onClick={() => change({ notes: notes || null })}>Save notes</button>}
            </div>
          </>
        )}
      </BillDocument>
      <p className="no-print mt-3 text-center text-xs text-muted">The vendor sees this bill in their portal once it is approved.</p>
    </div>
  );
}
