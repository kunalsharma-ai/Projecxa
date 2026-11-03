'use client';
import clsx from 'clsx';
import { AlertTriangle, Download, FileDown, Settings2 } from 'lucide-react';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { AccountingSettings } from '@/components/finance/accounting-settings';
import { LedgerSync } from '@/components/finance/ledger-sync';
import { ZohoBooksSync } from '@/components/finance/zoho-books-sync';
import { canEdit, useMe } from '@/components/me';
import { Empty, ErrorBox, Loading, PageHeader, Section, Toggle } from '@/components/ui';
import { API_URL, ApiError, get, post } from '@/lib/api';

type Kind = 'invoices' | 'bills' | 'both' | 'payments_received' | 'payments_made';
interface Format { id: string; label: string; kinds: Kind[]; ext: string; note: string }
interface Filters { format: string; kind: Kind; from: string; to: string; invoiceStatuses: string[]; billStatuses: string[]; onlyNew: boolean; currency: string }
interface Preview {
  invoiceCount: number; billCount: number; warnings: string[]; fileName: string;
  totals: { type: string; currency: string; count: number; total: number }[];
  documents: { id: string; type: string; number: string; date: string; party: string; currency: string; total: number; status: string; exportedAt: string | null; paymentReference: string | null }[];
}
interface Export { id: string; formatLabel: string; kind: Kind; invoiceCount: number; billCount: number; fileName: string; createdAt: string; createdBy: string | null; filters: { from?: string | null; to?: string | null } }

const KIND_LABEL: Record<Kind, string> = { invoices: 'Client invoices', bills: 'Vendor bills', both: 'Invoices and bills', payments_received: 'Payments received', payments_made: 'Payments made' };
const isPayment = (k: Kind) => k === 'payments_received' || k === 'payments_made';
const amt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Last calendar month, the usual month-end export. */
function lastMonth() {
  const n = new Date();
  const first = new Date(n.getFullYear(), n.getMonth() - 1, 1);
  const last = new Date(n.getFullYear(), n.getMonth(), 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(first), to: iso(last) };
}

