'use client';
import clsx from 'clsx';
import { Building2, Check, CreditCard, Download, FileUp, Landmark, Loader2, QrCode, ShieldCheck, Smartphone, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { useMe } from '@/components/me';
import { Empty, ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { UsageBars } from '@/components/super-admin/limits';
import type { Usage } from '@/lib/super-admin';
import { api, ApiError, FEATURES_EVENT, get, post } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { BillingInvoice, day, fmtMoney, INVOICE_STATUS, METHOD_LABEL, SUB_STATUS, type SubStatus } from '@/lib/super-admin';
import { Label } from '@/components/help';

type Interval = 'MONTHLY' | 'YEARLY';
interface PlanOffer { id: string; code: string; name: string; description: string | null; priceLabel: string | null; currency: string; priceMonthly: number | null; priceYearly: number | null; maxUsers: number | null; maxProjects: number | null; mobileEnabled: boolean; features: number }
interface Overview {
  owner: boolean; organization?: string;
  subscription: { plan: { code: string; name: string }; status: SubStatus; startsAt: string; endsAt: string | null; trialEndsAt: string | null; billingInterval: Interval | null } | null;
  plans: PlanOffer[]; tax: { name: string | null; percent: number };
  online: { providers: ('razorpay' | 'stripe')[]; razorpayKeyId: string | null };
  offline: { methods: string[]; bankDetails: string | null; upiId: string | null; instructions: string | null } | null;
  seller: string | null; invoices: BillingInvoice[];
}
interface RazorpayOrder { provider: 'razorpay'; invoiceId: string; number: string; keyId: string; orderId: string; amount: number; currency: string; name: string; description: string; prefill: { name: string; email: string } }
declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, f: (r: unknown) => void) => void } } }

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => ok();
    s.onerror = () => fail(new Error('Razorpay Checkout could not be loaded. Check your connection or pay offline.'));
    document.body.appendChild(s);
  });
}

const priceOf = (p: PlanOffer, i: Interval) => (i === 'YEARLY' ? p.priceYearly : p.priceMonthly);

export default function SubscriptionPage() {
  return <Suspense fallback={<Loading />}><Subscription /></Suspense>;
}

