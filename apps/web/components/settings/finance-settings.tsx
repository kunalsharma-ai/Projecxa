'use client';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorBox, Field, Loading, Section } from '@/components/ui';
import { api, get } from '@/lib/api';
import { Label } from '@/components/help';

interface Tax { name: string | null; percent: number }
interface Settings { baseCurrency: string; invoiceTax: Tax; billTax: Tax; rates: { currency: string; rate: number; updatedAt: string }[]; currencies: string[]; missing: string[] }

/** Reporting currency, manual exchange rates and default taxes. Admins edit; everyone else reads. */
export function FinanceSettings({ isAdmin }: { isAdmin: boolean }) {
  const [s, setS] = useState<Settings | null>(null);
  const [base, setBase] = useState('USD');
  const [rates, setRates] = useState<{ currency: string; rate: string }[]>([]);
  const [inv, setInv] = useState({ name: '', percent: '0' });
  const [bill, setBill] = useState({ name: '', percent: '0' });
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const apply = (x: Settings) => {
    setS(x);
    setBase(x.baseCurrency);
    setRates([...x.rates.map((r) => ({ currency: r.currency, rate: String(r.rate) })), ...x.missing.filter((c) => c !== x.baseCurrency).map((c) => ({ currency: c, rate: '' }))]);
    setInv({ name: x.invoiceTax.name ?? '', percent: String(x.invoiceTax.percent) });
    setBill({ name: x.billTax.name ?? '', percent: String(x.billTax.percent) });
  };
  useEffect(() => { get<Settings>('/organization/finance-settings').then(apply).catch(setError); }, []);

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      apply(
        await api<Settings>('/organization/finance-settings', {
          method: 'PUT',
          json: {
            baseCurrency: base.trim().toUpperCase(),
            invoiceTax: { name: inv.name.trim() || null, percent: Number(inv.percent) || 0 },
            billTax: { name: bill.name.trim() || null, percent: Number(bill.percent) || 0 },
            rates: rates.filter((r) => r.currency.trim() && r.rate.trim()).map((r) => ({ currency: r.currency.trim().toUpperCase(), rate: Number(r.rate) })),
          },
        }),
      );
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Section title="Finance: currency and tax" className="mb-6">
      <p className="mb-4 text-sm text-muted">
        Invoices and vendor bills stay in each market&apos;s currency. Dashboards also add them up in your reporting currency using the rates below, which you enter by hand (no paid exchange-rate feed). Default taxes are applied to new drafts and can be changed on each draft.
      </p>
      <ErrorBox error={error} />
      {!s ? <Loading /> : (
        <fieldset disabled={!isAdmin} className="grid items-start gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            <Field label="Reporting currency" hint="3-letter code, for example USD, EUR or INR.">
              <input className="input w-28 font-mono uppercase" maxLength={3} value={base} onChange={(e) => setBase(e.target.value.toUpperCase())} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line p-3">
                <div className="mb-2 text-sm font-medium">Client invoices</div>
                <div className="flex gap-2">
                  <label className="flex-1"><Label>Tax name</Label><input className="input" placeholder="VAT, GST…" maxLength={40} value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} /></label>
                  <label className="w-20"><Label>%</Label><input className="input tabular-nums" type="number" min={0} max={100} step="0.01" value={inv.percent} onChange={(e) => setInv({ ...inv, percent: e.target.value })} /></label>
                </div>
              </div>
              <div className="rounded-lg border border-line p-3">
                <div className="mb-2 text-sm font-medium">Vendor bills</div>
                <div className="flex gap-2">
                  <label className="flex-1"><Label>Tax name</Label><input className="input" placeholder="GST…" maxLength={40} value={bill.name} onChange={(e) => setBill({ ...bill, name: e.target.value })} /></label>
                  <label className="w-20"><Label>%</Label><input className="input tabular-nums" type="number" min={0} max={100} step="0.01" value={bill.percent} onChange={(e) => setBill({ ...bill, percent: e.target.value })} /></label>
                </div>
              </div>
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">Exchange rates</div>
            <p className="mb-2 text-xs text-muted">1 unit of the currency = how many {base || 'base'}.{s.missing.length > 0 && <span className="text-warn"> Missing: {s.missing.join(', ')}.</span>}</p>
            <div className="space-y-2">
              {rates.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm text-muted">1</span>
                  <input className="input w-20 font-mono uppercase" maxLength={3} aria-label="Currency" value={r.currency} onChange={(e) => setRates(rates.map((x, n) => (n === i ? { ...x, currency: e.target.value.toUpperCase() } : x)))} />
                  <span className="text-sm text-muted">=</span>
                  <input className="input w-32 tabular-nums" type="number" min={0} step="any" aria-label={`Rate for ${r.currency}`} placeholder="rate" value={r.rate} onChange={(e) => setRates(rates.map((x, n) => (n === i ? { ...x, rate: e.target.value } : x)))} />
                  <span className="text-sm text-muted">{base}</span>
                  {isAdmin && <button type="button" className="ml-auto text-muted hover:text-bad" aria-label={`Remove ${r.currency || 'rate'}`} onClick={() => setRates(rates.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
              {isAdmin && <button type="button" className="text-xs text-brand hover:underline" onClick={() => setRates([...rates, { currency: '', rate: '' }])}><Plus className="mr-1 inline h-3 w-3" />Add a rate</button>}
            </div>
          </div>
        </fieldset>
      )}
      {isAdmin ? (
        <div className="mt-4 flex items-center gap-3">
          <button className="btn-primary" disabled={!s} onClick={save}>Save finance settings</button>
          {saved && <span className="text-sm text-ok" role="status">Saved</span>}
        </div>
      ) : <p className="mt-4 text-xs text-muted">Only admins can change finance settings.</p>}
    </Section>
  );
}
