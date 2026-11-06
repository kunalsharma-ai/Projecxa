'use client';
import clsx from 'clsx';
import { AlertTriangle, Lock, LockOpen, Pencil, Plus, Trash2, Wand2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectDetail } from '@/components/project/types';
import { Empty, ErrorBox, Loading, Progress, Section, StatusChip } from '@/components/ui';
import { api, get, patch } from '@/lib/api';
import { flag } from '@/lib/countries';
import { Label } from '@/components/help';

type Source = 'device' | 'gate' | 'prescreen';
export interface Condition { source: Source; questionId?: string; values?: string[]; min?: number; max?: number }
export interface Cell { id?: string; group: string; name: string; target: number; completes?: number; isOpen: boolean; conditions: Condition[]; inProgress?: number }
interface QuestionInfo { id: string; type: 'single' | 'dropdown' | 'multi' | 'number'; text: string; options: { id: string; label: string }[]; min?: number; max?: number }
interface QuotaView {
  gateSurvey: boolean;
  prescreening: boolean;
  questions: { gate: QuestionInfo[]; prescreen: QuestionInfo[] };
  countries: { id: string; countryCode: string; language: string; status: string; targetCompletes: number; completes: number; quotas: Cell[] }[];
}

const DEVICES = [{ id: 'desktop', label: 'Desktop' }, { id: 'mobile', label: 'Mobile' }, { id: 'tablet', label: 'Tablet' }];
const SOURCE_LABEL: Record<Source, string> = { device: 'Device', gate: 'Gate', prescreen: 'Prescreener' };

/** Field key used by the condition's question picker: "device", "gate:age", "prescreen:pet". */
const keyOf = (c: Condition) => (c.source === 'device' ? 'device' : `${c.source}:${c.questionId}`);

function questionFor(v: QuotaView, c: Condition): QuestionInfo | null {
  if (c.source === 'device') return { id: 'device', type: 'multi', text: 'Device', options: DEVICES };
  return v.questions[c.source].find((q) => q.id === c.questionId) ?? null;
}

/** "Gender is Female" / "Age 18–34" / "Device is Mobile or Tablet". */
export function describe(v: QuotaView | null, c: Condition): string {
  const q = v ? questionFor(v, c) : null;
  const name = c.source === 'device' ? 'Device' : q ? q.text.replace(/\?$/, '') : `${c.questionId} (missing)`;
  if (c.values?.length) return `${name}: ${c.values.map((x) => q?.options.find((o) => o.id === x)?.label ?? x).join(' or ')}`;
  if (c.min != null && c.max != null) return `${name}: ${c.min}–${c.max}`;
  if (c.min != null) return `${name}: ${c.min}+`;
  return `${name}: up to ${c.max}`;
}

export function QuotasTab({ project, editable }: { project: ProjectDetail; editable: boolean }) {
  const [view, setView] = useState<QuotaView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const load = useCallback(() => get<QuotaView>(`/projects/${project.id}/quotas`).then(setView).catch(setError), [project.id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!view) return error ? <ErrorBox error={error} /> : <Loading />;
  const answerSources = view.questions.gate.length + view.questions.prescreen.length;
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Quota cells split a market's target by device or by answers to the gate survey and prescreener. A cell can combine conditions (for example women aged 18–34). When a cell is full or closed, matching respondents go to quota full before they reach the client survey.
      </p>
      {!view.gateSurvey && !view.prescreening && (
        <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>The gate survey and prescreener are off, so only device cells can match. Turn them on and add questions in Gate &amp; security to quota on answers.</span>
        </div>
      )}
      {(view.gateSurvey || view.prescreening) && answerSources === 0 && <p className="text-sm text-muted">No choice or number questions yet. Add them in Gate &amp; security to quota on answers.</p>}
      <ErrorBox error={error} />
      {view.countries.map((c) =>
        editing === c.id ? (
          <CellEditor key={c.id} view={view} project={project} country={c} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
        ) : (
          <Section
            key={c.id}
            help="project.quotaMarket"
            title={<span className="flex items-center gap-2">{flag(c.countryCode)} {c.countryCode} · {c.language.toUpperCase()} <StatusChip status={c.status} /></span>}
            actions={
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted tabular-nums">{c.completes} / {c.targetCompletes} market completes</span>
                {editable && <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setEditing(c.id)}><Pencil className="h-3.5 w-3.5" /> {c.quotas.length ? 'Edit cells' : 'Add cells'}</button>}
              </div>
            }
          >
            {c.quotas.length === 0 ? (
              <Empty>No quota cells. Only the market target and vendor targets apply.</Empty>
            ) : (
              <CellTable view={view} project={project} countryId={c.id} cells={c.quotas} editable={editable} onChange={load} />
            )}
          </Section>
        ),
      )}
    </div>
  );
}

