'use client';
import { Globe, Pencil, Plus, Search, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { BulkImport, type ImportColumn } from '@/components/parties/bulk-import';
import { ClientForm, type ClientDetail } from '@/components/parties/client-form';
import { Empty, ErrorBox, Loading, PageHeader, Section, StatusChip } from '@/components/ui';
import { get, patch, post } from '@/lib/api';

interface ClientRow { id: string; name: string; code: string; status: string; website: string | null; contacts: { id: string; name: string; email: string | null; phone: string | null }[]; _count: { projects: number } }

const CLIENT_IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'name', label: 'Company name', required: true, example: 'Acme Research', example2: 'Bright Insights Ltd' },
  { key: 'code', label: 'Short code; made from the name when empty', example: 'ACME', example2: '' },
  { key: 'website', label: 'Website, e.g. acme.com', example: 'acme.com', example2: 'https://brightinsights.co.uk' },
  { key: 'contact_name', label: 'Main contact', required: true, example: 'Pat Lee', example2: 'Sam Patel' },
  { key: 'contact_email', label: 'Main contact’s email', required: true, example: 'pat@acme.com', example2: 'sam@brightinsights.co.uk' },
  { key: 'contact_phone', label: 'Main contact’s phone', example: '+1 212 555 0100', example2: '' },
  { key: 'billing_address', label: 'Printed on invoices', example: '1 Main St, New York, NY 10001', example2: '' },
  { key: 'tax_id', label: 'VAT, GST or similar', example: '', example2: 'GB123456789' },
];

export default function ClientsPage() {
  const me = useMe();
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [panel, setPanel] = useState<'new' | 'import' | null>(null);
  const [editing, setEditing] = useState<ClientDetail | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<unknown>(null);
  const load = () => get<ClientRow[]>('/clients').then(setRows).catch(setError);
  useEffect(() => {
    load();
  }, []);

  const canAdd = !!me && ['ADMIN', 'PROJECT_MANAGER', 'SALES'].includes(me.user.role);
  const taken = rows?.map((c) => c.code) ?? [];
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((c) => (!status || c.status === status) && (!t || [c.name, c.code, c.website ?? '', ...c.contacts.flatMap((x) => [x.name, x.email ?? '', x.phone ?? ''])].some((s) => s.toLowerCase().includes(t))));
  }, [rows, q, status]);

  async function openEdit(id: string) {
    setError(null);
    setPanel(null);
    try {
      setEditing(await get<ClientDetail>(`/clients/${id}`));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e);
    }
  }
  async function create(body: Record<string, unknown>) {
    setError(null);
    try {
      await post('/clients', body);
      setPanel(null);
      load();
    } catch (e) {
      setError(e);
      throw e;
    }
  }
  async function save(body: Record<string, unknown>) {
    if (!editing) return;
    setError(null);
    try {
      await patch(`/clients/${editing.id}`, body);
      setEditing(null);
      load();
    } catch (e) {
      setError(e);
      throw e;
    }
  }

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="Click a client to edit its details, contacts and billing."
        actions={canAdd && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => { setEditing(null); setPanel(panel === 'import' ? null : 'import'); }}><Upload className="h-4 w-4" /> Bulk add</button>
            <button className="btn-primary" onClick={() => { setEditing(null); setPanel(panel === 'new' ? null : 'new'); }}><Plus className="h-4 w-4" /> Add client</button>
          </div>
        )}
      />
      <div className="mb-4"><ErrorBox error={error} /></div>
      {panel === 'new' && (
        <Section title="New client" className="mb-6">
          <ClientForm taken={taken} onSubmit={create} onCancel={() => setPanel(null)} />
        </Section>
      )}
      {panel === 'import' && <BulkImport kind="clients" columns={CLIENT_IMPORT_COLUMNS} onDone={load} onClose={() => setPanel(null)} />}
      {editing && (
        <Section title={`Edit client · ${editing.name}`} className="mb-6">
          <ClientForm client={editing} taken={taken} onSubmit={save} onCancel={() => setEditing(null)} />
        </Section>
      )}
      {!rows ? <Loading /> : rows.length === 0 ? <Empty>No clients yet. Add one, or bulk add them from a spreadsheet.</Empty> : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input className="input pl-8" placeholder="Search name, code, contact, email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
            </label>
            <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>
            </select>
            <span className="text-xs text-muted">{shown.length} of {rows.length}</span>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-line bg-sunken/60"><tr><th className="th">Client</th><th className="th">Code</th><th className="th">Status</th><th className="th">Website</th><th className="th">Contacts</th><th className="th text-right">Projects</th>{canEdit(me) && <th className="th" />}</tr></thead>
              <tbody className="divide-y divide-line">
                {shown.map((c) => (
                  <tr key={c.id} className={editing?.id === c.id ? 'bg-brand/5' : undefined}>
                    <td className="td font-medium">{canEdit(me) ? <button className="text-left hover:text-brand hover:underline" onClick={() => openEdit(c.id)}>{c.name}</button> : c.name}</td>
                    <td className="td">{c.code}</td>
                    <td className="td"><StatusChip status={c.status} /></td>
                    <td className="td text-xs">{c.website ? <a className="inline-flex items-center gap-1 text-brand hover:underline" href={c.website} target="_blank" rel="noreferrer noopener"><Globe className="h-3.5 w-3.5" />{c.website.replace(/^https?:\/\//, '')}</a> : <span className="text-muted">–</span>}</td>
                    <td className="td text-sm">{c.contacts.length ? c.contacts.map((x) => <div key={x.id}>{x.name}{x.email && <span className="text-muted"> · {x.email}</span>}</div>) : <span className="text-warn">No contact yet</span>}</td>
                    <td className="td text-right tabular-nums">{c._count.projects}</td>
                    {canEdit(me) && <td className="td text-right"><button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => openEdit(c.id)}><Pencil className="h-3.5 w-3.5" /> Edit</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <div className="p-6 text-center text-sm text-muted">No client matches.</div>}
          </div>
        </>
      )}
      {canEdit(me) && <p className="mt-4 text-xs text-muted">Admins can read each client&apos;s S2S signing secret through the API (GET /clients/:id/s2s-secret).</p>}
    </>
  );
}
