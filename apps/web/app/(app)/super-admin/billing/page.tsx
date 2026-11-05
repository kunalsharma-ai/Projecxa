'use client';
import clsx from 'clsx';
import { Check, CircleDollarSign, Clock, CreditCard, Download, Eye, Landmark, Plus, Save, Settings2, X } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ErrorBox, Loading, PageHeader, Section, Toggle } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { BillingInvoice, day, fmtMoney, INVOICE_STATUS, InvoiceStatus, METHOD_LABEL, type OrgSummary, type Plan } from '@/lib/super-admin';

interface Settings {
  onlineEnabled: boolean; offlineEnabled: boolean; offlineMethods: string[]; bankDetails: string | null; upiId: string | null; offlineInstructions: string | null;
  taxName: string | null; taxPercent: number; sellerName: string | null; sellerAddress: string | null; sellerTaxId: string | null; sellerEmail: string | null; invoiceFooter: string | null;
}
interface Data {
  summary: { month: { currency: string; total: number }[]; year: { currency: string; total: number }[]; payments: number; online: number; pending: number };
  providers: string[]; pending: BillingInvoice[]; invoices: BillingInvoice[];
}
const OFFLINE = ['bank_transfer', 'upi', 'cheque', 'cash', 'other'];
const sums = (rows: { currency: string; total: number }[]) => (rows.length ? rows.map((r) => fmtMoney(r.currency, r.total)).join(' · ') : '—');

