'use client';
import { Check, Copy, Pause, Play, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Field, Progress, Section, StatusChip, money } from '@/components/ui';
import { get, patch, post } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import type { Option } from '@/lib/types';
import type { ProjectDetail } from './types';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn-ghost px-2 py-1 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />} {label}
    </button>
  );
}

export function VendorsTab({ project, editable, reload }: { project: ProjectDetail; editable: boolean; reload: () => void }) {
  const [vendors, setVendors] = useState<Option[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [form, setForm] = useState({ vendorId: '', cpi: '', targetCompletes: '', uidParam: 'uid', applyToAll: false });
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    get<Option[]>('/vendors').then(setVendors).catch(setError);
  }, []);

  async function add(countryId: string) {
    setError(null);
    const targets = form.applyToAll ? project.countries.filter((c) => !c.allocations.some((a) => a.vendorId === form.vendorId)) : project.countries.filter((c) => c.id === countryId);
    try {
      for (const c of targets) {
        await post(`/projects/${project.id}/countries/${c.id}/allocations`, {
          vendorId: form.vendorId,
          cpi: Number(form.cpi),
          targetCompletes: Number(form.targetCompletes || c.targetCompletes),
          uidParam: form.uidParam || 'uid',
        });
      }
      setAdding(null);
      setForm({ vendorId: '', cpi: '', targetCompletes: '', uidParam: 'uid', applyToAll: false });
      reload();
    } catch (e) {
      setError(e);
    }
  }

  async function toggle(countryId: string, allocationId: string, status: string) {
    try {
      await patch(`/projects/${project.id}/countries/${countryId}/allocations/${allocationId}`, { status: status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' });
      reload();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="space-y-6">
      <ErrorBox error={error} />
      <p className="text-sm text-muted">
        Each vendor gets its own entry link per country. Replace <code className="rounded bg-sunken px-1">[UID]</code> with the vendor&apos;s respondent ID macro. Test links create test sessions that are never billed.
      </p>
      {project.countries.map((c) => (
        <Section
          key={c.id}
          title={<span>{flag(c.countryCode)} {countryName(c.countryCode)} <span className="font-normal text-muted">· {c.completes}/{c.targetCompletes} completes · client CPI {money(c.cpi, c.currency)}</span></span>}
          actions={editable && adding !== c.id && <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setAdding(c.id)}><Plus className="h-3.5 w-3.5" /> Add vendor</button>}
        >
          {adding === c.id && (
            <div className="mb-5 grid grid-cols-1 gap-3 rounded-lg bg-sunken/60 p-4 sm:grid-cols-5">
              <Field label="Vendor">
                <select className="input" value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
                  <option value="">Choose…</option>
                  {vendors.filter((v) => !c.allocations.some((a) => a.vendorId === v.id)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </Field>
              <Field label={`Vendor CPI (${c.currency})`}><input className="input" type="number" step="0.01" value={form.cpi} onChange={(e) => setForm({ ...form, cpi: e.target.value })} /></Field>
              <Field label="Target completes"><input className="input" type="number" placeholder={String(c.targetCompletes)} value={form.targetCompletes} onChange={(e) => setForm({ ...form, targetCompletes: e.target.value })} /></Field>
              <Field label="Vendor UID parameter"><input className="input" value={form.uidParam} onChange={(e) => setForm({ ...form, uidParam: e.target.value })} /></Field>
              <div className="flex flex-col justify-end gap-2">
                {project.countries.length > 1 && (
                  <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={form.applyToAll} onChange={(e) => setForm({ ...form, applyToAll: e.target.checked })} /> Add to every country</label>
                )}
                <div className="flex gap-2">
                  <button className="btn-primary" disabled={!form.vendorId || form.cpi === ''} onClick={() => add(c.id)}>Add</button>
                  <button className="btn-ghost" onClick={() => setAdding(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
          {c.allocations.length === 0 ? (
            <Empty>No vendors yet. Add one to get entry links.</Empty>
          ) : (
            <div className="-mx-5 -mb-5 overflow-x-auto">
              <table className="w-full min-w-[880px]">
                <thead className="border-y border-line bg-sunken/60">
                  <tr><th className="th">Vendor</th><th className="th">Status</th><th className="th">Completes</th><th className="th">Terms</th><th className="th">Quota full</th><th className="th">CPI</th><th className="th">Links</th><th className="th" /></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {c.allocations.map((a) => (
                    <tr key={a.id}>
                      <td className="td font-medium">{a.vendor.name} <span className="text-xs text-muted">{a.vendor.code}</span></td>
                      <td className="td"><StatusChip status={a.status} /></td>
                      <td className="td"><Progress value={a.completes} max={a.targetCompletes} /></td>
                      <td className="td tabular-nums">{a.stats.TERMINATE}</td>
                      <td className="td tabular-nums">{a.stats.QUOTA_FULL}</td>
                      <td className="td tabular-nums">{money(a.cpi, c.currency)}</td>
                      <td className="td">
                        <div className="flex gap-1.5">
                          <CopyButton text={a.entryLink} label="Live link" />
                          <CopyButton text={a.testEntryLink} label="Test link" />
                        </div>
                      </td>
                      <td className="td">
                        {editable && (
                          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => toggle(c.id, a.id, a.status)}>
                            {a.status === 'ACTIVE' ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Resume</>}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ))}
    </div>
  );
}
