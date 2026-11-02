'use client';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { FormField } from '@/components/form/field';
import { SmartForm, type FormSchema, type Values } from '@/components/form/smart-form';
import { InlineEdit } from '@/components/form/tags';
import { Empty, ErrorBox, Loading, PageHeader, Section, StatusChip } from '@/components/ui';
import { suggestCode } from '@/lib/suggest';
import { get, patch, post } from '@/lib/api';

interface ClientRow { id: string; name: string; code: string; status: string; contacts: { id: string; name: string; email: string | null }[]; _count: { projects: number } }

export default function ClientsPage() {
  const me = useMe();
  const [rows, setRows] = useState<ClientRow[] | null>(null);
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
  /** Saves one billing field at once (inline edit); a failure is shown next to the field. */
  async function saveBilling(field: 'billingAddress' | 'taxId', v: string) {
    if (!billing) return;
    await patch(`/clients/${billing.id}`, { [field]: v.trim() || null });
    setBilling({ ...billing, [field]: v.trim() });
  }

  const taken = rows?.map((c) => c.code) ?? [];
  const schema: FormSchema = {
    sections: [
      {
        columns: 2,
        fields: [
          { name: 'name', type: 'text', label: 'Name', required: true, maxLength: 200, placeholder: 'e.g. Acme Research' },
          {
            name: 'code', type: 'text', label: 'Code', required: true, pattern: [/^[A-Za-z0-9_-]{2,20}$/, 'Use 2–20 letters, digits, - or _.'], hint: 'Short and unique; used in project codes and reports',
            validate: (v) => (taken.includes(String(v).trim().toUpperCase()) ? 'Another client already uses this code.' : null),
            suggest: (v) => { const c = suggestCode(String(v.name ?? ''), taken); return c ? { value: c, reason: 'from the name, not used yet' } : null; },
          },
        ],
      },
      {
        title: 'Contacts',
        description: 'People at the client you work with. You can add more later.',
        fields: [{ name: 'contacts', type: 'group', label: 'Contacts', itemLabel: 'Contact', maxItems: 10, fields: [
          { name: 'name', type: 'text', label: 'Name', required: true },
          { name: 'email', type: 'email', label: 'Email' },
          { name: 'phone', type: 'text', label: 'Phone', pattern: [/^\+?[0-9 ()-]{6,20}$/, 'Use digits, spaces, (), - and an optional +.'] },
        ], props: { columns: 3, hideLabel: true } }],
      },
      {
        title: 'Billing',
        description: 'Printed under “Bill to” on invoice PDFs.',
        columns: 3,
        fields: [
          { name: 'billingAddress', type: 'textarea', label: 'Billing address', span: 2, maxLength: 1000 },
          { name: 'taxId', type: 'text', label: 'Tax ID', hint: 'VAT, GST or similar', maxLength: 80 },
        ],
      },
    ],
  };
  async function create(v: Values) {
    setError(null);
    try {
      const contacts = (v.contacts as { name: string; email: string; phone: string }[]).map((c) => ({ name: c.name, ...(c.email ? { email: c.email } : {}), ...(c.phone ? { phone: c.phone } : {}) }));
      await post('/clients', { name: v.name, code: v.code, billingAddress: v.billingAddress || null, taxId: v.taxId || null, contacts });
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
          <SmartForm schema={schema} onSubmit={create} submitLabel="Save client" onCancel={() => setOpen(false)} draftKey="client-new" />
        </Section>
      )}
      {billing && (
        <Section title={`Billing details · ${rows?.find((c) => c.id === billing.id)?.name ?? ''}`} className="mb-6" actions={<button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => setBilling(null)}>Done</button>}>
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <FormField label="Billing address" hint="Printed under “Bill to” on invoice PDFs. Click to edit; it saves when you leave the field.">
              <InlineEdit label="billing address" multiline value={billing.billingAddress} placeholder="Add a billing address" onSave={(v) => saveBilling('billingAddress', v)} validate={(v) => (v.length > 1000 ? 'Use at most 1000 characters.' : null)} />
            </FormField>
            <FormField label="Tax ID">
              <InlineEdit label="tax ID" value={billing.taxId} placeholder="Add a tax ID" onSave={(v) => saveBilling('taxId', v)} validate={(v) => (v.length > 80 ? 'Use at most 80 characters.' : null)} />
            </FormField>
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