async function download(id: string, name: string) {
  const res = await fetch(`${API_URL}/api/v1/accounting/exports/${id}/download`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AccountingPage() {
  const me = useMe();
  const editable = canEdit(me);
  const [formats, setFormats] = useState<Format[] | null>(null);
  const [f, setF] = useState<Filters>({ format: 'zoho_books', kind: 'invoices', ...lastMonth(), invoiceStatuses: ['SENT', 'PAID'], billStatuses: ['APPROVED', 'PAID'], onlyNew: true, currency: '' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<Export[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const fmt = formats?.find((x) => x.id === f.format);
  const body = { ...f, from: f.from || null, to: f.to || null, currency: f.currency || null };

  useEffect(() => {
    get<Format[]>('/accounting/formats').then(setFormats).catch(setError);
  }, []);
  const loadHistory = useCallback(() => { if (editable) get<Export[]>('/accounting/exports').then(setHistory).catch(setError); }, [editable]);
  useEffect(loadHistory, [loadHistory]);

  useEffect(() => {
    if (!editable || !formats) return;
    const t = setTimeout(() => {
      post<Preview>('/accounting/exports/preview', body).then((p) => { setPreview(p); setError(null); }).catch((e) => { setPreview(null); setError(e); });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(f), editable, formats, refresh]);

  const set = (patch: Partial<Filters>) => setF((cur) => {
    const next = { ...cur, ...patch };
    const kinds = formats?.find((x) => x.id === next.format)?.kinds ?? [];
    if (!kinds.includes(next.kind)) next.kind = kinds[0] ?? 'invoices';
    return next;
  });
  const toggleIn = (list: string[], v: string) => (list.includes(v) ? (list.length > 1 ? list.filter((x) => x !== v) : list) : [...list, v]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const e = await post<Export>('/accounting/exports', body);
      await download(e.id, e.fileName);
      loadHistory();
      setRefresh((n) => n + 1); // exported documents drop out of "only not exported yet"
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (me && !editable) {
    return (
      <>
        <PageHeader title="Accounting exports" />
        <Empty>Only admins and project managers can export to accounting.</Empty>
      </>
    );
  }
  const count = (preview?.invoiceCount ?? 0) + (preview?.billCount ?? 0);
  const blocked = !!preview?.warnings.some((w) => /exchange rate/.test(w));

  return (
    <>
      <PageHeader
        title="Accounting exports"
        subtitle="Send client invoices, vendor bills and their payments to Zoho Books, Tally, QuickBooks or Xero, or sync straight to Zoho Books."
        actions={<button className="btn-ghost" onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 className="h-4 w-4" />Account names</button>}
      />
      {settingsOpen && <AccountingSettings onClose={() => setSettingsOpen(false)} />}
      <ErrorBox error={error} />
      {!formats ? <Loading /> : (
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Section title="What to export">
            <div className="space-y-5">
              <div>
                <span className="label">Accounting system</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {formats.map((x) => (
                    <button key={x.id} type="button" data-format={x.id} onClick={() => set({ format: x.id })} className={clsx('rounded-lg border p-3 text-left transition', f.format === x.id ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-line hover:bg-sunken')}>
                      <div className="text-sm font-medium">{x.label}</div>
                      <div className="text-xs text-muted">.{x.ext} · {x.kinds.includes('both') ? 'invoices and bills together' : 'invoices or bills'}{x.kinds.some(isPayment) ? ', payments' : ''}</div>
                    </button>
                  ))}
                </div>
                {fmt && <p className="mt-2 text-xs text-muted">{fmt.note}</p>}
              </div>
              <div>
                <span className="label">Documents</span>
                <div className="flex flex-wrap gap-2">
                  {(['invoices', 'bills', 'both', 'payments_received', 'payments_made'] as Kind[]).filter((k) => fmt?.kinds.includes(k)).map((k) => (
                    <button key={k} type="button" onClick={() => set({ kind: k })} className={clsx('chip px-3 py-1.5 text-sm', f.kind === k ? 'bg-brand text-brand-ink' : 'bg-sunken text-ink hover:bg-line')}>{KIND_LABEL[k]}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="label">From</span><input type="date" className="input" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
                <label className="block"><span className="label">To</span><input type="date" className="input" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
              </div>
              <p className="-mt-3 text-xs text-muted">{isPayment(f.kind) ? 'By the date the invoice or bill was marked paid.' : 'By invoice date (when sent) and bill approval date.'}</p>
              {!isPayment(f.kind) && <div className="grid gap-4 sm:grid-cols-2">
                {f.kind !== 'bills' && (
                  <div>
                    <span className="label">Invoice status</span>
                    {['SENT', 'PAID'].map((s) => (
                      <label key={s} className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={f.invoiceStatuses.includes(s)} onChange={() => set({ invoiceStatuses: toggleIn(f.invoiceStatuses, s) })} />{s === 'SENT' ? 'Sent' : 'Paid'}</label>
                    ))}
                  </div>
                )}
                {f.kind !== 'invoices' && (
                  <div>
                    <span className="label">Bill status</span>
                    {['APPROVED', 'PAID'].map((s) => (
                      <label key={s} className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={f.billStatuses.includes(s)} onChange={() => set({ billStatuses: toggleIn(f.billStatuses, s) })} />{s === 'APPROVED' ? 'Approved' : 'Paid'}</label>
                    ))}
                  </div>
                )}
              </div>}
              <label className="block max-w-[10rem]">
                <span className="label">Currency</span>
                <input className="input uppercase" maxLength={3} placeholder="All" value={f.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
              </label>
              <div className="flex items-start justify-between gap-4 rounded-lg border border-line p-3">
                <div className="text-sm">
                  <div className="font-medium">{isPayment(f.kind) ? 'Only payments not exported yet' : 'Only documents not exported yet'}</div>
                  <p className="text-xs text-muted">Turn off to export again, for example after a failed import. Importing twice can create duplicates.</p>
                </div>
                <Toggle checked={f.onlyNew} onChange={(v) => set({ onlyNew: v })} label="Only documents not exported yet" />
              </div>
            </div>
          </Section>

          <Section
            title="Preview"
            actions={<button className="btn-primary" disabled={busy || !count || blocked} onClick={run}><FileDown className="h-4 w-4" />{busy ? 'Exporting…' : count ? `Export ${count} ${isPayment(f.kind) ? (count === 1 ? 'payment' : 'payments') : count === 1 ? 'document' : 'documents'}` : 'Export'}</button>}
          >
            {!preview ? <Loading /> : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {preview.totals.length === 0 && <span className="text-sm text-muted">Nothing matches. Try another date range, or turn off &ldquo;only not exported yet&rdquo;.</span>}
                  {preview.totals.map((t) => (
                    <div key={`${t.type}${t.currency}`} className="rounded-lg border border-line px-3 py-2">
                      <div className="text-xs text-muted">{t.count} {isPayment(f.kind) ? (t.type === 'invoice' ? 'received' : 'paid') : t.type === 'invoice' ? (t.count === 1 ? 'invoice' : 'invoices') : (t.count === 1 ? 'bill' : 'bills')}</div>
                      <div className="font-semibold tabular-nums">{t.currency} {amt.format(t.total)}</div>
                    </div>
                  ))}
                </div>
                {preview.warnings.map((w) => (
                  <p key={w} className="flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w}</p>
                ))}
                {count > 0 && <p className="text-xs text-muted">File: <code className="font-mono">{preview.fileName}</code></p>}
                {preview.documents.length > 0 && (
                  <div className="-mx-5 overflow-x-auto px-5">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead><tr><th className="th">Number</th><th className="th">{isPayment(f.kind) ? 'Paid on' : 'Date'}</th><th className="th">Client or vendor</th><th className="th text-right">Total</th></tr></thead>
                      <tbody>
                        {preview.documents.map((d) => (
                          <tr key={d.id} className="border-t border-line">
                            <td className="td"><span className="font-mono text-xs">{d.number}</span>{d.exportedAt && <span className="chip ml-2 bg-sunken text-muted">exported {dt(d.exportedAt)}</span>}</td>
                            <td className="td whitespace-nowrap text-xs">{dt(d.date)}</td>
                            <td className="td">{d.party}{d.paymentReference && <span className="block text-xs text-muted">Ref {d.paymentReference}</span>}</td>
                            <td className="td text-right tabular-nums">{d.currency} {amt.format(d.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </Section>
        </div>
      )}

      <ZohoBooksSync onSynced={() => { loadHistory(); setRefresh((n) => n + 1); }} />
      <Suspense fallback={null}><LedgerSync onSynced={() => { loadHistory(); setRefresh((n) => n + 1); }} /></Suspense>

      <Section title="Export history" className="mt-6">
        {!history ? <Loading /> : history.length === 0 ? <p className="text-sm text-muted">No exports yet.</p> : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr><th className="th">When</th><th className="th">System</th><th className="th">Documents</th><th className="th">Period</th><th className="th">By</th><th className="th" /></tr></thead>
              <tbody>
                {history.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="td whitespace-nowrap text-xs">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="td">{e.formatLabel}</td>
                    <td className="td">{isPayment(e.kind) ? `${e.invoiceCount + e.billCount} ${KIND_LABEL[e.kind].toLowerCase()}` : [e.invoiceCount && `${e.invoiceCount} invoices`, e.billCount && `${e.billCount} bills`].filter(Boolean).join(', ')}</td>
                    <td className="td whitespace-nowrap text-xs">{e.filters.from || e.filters.to ? `${e.filters.from ?? '…'} to ${e.filters.to ?? '…'}` : 'All dates'}</td>
                    <td className="td text-xs">{e.createdBy ?? '–'}</td>
                    <td className="td text-right"><button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => download(e.id, e.fileName).catch(setError)}><Download className="h-3.5 w-3.5" />Download</button></td>
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
