'use client';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { Empty, ErrorBox, Field, Loading, PageHeader, Section, StatusChip } from '@/components/ui';
import { get, post } from '@/lib/api';

interface VendorRow { id: string; name: string; code: string; status: string; redirectAllowedDomains: string[]; callbackUrlTemplate: string | null; _count: { allocations: number } }

export default function VendorsPage() {
  const me = useMe();
  const [rows, setRows] = useState<VendorRow[] | null>(null);
  const [form, setForm] = useState({ name: '', code: '', domains: '', callback: '' });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = () => get<VendorRow[]>('/vendors').then(setRows).catch(setError);
  useEffect(() => {
    load();
  }, []);

  async function create() {
    setError(null);
    try {
      await post('/vendors', {
        name: form.name,
        code: form.code,
        redirectAllowedDomains: form.domains.split(/[\s,]+/).filter(Boolean),
        ...(form.callback ? { callbackUrlTemplate: form.callback } : {}),
      });
      setForm({ name: '', code: '', domains: '', callback: '' });
      setOpen(false);
      load();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <PageHeader title="Vendors" actions={canEdit(me) && <button className="btn-primary" onClick={() => setOpen(!open)}><Plus className="h-4 w-4" /> Add vendor</button>} />
      <div className="mb-4"><ErrorBox error={error} /></div>
      {open && (
        <Section title="New vendor" className="mb-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Code"><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
            <Field label="Redirect domains" hint="Hostnames this vendor's redirect URLs may use, e.g. panel.example.com or *.example.com"><input className="input" value={form.domains} onChange={(e) => setForm({ ...form, domains: e.target.value })} /></Field>
            <Field label="Callback URL template" hint="Optional. Macros: {uid} {status} {vendor_id} {country_code} {project_code}"><input className="input font-mono text-xs" value={form.callback} onChange={(e) => setForm({ ...form, callback: e.target.value })} /></Field>
          </div>
          <button className="btn-primary mt-4" onClick={create} disabled={!form.name || !form.code}>Save vendor</button>
        </Section>
      )}
      {!rows ? <Loading /> : rows.length === 0 ? <Empty>No vendors yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line bg-sunken/60"><tr><th className="th">Vendor</th><th className="th">Code</th><th className="th">Status</th><th className="th">Redirect domains</th><th className="th">Callback</th><th className="th text-right">Allocations</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="td font-medium">{v.name}</td><td className="td">{v.code}</td><td className="td"><StatusChip status={v.status} /></td>
                  <td className="td text-xs text-muted">{v.redirectAllowedDomains.join(', ') || '–'}</td>
                  <td className="td max-w-[320px] truncate font-mono text-xs text-muted" title={v.callbackUrlTemplate ?? ''}>{v.callbackUrlTemplate ?? '–'}</td>
                  <td className="td text-right tabular-nums">{v._count.allocations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
