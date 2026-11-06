'use client';
import { useEffect, useState } from 'react';
import { Label } from '@/components/help';

const amt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export interface Taxed { currency: string; subtotal: number; taxName: string | null; taxPercent: number; taxAmount: number; total: number }

/** Subtotal, tax and total rows for an invoice or bill table (4 columns). */
export function TotalsFoot({ doc }: { doc: Taxed }) {
  return (
    <tfoot>
      {doc.taxAmount > 0 && (
        <>
          <tr>
            <td colSpan={3} className="pt-4 text-right text-muted">Subtotal</td>
            <td className="whitespace-nowrap pt-4 pl-3 text-right tabular-nums">{amt.format(doc.subtotal)}</td>
          </tr>
          <tr>
            <td colSpan={3} className="pt-1 text-right text-muted">{doc.taxName ?? 'Tax'} {doc.taxPercent}%</td>
            <td className="whitespace-nowrap pt-1 pl-3 text-right tabular-nums">{amt.format(doc.taxAmount)}</td>
          </tr>
        </>
      )}
      <tr>
        <td colSpan={3} className="pt-4 text-right font-medium">Total ({doc.currency})</td>
        <td className="whitespace-nowrap pt-4 pl-3 text-right text-lg font-semibold tabular-nums">{doc.currency} {amt.format(doc.total)}</td>
      </tr>
    </tfoot>
  );
}

/** Tax name and percentage on a draft. Saving sends { taxName, taxPercent }. */
export function TaxEditor({ doc, busy, onSave }: { doc: Taxed; busy: boolean; onSave: (b: { taxName: string | null; taxPercent: number }) => void }) {
  const [name, setName] = useState(doc.taxName ?? '');
  const [pct, setPct] = useState(String(doc.taxPercent));
  useEffect(() => {
    setName(doc.taxName ?? '');
    setPct(String(doc.taxPercent));
  }, [doc.taxName, doc.taxPercent]);
  const n = Number(pct);
  const valid = pct !== '' && n >= 0 && n <= 100;
  const dirty = name !== (doc.taxName ?? '') || n !== doc.taxPercent;
  return (
    <div className="no-print mt-6 flex flex-wrap items-end gap-2">
      <label><Label>Tax name</Label><input className="input w-36" placeholder="GST, VAT…" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label><Label>Tax %</Label><input className="input w-24 tabular-nums" type="number" min={0} max={100} step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} /></label>
      <button className="btn-ghost" disabled={busy || !dirty || !valid} onClick={() => onSave({ taxName: name.trim() || null, taxPercent: n })}>Apply tax</button>
      <span className="pb-2 text-xs text-muted">Set 0 for no tax. Tax can only change while this is a draft.</span>
    </div>
  );
}
