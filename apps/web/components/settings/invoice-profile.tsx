'use client';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorBox, Field, Loading, Section } from '@/components/ui';
import { api, get } from '@/lib/api';

type Profile = { legalName: string | null; address: string | null; taxId: string | null; email: string | null; phone: string | null; bankDetails: string | null; footer: string | null };
const KEYS: (keyof Profile)[] = ['legalName', 'address', 'taxId', 'email', 'phone', 'bankDetails', 'footer'];

/** Seller details printed on invoice PDFs. Admins edit; everyone else reads. */
export function InvoiceProfileSettings({ isAdmin }: { isAdmin: boolean }) {
  const [p, setP] = useState<Record<keyof Profile, string> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const apply = (x: Profile) => setP(Object.fromEntries(KEYS.map((k) => [k, x[k] ?? ''])) as Record<keyof Profile, string>);
  useEffect(() => { get<Profile>('/organization/invoice-profile').then(apply).catch(setError); }, []);
  const set = (k: keyof Profile, v: string) => { setP({ ...p!, [k]: v }); setSaved(false); };
  const save = async () => {
    setError(null);
    try {
      apply(await api<Profile>('/organization/invoice-profile', { method: 'PUT', json: Object.fromEntries(KEYS.map((k) => [k, p![k].trim() || null])) }));
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Section title={<span className="inline-flex items-center gap-2"><FileText className="h-4 w-4" />Invoice details</span>} className="mb-6">
      <p className="mb-4 text-sm text-muted">Printed on every invoice PDF. Each client&apos;s billing address and tax ID are set on the Clients page.</p>
      <ErrorBox error={error} />
      {!p ? <Loading /> : (
        <fieldset disabled={!isAdmin} className="grid gap-4 md:grid-cols-2">
          <Field label="Legal name" hint="Leave empty to use the organisation name"><input className="input" maxLength={200} value={p.legalName} onChange={(e) => set('legalName', e.target.value)} /></Field>
          <Field label="Tax ID" hint="VAT, GST or similar"><input className="input" maxLength={80} value={p.taxId} onChange={(e) => set('taxId', e.target.value)} /></Field>
          <Field label="Address"><textarea className="input min-h-[5rem]" maxLength={1000} value={p.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label="Payment details" hint="Bank account, IBAN or SWIFT, UPI"><textarea className="input min-h-[5rem]" maxLength={1000} value={p.bankDetails} onChange={(e) => set('bankDetails', e.target.value)} /></Field>
          <Field label="Billing email"><input className="input" type="email" maxLength={200} value={p.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Phone"><input className="input" maxLength={60} value={p.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <div className="md:col-span-2"><Field label="Footer" hint="A line at the foot of each page, for example registration details"><input className="input" maxLength={300} value={p.footer} onChange={(e) => set('footer', e.target.value)} /></Field></div>
          {isAdmin && <div className="flex justify-end md:col-span-2"><button className="btn-primary" onClick={save}>{saved ? 'Saved' : 'Save invoice details'}</button></div>}
        </fieldset>
      )}
    </Section>
  );
}
