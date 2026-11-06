'use client';
import { Check, ListPlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { loadCustomOptions, type CustomField } from '@/components/form/option-select';
import { canEdit, useMe } from '@/components/me';
import { ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { api, get, patch, post } from '@/lib/api';
import { CATEGORIES } from '@/lib/types';

interface Row { id: string; field: string; value: string; createdAt: string }

/** The dropdowns people can add to with “Add +”, and where they appear. */
const FIELDS: { field: CustomField; title: string; where: string; standard: string[] }[] = [
  { field: 'category', title: 'Project categories', where: 'Create project → Category', standard: CATEGORIES },
  { field: 'targetGroup', title: 'Target groups', where: 'Create project and Add market → Target group', standard: [] },
  { field: 'language', title: 'Languages', where: 'Markets → Language', standard: [] },
  { field: 'uidParam', title: 'Link variables', where: 'Vendors → Link variable (the respondent ID name in entry links)', standard: ['vid', 'uid', 'rid', 'pid', 'id'] },
];

/**
 * Settings → Dropdown options: everything added with “Add +” on forms, in one place, to add more,
 * fix a typo or remove one. Clients, contacts and vendors added with “Add +” are on their own pages.
 */
export default function DropdownOptionsPage() {
  const me = useMe();
  const editable = canEdit(me);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = () => get<Row[]>('/custom-options').then((r) => setRows(r.filter((x) => x.field !== 'defaultVendor'))).catch(setError);
  useEffect(() => { load(); }, []);

  async function run(fn: () => Promise<unknown>, field: CustomField) {
    setError(null);
    try {
      await fn();
      await loadCustomOptions(field, true);
      await load();
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  }

  return (
    <>
      <PageHeader title="Dropdown options" subtitle="What your team added with “Add +”. Add more, fix a typo or remove one. New clients, contacts and vendors added on forms are on the Clients and Vendors pages." />
      <div className="mb-4"><ErrorBox error={error} /></div>
      {!rows ? <Loading /> : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {FIELDS.map((f) => (
            <OptionList key={f.field} {...f} rows={rows.filter((r) => r.field === f.field)} editable={editable}
              onAdd={(v) => run(() => post('/custom-options', { field: f.field, value: v }), f.field)}
              onRename={(id, v) => run(() => patch(`/custom-options/${id}`, { value: v }), f.field)}
              onRemove={(r) => confirm(`Remove “${r.value}” from ${f.title.toLowerCase()}? Projects that use it keep it.`) && run(() => api(`/custom-options/${r.id}`, { method: 'DELETE' }), f.field)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function OptionList({ title, where, standard, rows, editable, onAdd, onRename, onRemove }: {
  field: CustomField; title: string; where: string; standard: string[]; rows: Row[]; editable: boolean;
  onAdd: (v: string) => Promise<boolean>; onRename: (id: string, v: string) => Promise<boolean>; onRemove: (r: Row) => unknown;
}) {
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  async function add(e: FormEvent) {
    e.preventDefault();
    if (value.trim() && (await onAdd(value.trim()))) setValue('');
  }
  return (
    <Section title={<span className="flex items-center gap-2"><ListPlus className="h-4 w-4 text-muted" /> {title}</span>}>
      <p className="mb-3 text-xs text-muted">Used in: {where}</p>
      {editable && (
        <form onSubmit={add} className="mb-3 flex gap-2">
          <input className="input" aria-label={`New ${title.toLowerCase()}`} placeholder="Add an option" maxLength={200} value={value} onChange={(e) => setValue(e.target.value)} />
          <button className="btn-primary shrink-0" disabled={!value.trim()}><Plus className="h-4 w-4" /> Add</button>
        </form>
      )}
      {rows.length === 0 ? <p className="text-sm text-muted">Nothing added yet.</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              {editing?.id === r.id ? (
                <form className="flex flex-1 items-center gap-1.5" onSubmit={async (e) => { e.preventDefault(); if (await onRename(r.id, editing.value.trim())) setEditing(null); }}>
                  <input className="input h-8 py-1" autoFocus aria-label="Option" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
                  <button className="btn-primary h-8 px-2" aria-label="Save"><Check className="h-4 w-4" /></button>
                  <button type="button" className="btn-ghost h-8 px-2" aria-label="Cancel" onClick={() => setEditing(null)}><X className="h-4 w-4" /></button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">{r.value}</span>
                  {editable && <button className="btn-ghost h-7 px-2" aria-label={`Rename ${r.value}`} onClick={() => setEditing({ id: r.id, value: r.value })}><Pencil className="h-3.5 w-3.5" /></button>}
                  {editable && <button className="btn-ghost h-7 px-2 text-bad" aria-label={`Remove ${r.value}`} onClick={() => onRemove(r)}><Trash2 className="h-3.5 w-3.5" /></button>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {standard.length > 0 && <p className="mt-3 text-xs text-muted">Always offered: {standard.join(', ')}</p>}
    </Section>
  );
}