export default function BillingPage() {
  const [data, setData] = useState<Data | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const load = useCallback(() => get<Data>(`/super-admin/billing${status ? `?status=${status}` : ''}`).then(setData).catch(setError), [status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { get<Settings>('/super-admin/billing/settings').then(setSettings).catch(setError); }, []);
  if (!data || !settings) return error ? <ErrorBox error={error} /> : <Loading />;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null); setNote(null);
    try { await fn(); setNote(msg); load(); } catch (e) { setError(e); }
  };

  return (
    <>
      <PageHeader title="Billing" subtitle="What organisations pay for their plans: online through Razorpay or Stripe, or offline by bank transfer, UPI, cheque or cash."
        actions={<>
          <button className="btn-ghost" onClick={() => setShowSettings((v) => !v)}><Settings2 className="h-4 w-4" />Billing settings</button>
          <button className="btn-primary" onClick={() => setRecording(true)}><Plus className="h-4 w-4" />Record a payment</button>
        </>} />
      <ErrorBox error={error} />
      {note && <div className="mb-4 rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">{note}</div>}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icon={CircleDollarSign} label="Received this month" value={sums(data.summary.month)} />
        <Tile icon={CircleDollarSign} label="Received this year" value={sums(data.summary.year)} sub={`${data.summary.payments} payment${data.summary.payments === 1 ? '' : 's'}, ${data.summary.online} online`} />
        <Tile icon={Clock} label="Offline payments to check" value={String(data.summary.pending)} tone={data.summary.pending ? 'warn' : undefined} />
        <Tile icon={CreditCard} label="Online payments" value={data.providers.length ? data.providers.map((p) => (p === 'razorpay' ? 'Razorpay' : 'Stripe')).join(' + ') : 'Not set up'}
          sub={<Link href="/settings/integrations#Payments" className="text-brand hover:underline">{data.providers.length ? 'Gateway keys' : 'Set up Razorpay or Stripe'}</Link>} />
      </div>

      {showSettings && <SettingsForm value={settings} onSaved={(s) => { setSettings(s); setShowSettings(false); setNote('Billing settings saved.'); }} />}

      {data.pending.length > 0 && (
        <Section title={`Waiting for you to check (${data.pending.length})`}>
          <div className="space-y-3">
            {data.pending.map((i) => <PendingCard key={i.id} i={i} onConfirm={(n) => act(() => post(`/super-admin/billing/invoices/${i.id}/confirm`, { note: n || null }), `${i.number} confirmed. ${i.organization?.name} is renewed.`)}
              onReject={(n) => act(() => post(`/super-admin/billing/invoices/${i.id}/reject`, { note: n }), `${i.number} turned down. ${i.organization?.name} was emailed why.`)} onError={setError} />)}
          </div>
        </Section>
      )}

      <Section title="All invoices" actions={
        <select className="input w-auto py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus | '')} aria-label="Status">
          <option value="">Every status</option>
          {(Object.keys(INVOICE_STATUS) as InvoiceStatus[]).map((s) => <option key={s} value={s}>{INVOICE_STATUS[s][0]}</option>)}
        </select>}>
        {data.invoices.length === 0 ? <p className="text-sm text-muted">No invoices yet. They appear when an organisation pays, sends an offline payment, or you record one.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Number</th><th className="th">Organisation</th><th className="th">Plan</th><th className="th">Method</th><th className="th text-right">Total</th><th className="th">Status</th><th className="th">Date</th><th className="th" /></tr></thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id} className="border-t border-line">
                    <td className="td font-medium tabular-nums">{i.number}</td>
                    <td className="td"><Link className="hover:underline" href={`/super-admin/organizations/${i.organization?.id}`}>{i.organization?.name}</Link></td>
                    <td className="td">{i.plan.name} · {i.interval === 'YEARLY' ? 'yearly' : 'monthly'}</td>
                    <td className="td">{i.method ? METHOD_LABEL[i.method] ?? i.method : '—'}{i.reference && <div className="max-w-[12rem] truncate text-xs text-muted" title={i.reference}>{i.reference}</div>}</td>
                    <td className="td text-right tabular-nums">{fmtMoney(i.currency, i.total)}</td>
                    <td className="td"><span className={clsx('chip', INVOICE_STATUS[i.status][1])}>{INVOICE_STATUS[i.status][0]}</span></td>
                    <td className="td whitespace-nowrap">{day(i.paidAt ?? i.createdAt)}{i.periodEnd && <div className="text-xs text-muted">until {day(i.periodEnd)}</div>}</td>
                    <td className="td whitespace-nowrap text-right">
                      {i.hasProof && <button className="btn-ghost px-2 py-1 text-xs" aria-label={`Proof of ${i.number}`} onClick={() => downloadFile(`/super-admin/billing/invoices/${i.id}/proof`, i.proofName ?? 'proof').catch(setError)}><Eye className="h-3.5 w-3.5" /></button>}
                      <button className="btn-ghost px-2 py-1 text-xs" aria-label={`PDF of ${i.number}`} onClick={() => downloadFile(`/super-admin/billing/invoices/${i.id}/pdf`, `${i.number}.pdf`).catch(setError)}><Download className="h-3.5 w-3.5" /></button>
                      {(i.status === 'OPEN' || i.status === 'REJECTED') && <button className="btn-ghost px-2 py-1 text-xs" aria-label={`Cancel ${i.number}`} onClick={() => confirm(`Cancel ${i.number}?`) && act(() => post(`/super-admin/billing/invoices/${i.id}/cancel`), `${i.number} cancelled.`)}><X className="h-3.5 w-3.5" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {recording && <RecordForm onClose={() => setRecording(false)} onDone={(i) => { setRecording(false); setNote(`${i.number} recorded. ${i.organization?.name ?? 'The organisation'} is paid until ${day(i.periodEnd)}.`); load(); }} />}
    </>
  );
}

