'use client';
import clsx from 'clsx';
import { Download, FilePlus2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { BaseAmount, BillStatus, type Base } from '@/components/finance/bill-status';
import { canEdit, useMe } from '@/components/me';
import { Empty, ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { get, post } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';

type Bucket = { completes: number; amount: number };
interface Summary {
  vendors: { vendor: { id: string; name: string; code: string }; currency: string; pending: Bucket; unbilled: Bucket; draft: Bucket; due: Bucket; paid: Bucket }[];
  totals: Record<'pending' | 'unbilled' | 'draft' | 'due' | 'paid', { completes: number; byCurrency: { currency: string; amount: number }[]; base: Base }>;
}
interface Bill {
  id: string; number: string; status: string; currency: string; completes: number; subtotal: number; taxAmount: number; total: number; createdAt: string; dueAt: string | null; paidAt: string | null; overdue: boolean; vendorReference: string | null;
  vendor: { id: string; name: string; code: string };
}

const STATUSES = ['', 'DRAFT', 'APPROVED', 'PAID', 'VOID'] as const;
const amt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const date = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

function Payables() {
  const me = useMe();
  const editable = canEdit(me);
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get('status') ?? '';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [upTo, setUpTo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);

  const load = useCallback(() => {
    get<Summary>('/payables/summary').then(setSummary).catch(setError);
    get<Bill[]>(`/payables/bills${status ? `?status=${status}` : ''}`).then(setBills).catch(setError);
  }, [status]);
  useEffect(() => {
    setBills(null);
    load();
  }, [load]);

  const create = async (vendorId?: string) => {
    setBusy(vendorId ?? 'all');
    setError(null);
    setMade(null);
    try {
      const r = await post<{ bills: { number: string }[] }>('/payables/bills', { ...(vendorId ? { vendorId } : {}), ...(upTo ? { upTo } : {}) });
      setMade(`Created ${r.bills.length} draft bill${r.bills.length === 1 ? '' : 's'}: ${r.bills.map((b) => b.number).join(', ')}`);
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (s: string) => router.replace(s ? `/payables?status=${s}` : '/payables');
  const tiles = summary
    ? ([
        ['Approved, not billed', summary.totals.unbilled, 'completes ready for a bill'],
        ['Draft bills', summary.totals.draft, 'completes on drafts'],
        ['Approved bills due', summary.totals.due, 'completes to pay'],
        ['Paid to vendors', summary.totals.paid, 'completes paid'],
      ] as const)
    : [];
  const owed = summary?.vendors.filter((v) => v.unbilled.completes || v.pending.completes || v.draft.completes || v.due.completes) ?? [];

  return (
    <>
      <PageHeader
        title="Vendor payables"
        subtitle="What you owe each vendor for approved completes. Bills collect a vendor's approved completes across projects, one per currency."
        actions={
          <button
            className="btn-ghost"
            disabled={!bills?.length}
            onClick={() => downloadCsv(`projexa-vendor-bills-${new Date().toISOString().slice(0, 10)}.csv`,
              ['Number', 'Status', 'Vendor', 'Vendor code', 'Vendor invoice', 'Currency', 'Subtotal', 'Tax', 'Total', 'Completes', 'Created', 'Due', 'Paid'],
              (bills ?? []).map((b) => [b.number, b.overdue ? 'OVERDUE' : b.status, b.vendor.name, b.vendor.code, b.vendorReference, b.currency, b.subtotal.toFixed(2), b.taxAmount.toFixed(2), b.total.toFixed(2), b.completes, b.createdAt.slice(0, 10), b.dueAt?.slice(0, 10), b.paidAt?.slice(0, 10)]))}
          >
            <Download className="h-4 w-4" /> CSV
          </button>
        }
      />
      <ErrorBox error={error} />
      {!summary ? <Loading /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {tiles.map(([label, t, sub]) => (
              <div key={label} className="card p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
                <div className="mt-1.5 text-base font-semibold tabular-nums"><BaseAmount base={t.base} byCurrency={t.byCurrency} /></div>
                <div className="mt-0.5 text-xs text-muted">{t.completes} {sub}</div>
              </div>
            ))}
          </div>

          <Section
            title="Owed by vendor"
            actions={editable ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted">Completes up to <input type="date" className="input w-auto py-1 text-sm" value={upTo} onChange={(e) => setUpTo(e.target.value)} /></label>
                <button className="btn-primary" disabled={!!busy || !summary.totals.unbilled.completes} onClick={() => create()}><FilePlus2 className="h-4 w-4" /> Bill all vendors</button>
              </div>
            ) : undefined}
          >
            {made && <p className="mb-3 text-sm text-ok" role="status">{made}</p>}
            {owed.length === 0 ? <Empty>Nothing owed right now. Approved completes show here once a project is reconciled.</Empty> : (
              <div className="-mx-5 overflow-x-auto px-5">
                <table className="w-full min-w-[760px] text-sm">
                  <thead><tr><th className="th">Vendor</th><th className="th text-right" title="Completes the client has not approved yet">Waiting approval</th><th className="th text-right">Approved, not billed</th><th className="th text-right">On drafts</th><th className="th text-right">Due</th>{editable && <th className="th" />}</tr></thead>
                  <tbody>
                    {owed.map((v) => (
                      <tr key={`${v.vendor.id}:${v.currency}`} className="border-t border-line">
                        <td className="td">{v.vendor.name} <span className="font-mono text-xs text-muted">{v.vendor.code}</span> <span className="chip bg-sunken text-muted">{v.currency}</span></td>
                        {(['pending', 'unbilled', 'draft', 'due'] as const).map((k) => (
                          <td key={k} className={clsx('td text-right tabular-nums', !v[k].completes && 'text-muted')}>
                            {v[k].completes ? <>{amt.format(v[k].amount)}<div className="text-xs text-muted">{v[k].completes} completes</div></> : '–'}
                          </td>
                        ))}
                        {editable && <td className="td text-right">{v.unbilled.completes > 0 && <button className="btn-ghost px-2.5 py-1 text-xs" disabled={!!busy} onClick={() => create(v.vendor.id)}>Create bill</button>}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section
            title="Bills"
            actions={
              <div className="flex flex-wrap rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="Status">
                {STATUSES.map((s) => (
                  <button key={s || 'all'} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={clsx('rounded-md px-3 py-1 text-xs', status === s ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>
                    {s ? s.charAt(0) + s.slice(1).toLowerCase() : 'All'}
                  </button>
                ))}
              </div>
            }
          >
            {!bills ? <Loading /> : bills.length === 0 ? <Empty>No bills here yet.</Empty> : (
              <div className="-mx-5 overflow-x-auto px-5">
                <table className="w-full min-w-[720px] text-sm">
                  <thead><tr><th className="th">Number</th><th className="th">Status</th><th className="th">Vendor</th><th className="th">Vendor invoice</th><th className="th text-right">Completes</th><th className="th text-right">Total</th><th className="th">Due</th></tr></thead>
                  <tbody>
                    {bills.map((b) => (
                      <tr key={b.id} className="border-t border-line hover:bg-sunken/50">
                        <td className="td"><Link href={`/payables/${b.id}`} className="font-mono text-brand hover:underline">{b.number}</Link></td>
                        <td className="td"><BillStatus status={b.status} overdue={b.overdue} /></td>
                        <td className="td">{b.vendor.name}</td>
                        <td className="td font-mono text-xs">{b.vendorReference ?? '–'}</td>
                        <td className="td text-right tabular-nums">{b.completes}</td>
                        <td className="td text-right tabular-nums">{b.currency} {amt.format(b.total)}</td>
                        <td className={clsx('td', b.overdue && 'text-bad')}>{b.status === 'PAID' ? `Paid ${date(b.paidAt)}` : date(b.dueAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}
    </>
  );
}

export default function PayablesPage() {
  return <Suspense fallback={<Loading />}><Payables /></Suspense>;
}