function Subscription() {
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [interval, setInterval] = useState<Interval>('MONTHLY');
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const load = useCallback(() => get<Overview>('/billing').then((d) => {
    setData(d);
    // The organisation that runs the server gets { owner: true } only (no plans or subscription).
    if (d.owner) return;
    setPicked((p) => p ?? d.subscription?.plan.code ?? d.plans?.[0]?.code ?? null);
    if (d.subscription?.billingInterval) setInterval(d.subscription.billingInterval);
  }).catch(setError), []);
  useEffect(() => { load(); }, [load]);
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => { get<Usage>('/billing/usage').then(setUsage).catch(() => undefined); }, []);

  // Back from Stripe Checkout.
  useEffect(() => {
    const inv = params.get('invoice');
    if (!inv) return;
    if (params.get('paid') === 'stripe') {
      setBusy('stripe');
      post<BillingInvoice>('/billing/stripe/confirm', { invoiceId: inv })
        .then((r) => { setNote(r.status === 'PAID' ? `Thank you. ${r.number} is paid and your plan is active until ${day(r.periodEnd)}.` : 'Stripe has not confirmed the payment yet. It will show here as soon as it does.'); load(); refreshFeatures(); })
        .catch(setError).finally(() => setBusy(null));
    } else if (params.get('cancelled')) setNote('The payment was cancelled. Nothing was charged.');
    router.replace('/settings/subscription');
  }, [params, router, load]);

  if (me && me.user.role !== 'ADMIN') return <Empty>Only your organisation’s admins can see the subscription.</Empty>;
  if (!data) return error ? <ErrorBox error={error} /> : <Loading />;
  if (data.owner) return (
    <>
      <PageHeader title="Subscription" />
      <Empty>Your organisation runs this SampTrek server, so it has every feature and pays for nothing. Organisations’ payments are in Super Admin → Billing.</Empty>
    </>
  );

  const sub = data.subscription;
  const plan = data.plans.find((p) => p.code === picked) ?? null;
  const price = plan ? priceOf(plan, interval) : null;
  const tax = price != null ? Math.round(price * data.tax.percent) / 100 : 0;
  const total = price != null ? price + tax : null;
  const end = sub ? (sub.status === 'TRIAL' ? sub.trialEndsAt : sub.endsAt) : null;
  const left = end ? Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000) : null;
  const hasYearly = data.plans.some((p) => p.priceYearly != null);
  const canPay = !!plan && price != null;
  const renewing = !!sub && plan?.code === sub.plan.code;

  async function payOnline(provider: 'razorpay' | 'stripe') {
    if (!plan) return;
    setError(null); setNote(null); setBusy(provider);
    try {
      const c = await post<RazorpayOrder | { provider: 'stripe'; url: string }>('/billing/checkout', { planCode: plan.code, interval, provider });
      if (c.provider === 'stripe') { window.location.href = c.url; return; }
      await loadRazorpay();
      const rzp = new window.Razorpay!({
        key: c.keyId, order_id: c.orderId, amount: c.amount, currency: c.currency, name: c.name, description: c.description, prefill: c.prefill,
        theme: { color: getComputedStyle(document.documentElement).getPropertyValue('--brand-hex').trim() || '#4f46e5' },
        handler: async (r: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          try {
            const inv = await post<BillingInvoice>('/billing/razorpay/verify', { invoiceId: c.invoiceId, orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
            setNote(`Thank you. ${inv.number} is paid and your plan is active until ${day(inv.periodEnd)}.`);
            load(); refreshFeatures();
          } catch (e) { setError(e); }
        },
        modal: { ondismiss: () => setBusy(null) },
      });
      rzp.on('payment.failed', () => setError(new ApiError(400, 'The payment did not go through. Nothing was charged; try again or pay offline.')));
      rzp.open();
    } catch (e) { setError(e); }
    finally { if (provider === 'razorpay') setBusy(null); }
  }

  return (
    <>
      <PageHeader title="Subscription" subtitle={`Your organisation’s SampTrek plan, payments and invoices${data.seller ? ` from ${data.seller}` : ''}.`} />
      <ErrorBox error={error} />
      {note && <div className="mb-4 flex items-start gap-2 rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status"><Check className="mt-0.5 h-4 w-4 shrink-0" />{note}</div>}
      {busy === 'stripe' && <Loading label="Checking the payment with Stripe" />}

      <div className="card mb-6 flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
        <div className="min-w-0">
          <div className="text-xs text-muted">Current plan</div>
          <div className="text-xl font-semibold">{sub ? sub.plan.name : 'Everything (no plan)'}</div>
        </div>
        {sub && <span className={clsx('chip', SUB_STATUS[sub.status][1])}>{SUB_STATUS[sub.status][0]}</span>}
        {sub && (
          <div className="text-sm">
            <div className="text-xs text-muted">{sub.status === 'TRIAL' ? 'Trial ends' : sub.status === 'EXPIRED' || sub.status === 'CANCELLED' ? 'Ended' : 'Paid until'}</div>
            <div className="font-medium tabular-nums">{end ? day(end) : 'No end date'}{left != null && left >= 0 && left <= 14 && <span className="ml-2 text-warn">({left} day{left === 1 ? '' : 's'} left)</span>}</div>
          </div>
        )}
        {sub?.billingInterval && <div className="text-sm"><div className="text-xs text-muted">Billing</div><div className="font-medium">{sub.billingInterval === 'YEARLY' ? 'Yearly' : 'Monthly'}</div></div>}
      </div>

      {usage && usage.limits.some((l) => l.limit != null) && (
        <Section title="Usage and limits" className="mb-6">
          <p className="mb-3 text-sm text-muted">What your plan allows and how much you use. Monthly counts reset on the 1st. Admins get an email at 80% of a limit and when it is reached. Need more? Change plan below or ask your SampTrek provider.</p>
          <UsageBars usage={usage} compact />
        </Section>
      )}

      {data.plans.length === 0 ? <Empty>No plans can be bought online yet. Contact your SampTrek provider to renew.</Empty> : (
        <Section title={sub ? 'Renew or change plan' : 'Choose a plan'} actions={hasYearly && (
          <div className="inline-flex rounded-full border border-line p-0.5 text-sm" role="radiogroup" aria-label="Billing period">
            {(['MONTHLY', 'YEARLY'] as const).map((i) => (
              <button key={i} type="button" role="radio" aria-checked={interval === i} onClick={() => setInterval(i)}
                className={clsx('rounded-full px-3 py-1', interval === i ? 'bg-brand text-white' : 'text-muted hover:text-ink')}>{i === 'MONTHLY' ? 'Monthly' : 'Yearly'}</button>
            ))}
          </div>
        )}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Plan">
            {data.plans.map((p) => {
              const pr = priceOf(p, interval);
              const on = picked === p.code;
              return (
                <button key={p.code} type="button" role="radio" aria-checked={on} disabled={pr == null} onClick={() => setPicked(p.code)}
                  className={clsx('relative flex flex-col items-stretch justify-start rounded-xl border p-4 text-left transition-colors disabled:opacity-50', on ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-line hover:border-brand/50')}>
                  {sub?.plan.code === p.code && <span className="absolute right-3 top-3 chip bg-brand/10 text-brand">Your plan</span>}
                  <div className="font-semibold">{p.name}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{pr == null ? '—' : fmtMoney(p.currency, pr)}<span className="text-sm font-normal text-muted">{pr == null ? ` not ${interval === 'YEARLY' ? 'yearly' : 'monthly'}` : interval === 'YEARLY' ? ' a year' : ' a month'}</span></div>
                  {p.description && <p className="mt-2 text-sm text-muted">{p.description}</p>}
                  <ul className="mt-3 space-y-1 text-xs text-muted">
                    <li>{p.features} features · {p.maxUsers ?? 'Unlimited'} users · {p.maxProjects ?? 'Unlimited'} projects</li>
                    <li className="flex items-center gap-1"><Smartphone className="h-3.5 w-3.5" />{p.mobileEnabled ? 'Android and iOS app included' : 'Web only'}</li>
                  </ul>
                </button>
              );
            })}
          </div>

          {canPay && (
            <div className="mt-5 rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
                  <dt className="text-muted">{plan!.name}, {interval === 'YEARLY' ? '1 year' : '1 month'}</dt><dd className="text-right tabular-nums">{fmtMoney(plan!.currency, price)}</dd>
                  {data.tax.percent > 0 && <><dt className="text-muted">{data.tax.name || 'Tax'} {data.tax.percent}%</dt><dd className="text-right tabular-nums">{fmtMoney(plan!.currency, tax)}</dd></>}
                  <dt className="font-semibold">Total</dt><dd className="text-right text-lg font-semibold tabular-nums">{fmtMoney(plan!.currency, total)}</dd>
                </dl>
                <div className="flex flex-wrap gap-2">
                  {data.online.providers.includes('razorpay') && (
                    <button className="btn-primary" disabled={!!busy} onClick={() => payOnline('razorpay')}>{busy === 'razorpay' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}Pay online (UPI, card, netbanking)</button>
                  )}
                  {data.online.providers.includes('stripe') && (
                    <button className={data.online.providers.includes('razorpay') ? 'btn-ghost' : 'btn-primary'} disabled={!!busy} onClick={() => payOnline('stripe')}>{busy === 'stripe' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}Pay by card</button>
                  )}
                  {data.offline && <button className="btn-ghost" onClick={() => setOffline(true)}><Landmark className="h-4 w-4" />Pay offline</button>}
                </div>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><ShieldCheck className="h-3.5 w-3.5" />
                {renewing ? `Paying adds ${interval === 'YEARLY' ? 'a year' : 'a month'} after your current end date.` : `Your plan changes to ${plan!.name} as soon as the payment is confirmed; the time you already paid for is kept.`}
                {data.online.providers.length > 0 && ' Card and bank details go to the payment provider, never to SampTrek.'}
              </p>
              {!data.online.providers.length && !data.offline && <p className="mt-2 text-sm text-warn">Payments are not set up yet. Contact your SampTrek provider.</p>}
            </div>
          )}
        </Section>
      )}

      {offline && data.offline && plan && price != null && (
        <OfflineForm data={data.offline} plan={plan} interval={interval} total={total!} onClose={() => setOffline(false)}
          onDone={(inv) => { setOffline(false); setNote(`Thank you. We will check ${inv.number} and email you when it is confirmed. Your access continues meanwhile if your plan is still running.`); load(); }} />
      )}

      <Section title="Invoices and receipts">
        {data.invoices.length === 0 ? <p className="text-sm text-muted">No invoices yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Number</th><th className="th">Date</th><th className="th">Plan</th><th className="th">Method</th><th className="th text-right">Total</th><th className="th">Status</th><th className="th" /></tr></thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id} className="border-t border-line">
                    <td className="td font-medium tabular-nums">{i.number}</td>
                    <td className="td whitespace-nowrap">{day(i.paidAt ?? i.createdAt)}</td>
                    <td className="td">{i.plan.name} · {i.interval === 'YEARLY' ? 'yearly' : 'monthly'}{i.periodEnd && <div className="text-xs text-muted">until {day(i.periodEnd)}</div>}</td>
                    <td className="td">{i.method ? METHOD_LABEL[i.method] ?? i.method : '—'}{i.reference && <div className="text-xs text-muted">{i.reference}</div>}</td>
                    <td className="td text-right tabular-nums">{fmtMoney(i.currency, i.total)}</td>
                    <td className="td"><span className={clsx('chip', INVOICE_STATUS[i.status][1])}>{INVOICE_STATUS[i.status][0]}</span>{i.status === 'REJECTED' && i.reviewNote && <div className="mt-1 max-w-[16rem] text-xs text-bad">{i.reviewNote}</div>}</td>
                    <td className="td whitespace-nowrap text-right">
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => downloadFile(`/billing/invoices/${i.id}/pdf`, `${i.number}.pdf`).catch(setError)}><Download className="h-3.5 w-3.5" />{i.status === 'PAID' ? 'Receipt' : 'Invoice'}</button>
                      {(i.status === 'OPEN' || i.status === 'PENDING_REVIEW') && <button className="btn-ghost ml-1 px-2 py-1 text-xs" aria-label={`Cancel ${i.number}`} onClick={async () => { if (!confirm(`Cancel ${i.number}?`)) return; try { await post(`/billing/invoices/${i.id}/cancel`); load(); } catch (e) { setError(e); } }}><X className="h-3.5 w-3.5" /></button>}
                    </td>
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

/** After paying, the features may have come back: the shell reloads them. */
function refreshFeatures() {
  window.dispatchEvent(new CustomEvent(FEATURES_EVENT, { detail: 'billing' }));
}

function OfflineForm({ data, plan, interval, total, onClose, onDone }: {
  data: NonNullable<Overview['offline']>; plan: PlanOffer; interval: Interval; total: number; onClose: () => void; onDone: (i: BillingInvoice) => void;
}) {
  const [method, setMethod] = useState(data.methods[0] ?? 'bank_transfer');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (file && file.size > 5 * 1024 * 1024) return setError(new ApiError(400, 'The proof file is larger than 5 MB'));
    setBusy(true); setError(null);
    const f = new FormData();
    f.set('planCode', plan.code); f.set('interval', interval); f.set('method', method); f.set('reference', reference); f.set('paidOn', paidOn);
    if (note) f.set('note', note);
    if (file) f.set('proof', file);
    try { onDone(await api<BillingInvoice>('/billing/offline', { method: 'POST', body: f })); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="offline-title" onClick={onClose}>
      <div className="card max-h-[92vh] w-full max-w-2xl overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div><h2 id="offline-title" className="text-lg font-semibold">Pay offline</h2><p className="text-sm text-muted">Pay <b className="text-ink">{fmtMoney(plan.currency, total)}</b> for {plan.name} ({interval === 'YEARLY' ? '1 year' : '1 month'}), then tell us how you paid.</p></div>
          <button className="btn-ghost px-2" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          {data.bankDetails && <div className="rounded-lg bg-sunken p-3 text-sm"><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted"><Building2 className="h-3.5 w-3.5" />Bank transfer</div><pre className="whitespace-pre-wrap font-sans">{data.bankDetails}</pre></div>}
          {data.upiId && <div className="rounded-lg bg-sunken p-3 text-sm"><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted"><QrCode className="h-3.5 w-3.5" />UPI</div><div className="font-medium">{data.upiId}</div><a className="mt-1 inline-block text-xs text-brand hover:underline" href={`upi://pay?pa=${encodeURIComponent(data.upiId)}&am=${total.toFixed(2)}&cu=${plan.currency}&tn=${encodeURIComponent(`SampTrek ${plan.name}`)}`}>Open in a UPI app</a></div>}
          {data.instructions && <p className="text-sm text-muted sm:col-span-2">{data.instructions}</p>}
        </div>
        <ErrorBox error={error} />
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="block"><Label>How you paid</Label>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{data.methods.map((m) => <option key={m} value={m}>{METHOD_LABEL[m] ?? m}</option>)}</select>
          </label>
          <label className="block"><Label>Paid on</Label><input className="input" type="date" required max={new Date().toISOString().slice(0, 10)} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
          <label className="block sm:col-span-2"><span className="label">{method === 'upi' ? 'UPI transaction ID (UTR)' : method === 'cheque' ? 'Cheque number and bank' : 'Transaction reference'}</span><input className="input" required minLength={2} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === 'upi' ? 'e.g. 431298765432' : 'e.g. NEFT N123456789'} /></label>
          <label className="block sm:col-span-2"><Label>Note (optional)</Label><input className="input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <label className="block sm:col-span-2"><Label>Proof of payment (optional, PDF or image, up to 5 MB)</Label>
            <span className="flex items-center gap-3 rounded-lg border border-dashed border-line p-3 text-sm">
              <FileUp className="h-4 w-4 text-muted" /><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </span>
          </label>
          <div className="flex gap-2 sm:col-span-2"><button className="btn-primary" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send for checking</button><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button></div>
          <p className="text-xs text-muted sm:col-span-2">Your provider checks the payment and confirms it, usually within one working day. You get an email either way.</p>
        </form>
      </div>
    </div>
  );
}

