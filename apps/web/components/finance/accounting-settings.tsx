'use client';
import { useEffect, useState } from 'react';
import { useMe } from '@/components/me';
import { ErrorBox, Loading, Section, Toggle } from '@/components/ui';
import { api, get } from '@/lib/api';

interface Config {
  partyName: 'name' | 'code'; itemName: string; incomeAccount: string; expenseAccount: string; receivableAccount: string; payableAccount: string; salesTaxAccount: string; purchaseTaxAccount: string;
  dateFormat: 'yyyy-mm-dd' | 'dd/mm/yyyy' | 'mm/dd/yyyy'; timezone: string;
  xero: { incomeCode: string; expenseCode: string; salesTaxType: string; purchaseTaxType: string; noTaxType: string };
  tally: { company: string; salesVoucherType: string; purchaseVoucherType: string; includeLedgers: boolean; debtorsGroup: string; creditorsGroup: string };
}

const MAIN: [keyof Config, string, string?][] = [
  ['incomeAccount', 'Income account (invoices)', 'Sales account or ledger'],
  ['expenseAccount', 'Expense account (bills)', 'Cost of sales or purchase ledger'],
  ['salesTaxAccount', 'Tax on sales account'],
  ['purchaseTaxAccount', 'Tax on purchases account'],
  ['receivableAccount', 'Receivables account', 'Journal export only'],
  ['payableAccount', 'Payables account', 'Journal export only'],
  ['itemName', 'Item name', 'Item or service in Zoho Books and QuickBooks'],
];

/** The names the accounting system knows: accounts, ledgers, tax types. Admins change them; others can read. */
export function AccountingSettings({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const admin = me?.user.role === 'ADMIN';
  const [c, setC] = useState<Config | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { get<Config>('/accounting/settings').then(setC).catch(setError); }, []);
  if (!c) return <Section title="Account names" className="mb-6">{error ? <ErrorBox error={error} /> : <Loading />}</Section>;

  const set = (p: Partial<Config>) => { setC({ ...c, ...p }); setSaved(false); };
  const save = async () => {
    setError(null);
    try { setC(await api<Config>('/accounting/settings', { method: 'PUT', json: c })); setSaved(true); } catch (e) { setError(e); }
  };
  const input = (value: string, onChange: (v: string) => void, placeholder?: string) => <input className="input" value={value} placeholder={placeholder} disabled={!admin} onChange={(e) => onChange(e.target.value)} />;

  return (
    <Section
      title="Account names"
      className="mb-6"
      actions={<div className="flex gap-2"><button className="btn-ghost" onClick={onClose}>Close</button>{admin && <button className="btn-primary" onClick={save}>{saved ? 'Saved' : 'Save'}</button>}</div>}
    >
      <div className="space-y-6">
        <ErrorBox error={error} />
        <p className="text-sm text-muted">Use the exact names from your accounting system, so imports land in the right accounts.{!admin && ' Only admins can change them.'}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MAIN.map(([k, label, hint]) => (
            <label key={k} className="block">
              <span className="label">{label}</span>
              {input(c[k] as string, (v) => set({ [k]: v } as Partial<Config>))}
              {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
            </label>
          ))}
          <label className="block">
            <span className="label">Customers and vendors by</span>
            <select className="input" disabled={!admin} value={c.partyName} onChange={(e) => set({ partyName: e.target.value as Config['partyName'] })}>
              <option value="name">Name (Acme Insights)</option>
              <option value="code">Code (ACME)</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Date format</span>
            <select className="input" disabled={!admin} value={c.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as Config['dateFormat'] })}>
              <option value="yyyy-mm-dd">2026-10-31</option>
              <option value="dd/mm/yyyy">31/10/2026</option>
              <option value="mm/dd/yyyy">10/31/2026</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Timezone for dates</span>
            {input(c.timezone, (v) => set({ timezone: v }), 'Asia/Kolkata')}
          </label>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Xero</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {([['incomeCode', 'Income account code'], ['expenseCode', 'Expense account code'], ['salesTaxType', 'Tax rate on sales'], ['purchaseTaxType', 'Tax rate on purchases'], ['noTaxType', 'Tax rate when no tax']] as [keyof Config['xero'], string][]).map(([k, label]) => (
              <label key={k} className="block"><span className="label">{label}</span>{input(c.xero[k], (v) => set({ xero: { ...c.xero, [k]: v } }))}</label>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Tally Prime</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {([['company', 'Company name', 'Blank = the open company'], ['salesVoucherType', 'Sales voucher type'], ['purchaseVoucherType', 'Purchase voucher type'], ['debtorsGroup', 'Group for clients'], ['creditorsGroup', 'Group for vendors']] as [Exclude<keyof Config['tally'], 'includeLedgers'>, string, string?][]).map(([k, label, hint]) => (
              <label key={k} className="block"><span className="label">{label}</span>{input(c.tally[k], (v) => set({ tally: { ...c.tally, [k]: v } }), hint)}</label>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-line p-3 text-sm">
            <span>Create client and vendor ledgers in the same file (skip if they already exist in Tally)</span>
            <Toggle checked={c.tally.includeLedgers} onChange={(v) => admin && set({ tally: { ...c.tally, includeLedgers: v } })} label="Create ledgers" />
          </div>
        </div>
      </div>
    </Section>
  );
}
