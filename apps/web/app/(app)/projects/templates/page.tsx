'use client';
import { LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { Empty, ErrorBox, Field, Loading, PageHeader } from '@/components/ui';
import { api, get, patch } from '@/lib/api';
import { flag } from '@/lib/countries';
import { describeTemplate, type ProjectTemplate } from '@/lib/templates';

const TYPE: Record<string, string> = { AD_HOC: 'Ad-hoc', TRACKER: 'Tracker', LONGITUDINAL: 'Longitudinal', QUALITATIVE: 'Qualitative' };
const day = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function TemplatesPage() {
  const me = useMe();
  const [rows, setRows] = useState<ProjectTemplate[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; description: string } | null>(null);

  const load = () => get<ProjectTemplate[]>('/project-templates').then(setRows).catch(setError);
  useEffect(() => {
    load();
  }, []);

  const mayChange = (t: ProjectTemplate) => !!me && (me.user.role === 'ADMIN' || t.createdById === me.user.id);

  async function save() {
    if (!editing) return;
    setError(null);
    try {
      await patch(`/project-templates/${editing.id}`, { name: editing.name.trim(), description: editing.description.trim() || null });
      setEditing(null);
      load();
    } catch (e) {
      setError(e);
    }
  }
  async function remove(t: ProjectTemplate) {
    if (!confirm(`Delete the template “${t.name}”? Projects made from it are not changed.`)) return;
    setError(null);
    try {
      await api(`/project-templates/${t.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <PageHeader
        title="Project templates"
        subtitle="Reusable project setups. Save one from any project with Save as template, then pick it under Start from when you create a project."
        actions={canEdit(me) && <Link href="/projects/new" className="btn-primary"><Plus className="h-4 w-4" /> Create project</Link>}
      />
      <div className="mb-4"><ErrorBox error={error} /></div>
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No templates yet. Open a project you run often and choose Save as template.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rows.map((t) => (
            <div key={t.id} className="card flex flex-col p-5" data-template={t.name}>
              {editing?.id === t.id ? (
                <div className="space-y-3">
                  <Field label="Name"><input className="input" maxLength={120} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
                  <Field label="Description"><input className="input" maxLength={2000} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
                  <div className="flex gap-2"><button className="btn-primary" disabled={!editing.name.trim()} onClick={save}>Save</button><button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button></div>
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><LayoutTemplate className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{t.name}</div>
                      <div className="text-xs text-muted">{TYPE[t.type] ?? t.type} · {t.category}{t.clientId ? ' · with client' : ''} · {t.countries.map(flag).join(' ')} {t.countries.length} {t.countries.length === 1 ? 'market' : 'markets'}</div>
                    </div>
                    {mayChange(t) && (
                      <div className="flex shrink-0 gap-1">
                        <button className="btn-ghost h-8 px-2" aria-label={`Rename ${t.name}`} onClick={() => setEditing({ id: t.id, name: t.name, description: t.description ?? '' })}><Pencil className="h-3.5 w-3.5" /></button>
                        <button className="btn-ghost h-8 px-2 text-bad" aria-label={`Delete ${t.name}`} onClick={() => remove(t)}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    )}
                  </div>
                  {t.description && <p className="mt-3 text-sm">{t.description}</p>}
                  <p className="mt-2 text-sm text-muted">{describeTemplate(t)}{t.include.surveyLinks ? ' Survey links are included.' : ''}</p>
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                    <span className="mr-auto text-xs text-muted">
                      {t.createdBy ? `By ${t.createdBy}, ` : ''}{day(t.createdAt)} · used {t.useCount} {t.useCount === 1 ? 'time' : 'times'}{t.lastUsedAt ? `, last ${day(t.lastUsedAt)}` : ''}
                    </span>
                    {canEdit(me) && <Link href={`/projects/new?template=${t.id}`} className="btn-primary h-9">Use template</Link>}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
