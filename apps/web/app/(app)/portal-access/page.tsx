'use client';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { Empty, ErrorBox, Field, Loading, PageHeader, Section, Toggle } from '@/components/ui';
import { get, patch, post } from '@/lib/api';
import type { Option } from '@/lib/types';

interface PortalUser {
  id: string; name: string; email: string; role: 'CLIENT_USER' | 'VENDOR_USER'; active: boolean; createdAt: string;
  client: { id: string; name: string } | null; vendor: { id: string; name: string } | null;
}

export default function PortalAccessPage() {
  const me = useMe();
  const editable = canEdit(me);
  const [users, setUsers] = useState<PortalUser[] | null>(null);
  const [clients, setClients] = useState<Option[]>([]);
  const [vendors, setVendors] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: 'vendor' as 'client' | 'vendor', partyId: '', name: '', email: '', password: '' });
  const [error, setError] = useState<unknown>(null);

  const load = () => get<PortalUser[]>('/portal-users').then(setUsers).catch(setError);
  useEffect(() => {
    if (!editable) return;
    load();
    get<Option[]>('/clients').then(setClients).catch(setError);
    get<Option[]>('/vendors').then(setVendors).catch(setError);
  }, [editable]);

  async function invite() {
    setError(null);
    try {
      await post('/portal-users', form);
      setForm({ ...form, partyId: '', name: '', email: '', password: '' });
      setOpen(false);
      load();
    } catch (e) {
      setError(e);
    }
  }

  async function setActive(u: PortalUser, active: boolean) {
    try {
      await patch(`/portal-users/${u.id}`, { active });
      load();
    } catch (e) {
      setError(e);
    }
  }

  if (!editable) return <Empty>Only admins and project managers can manage portal access.</Empty>;
  const parties = form.kind === 'client' ? clients : vendors;

  return (
    <>
      <PageHeader
        title="Portal access"
        subtitle="Client and vendor logins. Vendors see their own links, respondents and payouts; clients see their own projects and approve completes."
        actions={<button className="btn-primary" onClick={() => setOpen(!open)}><Plus className="h-4 w-4" /> Add portal user</button>}
      />
      <div className="mb-4"><ErrorBox error={error} /></div>
      {open && (
        <Section title="New portal user" className="mb-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Portal">
              <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'client' | 'vendor', partyId: '' })}>
                <option value="vendor">Vendor portal</option><option value="client">Client portal</option>
              </select>
            </Field>
            <Field label={form.kind === 'client' ? 'Client' : 'Vendor'}>
              <select className="input" value={form.partyId} onChange={(e) => setForm({ ...form, partyId: e.target.value })}>
                <option value="">Choose…</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Temporary password" hint="At least 10 characters. Share it privately."><input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          </div>
          <button className="btn-primary mt-4" onClick={invite} disabled={!form.partyId || !form.name || !form.email || form.password.length < 10}>Create login</button>
        </Section>
      )}
      {!users ? <Loading /> : users.length === 0 ? <Empty>No portal users yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line bg-sunken/60"><tr><th className="th">Name</th><th className="th">Email</th><th className="th">Portal</th><th className="th">Company</th><th className="th">Created</th><th className="th">Active</th></tr></thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => (
                <tr key={u.id} className={u.active ? undefined : 'opacity-60'}>
                  <td className="td font-medium">{u.name}</td>
                  <td className="td">{u.email}</td>
                  <td className="td">{u.role === 'CLIENT_USER' ? 'Client' : 'Vendor'}</td>
                  <td className="td">{u.client?.name ?? u.vendor?.name}</td>
                  <td className="td text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="td"><Toggle label={`${u.name} active`} checked={u.active} onChange={(v) => setActive(u, v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