function CellTable({ view, project, countryId, cells, editable, onChange }: { view: QuotaView; project: ProjectDetail; countryId: string; cells: Cell[]; editable: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const toggle = async (cell: Cell) => {
    setBusy(cell.id!);
    setError(null);
    try {
      await patch(`/projects/${project.id}/countries/${countryId}/quotas/${cell.id}`, { isOpen: !cell.isOpen });
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <ErrorBox error={error} />
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr><th className="th">Cell</th><th className="th">Who counts</th><th className="th">Progress</th><th className="th text-right" title="Qualified for this cell and still in the survey">In survey</th><th className="th">State</th></tr></thead>
          <tbody>
            {cells.map((q) => {
              const full = (q.completes ?? 0) >= q.target;
              return (
                <tr key={q.id} className="border-t border-line">
                  <td className="td">{q.group && <div className="text-xs text-muted">{q.group}</div>}<div className="font-medium">{q.name}</div></td>
                  <td className="td text-muted">{q.conditions.map((c) => describe(view, c)).join(' and ')}</td>
                  <td className="td"><Progress value={q.completes ?? 0} max={q.target} /></td>
                  <td className="td text-right tabular-nums">{q.inProgress ?? 0}</td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <span className={clsx('chip', !q.isOpen ? 'bg-sunken text-muted' : full ? 'bg-warn/15 text-warn' : 'bg-ok/15 text-ok')}>{!q.isOpen ? 'Closed' : full ? 'Full' : 'Open'}</span>
                      {editable && (
                        <button className="btn-ghost px-2 py-1 text-xs" disabled={busy === q.id} onClick={() => toggle(q)} aria-label={q.isOpen ? `Close ${q.name}` : `Open ${q.name}`}>
                          {q.isOpen ? <><Lock className="h-3.5 w-3.5" /> Close</> : <><LockOpen className="h-3.5 w-3.5" /> Open</>}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CellEditor({ view, project, country, onClose, onSaved }: { view: QuotaView; project: ProjectDetail; country: QuotaView['countries'][number]; onClose: () => void; onSaved: () => void }) {
  const [cells, setCells] = useState<Cell[]>(() => country.quotas.map(({ id, group, name, target, isOpen, conditions, completes }) => ({ id, group, name, target, isOpen, conditions, completes })));
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [from, setFrom] = useState('');

  const fields = useMemo(
    () => [
      { key: 'device', label: 'Device', q: questionFor(view, { source: 'device' })! },
      ...(['gate', 'prescreen'] as const).flatMap((s) => view.questions[s].map((q) => ({ key: `${s}:${q.id}`, label: `${SOURCE_LABEL[s]} · ${q.id}: ${q.text}`, q }))),
    ],
    [view],
  );
  const condFromKey = (key: string): Condition => {
    if (key === 'device') return { source: 'device', values: [] };
    const [source, questionId] = key.split(':') as [Source, string];
    const q = view.questions[source as 'gate' | 'prescreen'].find((x) => x.id === questionId);
    return q?.type === 'number' ? { source, questionId, min: q.min, max: q.max } : { source, questionId, values: [] };
  };

  const set = (i: number, c: Partial<Cell>) => setCells((all) => all.map((x, n) => (n === i ? { ...x, ...c } : x)));
  const setCond = (i: number, j: number, c: Condition) => set(i, { conditions: cells[i].conditions.map((x, n) => (n === j ? c : x)) });

  /** One cell per answer of a choice question (or per device), splitting the market target evenly. */
  const addGroup = () => {
    const f = fields.find((x) => x.key === from);
    if (!f || f.q.type === 'number') return;
    const base = condFromKey(from);
    const group = f.key === 'device' ? 'Device' : f.q.text.replace(/\?$/, '').slice(0, 60);
    const each = Math.max(1, Math.round(country.targetCompletes / f.q.options.length));
    setCells((all) => [...all, ...f.q.options.map((o) => ({ group, name: o.label.slice(0, 120), target: each, isOpen: true, conditions: [{ ...base, values: [o.id] }] }))]);
    setFrom('');
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api(`/projects/${project.id}/countries/${country.id}/quotas`, {
        method: 'PUT',
        json: { cells: cells.map(({ id, group, name, target, isOpen, conditions }) => ({ ...(id ? { id } : {}), group, name, target: Number(target), isOpen, conditions })) },
      });
      onSaved();
    } catch (e) {
      // "cells.4.name: Too small…" → "Cell 5 name: Too small…"
      const err = e as { issues?: string[] };
      if (err.issues) err.issues = err.issues.map((x) => x.replace(/^cells\.(\d+)\.(conditions\.(\d+)\.)?/, (_m, i, c, j) => `Cell ${Number(i) + 1}${c ? `, condition ${Number(j) + 1}` : ''} `));
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  const choiceFields = fields.filter((f) => f.q.type !== 'number');
  return (
    <Section help="project.quotaMarket" title={<span>{flag(country.countryCode)} {country.countryCode} · edit quota cells</span>} actions={<button className="btn-ghost px-2 py-1 text-xs" onClick={onClose}><X className="h-3.5 w-3.5" /> Cancel</button>}>
      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line p-3">
        <label className="min-w-[220px] flex-1">
          <Label>Quick add: one cell per answer of</Label>
          <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose a question…</option>
            {choiceFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
        <button className="btn-ghost" disabled={!from} onClick={addGroup}><Wand2 className="h-4 w-4" /> Add cells</button>
        <span className="w-full text-xs text-muted">Targets start as an even split of the market target ({country.targetCompletes}); adjust them below.</span>
      </div>

      <div className="space-y-3">
        {cells.length === 0 && <Empty>No cells. Use quick add or add a cell.</Empty>}
        {cells.map((cell, i) => (
          <div key={cell.id ?? `new-${i}`} className="rounded-lg border border-line p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_110px_auto]">
              <label><Label>Group</Label><input className="input" placeholder="e.g. Gender" value={cell.group} onChange={(e) => set(i, { group: e.target.value })} /></label>
              <label><Label>Cell name</Label><input className="input" value={cell.name} onChange={(e) => set(i, { name: e.target.value })} /></label>
              <label><Label>Target</Label><input className="input tabular-nums" type="number" min={1} value={cell.target} onChange={(e) => set(i, { target: Number(e.target.value) })} /></label>
              <div className="flex items-end">
                <button className="btn-ghost px-2.5" aria-label={`Remove ${cell.name || 'cell'}`} onClick={() => setCells((all) => all.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
            {!!cell.completes && <p className="mt-1 text-xs text-muted">{cell.completes} completes counted so far. Removing the cell drops them from quota tracking only.</p>}
            <div className="mt-3 space-y-2">
              {cell.conditions.map((c, j) => {
                const q = questionFor(view, c);
                return (
                  <div key={j} className="flex flex-wrap items-center gap-2 rounded-md bg-sunken/60 p-2">
                    {j > 0 && <span className="text-xs font-medium text-muted">and</span>}
                    <select className="input w-auto max-w-full flex-1 py-1 text-sm sm:max-w-[280px]" value={keyOf(c)} onChange={(e) => setCond(i, j, condFromKey(e.target.value))} aria-label="Question">
                      {!q && <option value={keyOf(c)}>{c.questionId} (missing)</option>}
                      {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                    {q?.type === 'number' ? (
                      <span className="flex items-center gap-1 text-sm">
                        <input className="input w-20 py-1" type="number" placeholder="min" aria-label="Minimum" value={c.min ?? ''} onChange={(e) => setCond(i, j, { ...c, values: undefined, min: e.target.value === '' ? undefined : Number(e.target.value) })} />
                        to
                        <input className="input w-20 py-1" type="number" placeholder="max" aria-label="Maximum" value={c.max ?? ''} onChange={(e) => setCond(i, j, { ...c, values: undefined, max: e.target.value === '' ? undefined : Number(e.target.value) })} />
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {(q?.options ?? []).map((o) => {
                          const on = !!c.values?.includes(o.id);
                          return (
                            <button key={o.id} type="button" aria-pressed={on} onClick={() => setCond(i, j, { ...c, values: on ? c.values!.filter((x) => x !== o.id) : [...(c.values ?? []), o.id] })} className={clsx('chip border', on ? 'border-brand bg-brand/15 text-brand' : 'border-line text-muted hover:bg-sunken')}>
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {cell.conditions.length > 1 && (
                      <button className="ml-auto text-muted hover:text-bad" aria-label="Remove condition" onClick={() => set(i, { conditions: cell.conditions.filter((_, n) => n !== j) })}><X className="h-4 w-4" /></button>
                    )}
                  </div>
                );
              })}
              {cell.conditions.length < 6 && (
                <button className="text-xs text-brand hover:underline" onClick={() => set(i, { conditions: [...cell.conditions, condFromKey(fields.find((f) => !cell.conditions.some((c) => keyOf(c) === f.key))?.key ?? 'device')] })}>
                  + And another condition
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn-ghost" onClick={() => setCells((all) => [...all, { group: '', name: '', target: country.targetCompletes, isOpen: true, conditions: [condFromKey(fields[1]?.key ?? 'device')] }])}><Plus className="h-4 w-4" /> Add a cell</button>
        <button className="btn-primary ml-auto" disabled={saving} onClick={save}>Save cells</button>
      </div>
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Section>
  );
}