function Tile({ icon: Icon, label, value, sub, tone }: { icon: typeof Clock; label: string; value: string; sub?: React.ReactNode; tone?: 'warn' }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs text-muted"><Icon className="h-4 w-4" />{label}</div>
      <div className={clsx('mt-1 text-xl font-semibold tabular-nums', tone === 'warn' && 'text-warn')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function PendingCard({ i, onConfirm, onReject, onError }: { i: BillingInvoice; onConfirm: (note: string) => void; onReject: (note: string) => void; onError: (e: unknown) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="rounded-xl border border-warn/40 bg-warn/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{i.organization?.name} · {fmtMoney(i.currency, i.total)}</div>
          <div className="text-sm text-muted">{i.plan.name} ({i.interval === 'YEARLY' ? 'yearly' : 'monthly'}) · {i.number}</div>
        </div>
        <span className={clsx('chip', INVOICE_STATUS.PENDING_REVIEW[1])}>{INVOICE_STATUS.PENDING_REVIEW[0]}</span>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted">Method</dt><dd className="font-medium">{METHOD_LABEL[i.method ?? ''] ?? i.method}</dd></div>
        <div><dt className="text-xs text-muted">Reference</dt><dd className="font-medium break-all">{i.reference}</dd></div>
        <div><dt className="text-xs text-muted">Paid on</dt><dd className="font-medium">{day(i.paidOn)}</dd></div>
        {i.note && <div className="sm:col-span-3"><dt className="text-xs text-muted">Their note</dt><dd>{i.note}</dd></div>}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {i.hasProof && <button className="btn-ghost" onClick={() => downloadFile(`/super-admin/billing/invoices/${i.id}/proof`, i.proofName ?? 'proof').catch(onError)}><Eye className="h-4 w-4" />Proof</button>}
        <input className="input min-w-[14rem] flex-1" placeholder="Note (needed to turn it down)" value={text} onChange={(e) => setText(e.target.value)} aria-label={`Note for ${i.number}`} />
        <button className="btn-primary" onClick={() => onConfirm(text)}><Check className="h-4 w-4" />Payment received</button>
        <button className="btn-ghost text-bad" disabled={text.trim().length < 2} onClick={() => onReject(text.trim())}><X className="h-4 w-4" />Not found</button>
      </div>
    </div>
  );
}

function SettingsForm({ value, onSaved }: { value: Settings; onSaved: (s: Settings) => void }) {
  const [s, setS] = useState(value);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const text = (k: keyof Settings) => ({ value: (s[k] as string | null) ?? '', onChange: (e: { target: { value: string } }) => set(k, (e.target.value || null) as never) });
  async function save(e: FormEvent) {
    e.preventDefault();
    try { onSaved(await api<Settings>('/super-admin/billing/settings', { method: 'PUT', json: s })); } catch (err) { setError(err); }
  }
  return (
    <form onSubmit={save} className="mb-6">
      <Section title="Billing settings">
        <ErrorBox error={error} />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><CreditCard className="h-4 w-4" />Online</h3>
            <label className="flex items-center gap-2 text-sm"><Toggle checked={s.onlineEnabled} onChange={(v) => set('onlineEnabled', v)} label="Online payments" />Offer “Pay online” (when Razorpay or Stripe is set up in Settings → Integrations)</label>
            <h3 className="flex items-center gap-2 pt-2 text-sm font-semibold"><Landmark className="h-4 w-4" />Offline</h3>
            <label className="flex items-center gap-2 text-sm"><Toggle checked={s.offlineEnabled} onChange={(v) => set('offlineEnabled', v)} label="Offline payments" />Let organisations pay offline and send you the details</label>
            <fieldset className="flex flex-wrap gap-3 text-sm" disabled={!s.offlineEnabled}><legend className="label">Methods accepted</legend>
              {OFFLINE.map((m) => <label key={m} className="flex items-center gap-1.5"><input type="checkbox" checked={s.offlineMethods.includes(m)} onChange={() => set('offlineMethods', s.offlineMethods.includes(m) ? s.offlineMethods.filter((x) => x !== m) : [...s.offlineMethods, m])} />{METHOD_LABEL[m]}</label>)}
            </fieldset>
            <label className="block"><span className="label">Bank details shown to organisations</span><textarea className="input min-h-[96px]" {...text('bankDetails')} placeholder={'Account name: Sampledge Pvt Ltd\nAccount: 50200012345678\nIFSC: HDFC0001234 · HDFC Bank, Andheri'} /></label>
            <label className="block"><span className="label">UPI ID</span><input className="input" {...text('upiId')} placeholder="sampledge@hdfcbank" /></label>
            <label className="block"><span className="label">Other instructions</span><input className="input" {...text('offlineInstructions')} placeholder="Write the invoice number in the payment remarks." /></label>
          </div>
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Tax</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="label">Tax name</span><input className="input" {...text('taxName')} placeholder="GST" /></label>
              <label className="block"><span className="label">Tax %</span><input className="input" type="number" min={0} max={100} step="0.01" value={s.taxPercent} onChange={(e) => set('taxPercent', Number(e.target.value) || 0)} /></label>
            </div>
            <h3 className="pt-2 text-sm font-semibold">On invoices and receipts</h3>
            <label className="block"><span className="label">Seller name</span><input className="input" {...text('sellerName')} placeholder="Sampledge Pvt Ltd" /></label>
            <label className="block"><span className="label">Address</span><textarea className="input min-h-[72px]" {...text('sellerAddress')} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="label">Tax ID (GSTIN, VAT…)</span><input className="input" {...text('sellerTaxId')} /></label>
              <label className="block"><span className="label">Billing email</span><input className="input" type="email" {...text('sellerEmail')} /></label>
            </div>
            <label className="block"><span className="label">Footer</span><input className="input" {...text('invoiceFooter')} placeholder="Thank you for choosing PROJEXA." /></label>
          </div>
        </div>
        <div className="mt-5"><button className="btn-primary"><Save className="h-4 w-4" />Save billing settings</button></div>
      </Section>
    </form>
  );
}

function RecordForm({ onClose, onDone }: { onClose: () => void; onDone: (i: BillingInvoice) => void }) {
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [f, setF] = useState({ organizationId: '', planCode: '', interval: 'MONTHLY', amount: '', method: 'bank_transfer', reference: '', paidOn: new Date().toISOString().slice(0, 10), note: '' });
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    get<OrgSummary[]>('/super-admin/organizations').then((o) => setOrgs(o.filter((x) => !x.platformOwner))).catch(setError);
    get<Plan[]>('/super-admin/plans').then(setPlans).catch(setError);
  }, []);
  const org = orgs?.find((o) => o.id === f.organizationId);
  const plan = plans?.find((p) => p.code === f.planCode);
  const listPrice = plan ? (f.interval === 'YEARLY' ? plan.priceYearly : plan.priceMonthly) : null;
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      onDone(await post<BillingInvoice>('/super-admin/billing/payments', {
        organizationId: f.organizationId, planCode: f.planCode, interval: f.interval, amount: f.amount === '' ? null : Number(f.amount),
        method: f.method, reference: f.reference || null, paidOn: f.paidOn, note: f.note || null,
      }));
    } catch (err) { setError(err); }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="record-title" onClick={onClose}>
      <form onSubmit={submit} className="card max-h-[92vh] w-full max-w-xl overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between"><div><h2 id="record-title" className="text-lg font-semibold">Record a payment</h2><p className="text-sm text-muted">Money you received outside PROJEXA. The subscription renews at once and they get a receipt.</p></div>
          <button type="button" className="btn-ghost px-2" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button></div>
        <ErrorBox error={error} />
        {!orgs || !plans ? <Loading /> : (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className="label">Organisation</span>
              <select className="input" required value={f.organizationId} onChange={(e) => { const o = orgs.find((x) => x.id === e.target.value); setF({ ...f, organizationId: e.target.value, planCode: o?.subscription?.plan.code ?? f.planCode }); }}>
                <option value="">Choose…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}{o.subscription ? ` (${o.subscription.plan.name})` : ''}</option>)}
              </select></label>
            <label className="block"><span className="label">Plan</span><select className="input" required value={f.planCode} onChange={(e) => setF({ ...f, planCode: e.target.value })}><option value="">Choose…</option>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
            <label className="block"><span className="label">Period</span><select className="input" value={f.interval} onChange={(e) => setF({ ...f, interval: e.target.value })}><option value="MONTHLY">1 month</option><option value="YEARLY">1 year</option></select></label>
            <label className="block"><span className="label">Amount before tax {plan && `(${plan.currency})`}</span><input className="input" type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder={listPrice != null ? `Plan price: ${listPrice}` : 'Plan price'} required={listPrice == null} /></label>
            <label className="block"><span className="label">Method</span><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{OFFLINE.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></label>
            <label className="block"><span className="label">Reference</span><input className="input" maxLength={120} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="UTR, cheque no." /></label>
            <label className="block"><span className="label">Received on</span><input className="input" type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></label>
            <label className="block sm:col-span-2"><span className="label">Note</span><input className="input" maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
            {org?.subscription && <p className="text-xs text-muted sm:col-span-2">Now: {org.subscription.plan.name}, {org.subscription.status.toLowerCase().replace('_', ' ')}{org.subscription.endsAt ? `, until ${day(org.subscription.endsAt)}` : ''}. A running subscription is extended from its end date.</p>}
            <div className="flex gap-2 sm:col-span-2"><button className="btn-primary"><Check className="h-4 w-4" />Record and renew</button><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button></div>
          </div>
        )}
      </form>
    </div>
  );
}
