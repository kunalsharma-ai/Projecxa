'use client';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { Empty, ErrorBox, Field, Loading, PageHeader, Section, StatusChip } from '@/components/ui';
import { get, post } from '@/lib/api';

interface ClientRow { id: string; name: string; code: string; status: string; contacts: { id: string; name: string; email: string | null }[]; _count: { projects: number } }

export default function ClientsPage() {
  const me = useMe();
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [form, setForm] = useState({ name: '', code: '', contact: '', email: '' });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = () => get<ClientRow[]>('/clients').then(setRows).catch(setError);
  useEffect(() => {
    load();
  }, []);

  async function create() {
    setError(null);
    try {
      await post('/clients', { name: form.name, code: form.code, contacts: form.contact ? [{ name: form.contact, ...(form.email ? { email: form.email } : {}) }] : [] });
      setForm({ name: '', code: '', contact: '', email: '' });
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
          </div>
          <button className="btn-primary mt-4" onClick={create} disabled={!form.name || !form.code}>Save client</button>
        </Section>
      )}
      {!rows ? <Loading /> : rows.length === 0 ? <Empty>No clients yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line bg-sunken/60"><tr><th className="th">Client</th><th className="th">Code</th><th className="th">Status</th><th className="th">Contacts</th><th className="th text-right">Projects</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id}><td className="td font-medium">{c.name}</td><td className="td">{c.code}</td><td className="td"><StatusChip status={c.status} /></td><td className="td text-muted">{c.contacts.map((x) => x.name).join(', ') || '–'}</td><td className="td text-right tabular-nums">{c._count.projects}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit(me) && <p className="mt-4 text-xs text-muted">Admins can read each client&apos;s S2S signing secret through the API (GET /clients/:id/s2s-secret).</p>}
    </>
  );
}
