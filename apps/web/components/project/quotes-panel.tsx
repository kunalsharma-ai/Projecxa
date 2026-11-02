'use client';
import clsx from 'clsx';
import { Check, Send, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ErrorBox, Field, money } from '@/components/ui';
import { get, post } from '@/lib/api';

type QStatus = 'REQUESTED' | 'QUOTED' | 'DECLINED' | 'ACCEPTED' | 'CLOSED';
interface Quote {
  id: string; vendor: { id: string; name: string; code: string }; status: QStatus; completesWanted: number; respondBy: string | null;
  cpi: number | null; feasibleCompletes: number | null; daysNeeded: number | null; vendorNote: string | null; respondedAt: string | null; createdAt: string; marginPercent: number | null;
}
interface MarketQuotes { market: { currency: string; clientCpi: number; targetCompletes: number; completes: number }; quotes: Quote[] }
const TONE: Record<QStatus, string> = { REQUESTED: 'bg-sunken text-muted', QUOTED: 'bg-info/15 text-info', DECLINED: 'bg-bad/10 text-bad', ACCEPTED: 'bg-ok/15 text-ok', CLOSED: 'bg-sunken text-muted' };
const LABEL: Record<QStatus, string> = { REQUESTED: 'Waiting', QUOTED: 'Quoted', DECLINED: 'Declined', ACCEPTED: 'Accepted', CLOSED: 'Closed' };

/** Quote requests for one market: ask vendors, compare their answers against the client CPI, accept one. */
export function QuotesPanel({ projectId, countryId, editable, asking, onAskDone, allocated, vendors, onAccepted }: {
  projectId: string; countryId: string; editable: boolean; asking: boolean; onAskDone: () => void; allocated: string[];
  vendors: { id: string; name: string }[]; onAccepted: () => void;
}) {
  const [data, setData] = useState<MarketQuotes | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [wanted, setWanted] = useState('');
  const [respondBy, setRespondBy] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const base = `/projects/${projectId}/countries/${countryId}/quotes`;

  const load = useCallback(() => get<MarketQuotes>(base).then(setData).catch(setError), [base]);
  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const ask = () =>
    run(async () => {
      setData(await post<MarketQuotes>(base, { vendorIds: [...picked], ...(wanted ? { completesWanted: Number(wanted) } : {}), ...(respondBy ? { respondBy: new Date(respondBy).toISOString() } : {}), ...(note.trim() ? { note: note.trim() } : {}) }));
      setPicked(new Set());
      setNote('');
      onAskDone();
    });

  if (!data) return error ? <ErrorBox error={error} /> : null;
  const open = new Set(data.quotes.filter((q) => q.status === 'REQUESTED' || q.status === 'QUOTED').map((q) => q.vendor.id));
  const askable = vendors.filter((v) => !allocated.includes(v.id) && !open.has(v.id));
  if (!asking && data.quotes.length === 0) return null;
  const remaining = Math.max(1, data.market.targetCompletes - data.market.completes);

  return (
    <div className="mb-5 space-y-3">
      <ErrorBox error={error} />
      {asking && editable && (
        <div className="space-y-3 rounded-lg bg-sunken/60 p-4">
          <div className="text-sm font-medium">Ask vendors for a CPI and how many completes they can deliver</div>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">
            {askable.length === 0 ? <span className="text-xs text-muted">Every vendor already has a link or an open request here.</span> : askable.map((v) => (
              <button key={v.id} type="button" aria-pressed={picked.has(v.id)} onClick={() => { const n = new Set(picked); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); setPicked(n); }} className={clsx('rounded-full border px-2.5 py-1 text-xs', picked.has(v.id) ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted hover:bg-panel')}>{v.name}</button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[140px_200px_1fr_auto] sm:items-end">
            <Field label="Completes wanted"><input className="input" type="number" min={1} placeholder={String(remaining)} value={wanted} onChange={(e) => setWanted(e.target.value)} /></Field>
            <Field label="Answer by (optional)"><input className="input" type="datetime-local" value={respondBy} onChange={(e) => setRespondBy(e.target.value)} /></Field>
            <Field label="Note to vendors (optional)"><input className="input" maxLength={2000} placeholder="e.g. Nat rep 18–65, soft launch Monday" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy || picked.size === 0} onClick={ask}><Send className="h-4 w-4" /> Send {picked.size || ''}</button>
              <button className="btn-ghost" onClick={onAskDone}>Cancel</button>
            </div>
          </div>
          <p className="text-xs text-muted">Vendors see the market, LOI, IR, target group and your note in their portal (and by email). They never see the client or the client CPI.</p>
        </div>
      )}
      {data.quotes.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[760px]">
            <thead className="bg-sunken/60"><tr><th className="th">Quote from</th><th className="th">Status</th><th className="th text-right">CPI</th><th className="th text-right">Margin</th><th className="th text-right">Can deliver</th><th className="th">Note</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-line">
              {data.quotes.map((q) => (
                <tr key={q.id}>
                  <td className="td font-medium">{q.vendor.name}</td>
                  <td className="td"><span className={clsx('chip', TONE[q.status])}>{LABEL[q.status]}</span>{q.status === 'REQUESTED' && q.respondBy && <div className="text-xs text-muted">by {new Date(q.respondBy).toLocaleString()}</div>}</td>
                  <td className="td text-right tabular-nums">{q.cpi !== null ? money(q.cpi, data.market.currency) : '–'}</td>
                  <td className={clsx('td text-right tabular-nums', q.marginPercent !== null && (q.marginPercent < 20 ? 'text-bad' : q.marginPercent < 35 ? 'text-warn' : 'text-ok'))}>{q.marginPercent !== null ? `${q.marginPercent}%` : '–'}</td>
                  <td className="td text-right tabular-nums">{q.feasibleCompletes !== null ? <>{q.feasibleCompletes.toLocaleString()} <span className="text-xs text-muted">of {q.completesWanted.toLocaleString()}{q.daysNeeded ? ` · ${q.daysNeeded} d` : ''}</span></> : <span className="text-xs text-muted">wants {q.completesWanted.toLocaleString()}</span>}</td>
                  <td className="td max-w-[240px] whitespace-normal break-words text-xs">{q.vendorNote ?? ''}</td>
                  <td className="td">
                    {editable && (
                      <div className="flex justify-end gap-1">
                        {q.status === 'QUOTED' && <button className="btn-primary px-2.5 py-1 text-xs" disabled={busy} onClick={() => run(async () => { await post(`/quotes/${q.id}/accept`, {}); await load(); onAccepted(); })} title="Creates the vendor link at this CPI"><Check className="h-3.5 w-3.5" /> Accept</button>}
                        {(q.status === 'REQUESTED' || q.status === 'QUOTED') && <button className="btn-ghost p-1.5" disabled={busy} aria-label={`Close the request to ${q.vendor.name}`} onClick={() => run(async () => { await post(`/quotes/${q.id}/close`); await load(); })}><X className="h-3.5 w-3.5" /></button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-xs text-muted">Margin is against the client CPI of {money(data.market.clientCpi, data.market.currency)}. Accepting creates the vendor link at the quoted CPI for what the vendor can deliver (up to the completes wanted).</p>
        </div>
      )}
    </div>
  );
}
