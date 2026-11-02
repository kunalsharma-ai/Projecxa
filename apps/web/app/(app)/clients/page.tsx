'use client';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { Empty, ErrorBox, Field, Loading, PageHeader, Section, StatusChip } from '@/components/ui';
import { get, patch, post } from '@/lib/api';

interface ClientRow { id: string; name: string; code: string; status: string; contacts: { id: string; name: string; email: string | null }[]; _count: { projects: number } }

export default function ClientsPage() {
  const me = useMe();
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [form, setForm] = useState({ name: '', code: '', contact: '', email: '', billingAddress: '', taxId: '' });
  const [billing, setBilling] = useState<{ id: string; billingAddress: string; taxId: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = () => get<ClientRow[]>('/clients').then(setRows).catch(setError);
  useEffect(() => {
    load();
  }, []);

  async function openBilling(id: string) {
    setError(null);
    try {
      const c = await get<{ billingAddress: string | null; taxId: string | null }>(`/clients/${id}`);
      setBilling({ id, billingAddress: c.billingAddress ?? '', taxId: c.taxId ?? '' });
    } catch (e) {
      setError(e);
    }
  }
  async function saveBilling() {
    if (!billing) return;
    try {
      await patch(`/clients/${billing.id}`, { billingAddress: billing.billingAddress.trim() || null, taxId: billing.taxId.trim() || null });
      setBilling(null);
    } catch (e) {
      setError(e);
    }
  }

  async function create() {
    setError(null);
    try {
      await post('/clients', { name: form.name, code: form.code, billingAddress: form.billingAddress || null, taxId: form.taxId || null, contacts: form.contact ? [{ name: form.contact, ...(form.email ? { email: form.email } : {}) }] : [] });
      setForm({ name: '', code: '', contact: '', email: '', billingAddress: '', taxId: '' });
      setOpen(false);
      load();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <PageHeader title="Clients" actions={me && ['ADMIN', 'PROJECT_MANAGER', 'SALES'].includes(me.user.role) && <button className="btn-primary" onClick={() => setOpen(!open)}><Plus className="h-4 w-4" /> Add client</button>} />
      <div className="mb-4"><ErrorBox error={error} /></div>
      {open && (
        <Section title="New client" className="mb-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Code" hint="2–20 letters or digits"><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
            <Field label="Contact name"><input className="input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
            <Field label="Contact email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Billing address" hint="Printed on invoice PDFs"><textarea className="input min-h-[4.5rem]" value={form.billingAddress} onChange={(e) => setForm({ ...form, billingAddress: e.target.value })} /></Field>
            <Field label="Tax ID" hint="VAT, GST or similar"><input className="input" value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} /></Field>
          </div>
          <button className="btn-primary mt-4" onClick={create} disabled={!form.name || !form.code}>Save client</button>
        </Section>
      )}
      {billing && (
        <Section title={`Billing details · ${rows?.find((c) => c.id === billing.id)?.name ?? ''}`} className="mb-6">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <Field label="Billing address" hint="Printed under “Bill to” on invoice PDFs"><textarea className="input min-h-[4.5rem]" autoFocus value={billing.billingAddress} onChange={(e) => setBilling({ ...billing, billingAddress: e.target.value })} /></Field>
            <Field label="Tax ID"><input className="input" value={billing.taxId} onChange={(e) => setBilling({ ...billing, taxId: e.target.value })} /></Field>
            <div className="flex gap-2"><button className="btn-ghost" onClick={() => setBilling(null)}>Cancel</button><button className="btn-primary" onClick={saveBilling}>Save</button></div>
          </div>
        </Section>
      )}
      {!rows ? <Loading /> : rows.length === 0 ? <Empty>No clients yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line bg-sunken/60"><tr><th className="th">Client</th><th className="th">Code</th><th className="th">Status</th><th className="th">Contacts</th><th className="th text-right">Projects</th>{canEdit(me) && <th className="th" />}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                  <tr key={c.id}><td className="td font-medium">{c.name}</td><td className="td">{c.code}</td><td className="td"><StatusChip status={c.status} /></td><td className="td text-muted">{c.contacts.map((x) => x.name).join(', ') || '–'}</td><td className="td text-right tabular-nums">{c._count.projects}</td>
                    {canEdit(me) && <td className="td text-right"><button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => { if (billing?.id === c.id) setBilling(null); else { openBilling(c.id); window.scrollTo({ top: 0, behavior: 'smooth' }); } }}>Billing details</button></td>}
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit(me) && <p className="mt-4 text-xs text-muted">Admins can read each client&apos;s S2S signing secret through the API (GET /clients/:id/s2s-secret).</p>}
    </>
  );
}
