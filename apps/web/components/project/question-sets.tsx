'use client';
import clsx from 'clsx';
import { Baby, Bookmark, Briefcase, Check, ChevronDown, GraduationCap, HandHeart, HeartPulse, Plus, RotateCcw, Save, ShoppingBag, Stethoscope, Trash2, Users, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { InfoTip } from '@/components/help';
import { api, ApiError, get } from '@/lib/api';
import type { Question } from '@/lib/types';

/** One gate survey question set (docs/GATE_QUESTION_SETS.md). */
export interface QuestionSetInfo {
  key: string;
  name: string;
  description: string;
  questions: Question[];
  builtIn: boolean;
  edited: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

const ICONS: Record<string, typeof Briefcase> = {
  b2b: Briefcase,
  b2c: ShoppingBag,
  parents: Baby,
  teens: GraduationCap,
  hc_consumer: HeartPulse,
  hc_patient: Stethoscope,
  hc_caregiver: HandHeart,
};

/** Adds the set's questions that are not on the list yet (same id = same question). Max 30 in all. */
export function mergeSet(current: Question[], set: Question[]): { next: Question[]; added: number; skipped: number } {
  const ids = new Set(current.map((q) => q.id));
  const fresh = set.filter((q) => !ids.has(q.id));
  const room = Math.max(0, 30 - current.length);
  const take = fresh.slice(0, room);
  return { next: [...current, ...take.map((q) => structuredClone(q))], added: take.length, skipped: set.length - take.length };
}

/**
 * "Audience sets" dialog of the question builder: add a whole set (B2B, B2C, parents, teens,
 * healthcare consumers, patients, caregivers) to the project, or save the project's questions as
 * the organisation's version of a set or as a new set.
 */
export function QuestionSetsDialog({ currency, value, onChange, onClose, canManage }: {
  currency: string;
  value: Question[];
  onChange: (q: Question[]) => void;
  onClose: () => void;
  /** Editors can change, reset and delete sets for the whole organisation. */
  canManage: boolean;
}) {
  const [sets, setSets] = useState<QuestionSetInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const load = useCallback(() => get<QuestionSetInfo[]>(`/question-templates/sets?currency=${currency}`).then(setSets).catch((e) => setError(e instanceof Error ? e.message : 'Could not load the sets')), [currency]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key); setError(null); setNote(null);
    try { await fn(); await load(); setNote(done); } catch (e) { setError(e instanceof ApiError ? [e.message, ...(e.issues ?? [])].join(' ') : 'Something went wrong'); } finally { setBusy(null); }
  };
  const add = (s: QuestionSetInfo) => {
    const r = mergeSet(value, s.questions);
    onChange(r.next);
    setNote(`${s.name}: added ${r.added} question${r.added === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} skipped (already on the list${value.length + r.added >= 30 ? ' or the 30-question limit' : ''})` : ''}. Open any question below to change it.`);
  };
  const saveAs = (key: string, name: string, description?: string) => run(key, () => api(`/question-templates/sets/${key}`, { method: 'PUT', json: { name, description: description ?? null, questions: value } }), key === 'new' ? `Saved “${name}” as a new set.` : `Saved this project's questions as your “${name}” set.`);
  const ids = new Set(value.map((q) => q.id));

  // Drawn in a portal: glass cards use backdrop filters, which would trap a fixed overlay inside them.
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center p-4" role="dialog" aria-modal="true" aria-labelledby="qs-title">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-start gap-3 border-b border-line p-4">
          <Users className="mt-0.5 h-5 w-5 text-brand" />
          <div className="min-w-0 flex-1">
            <h2 id="qs-title" className="flex items-center gap-1.5 font-semibold">Audience question sets<InfoTip id="question.sets" /></h2>
            <p className="text-sm text-muted">Ready-made demographic questions for each audience. Add a set, then change, remove or add questions on this project as you like.</p>
          </div>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-sunken" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {note && <p className="mb-3 flex items-start gap-2 rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok" role="status"><Check className="mt-0.5 h-4 w-4 shrink-0" />{note}</p>}
          {error && <p className="mb-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad" role="alert">{error}</p>}
          {!sets ? <p className="text-sm text-muted">Loading…</p> : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {sets.map((s) => {
                const Icon = ICONS[s.key] ?? Bookmark;
                const have = s.questions.filter((q) => ids.has(q.id)).length;
                const expanded = open === s.key;
                return (
                  <li key={s.key} className={clsx('rounded-xl border bg-panel', expanded ? 'border-brand sm:col-span-2' : 'border-line')}>
                    <div className="flex items-start gap-3 p-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"><Icon className="h-[18px] w-[18px]" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 font-medium">{s.name}
                          {!s.builtIn ? <span className="chip bg-sunken text-[10px] text-muted">Your set</span> : s.edited ? <span className="chip bg-warn/10 text-[10px] text-warn">Edited</span> : null}
                        </div>
                        <p className="text-xs text-muted">{s.description}</p>
                        <p className="mt-1 text-xs text-muted">{s.questions.length} question{s.questions.length === 1 ? '' : 's'}{have ? ` · ${have} already on this project` : ''}{s.updatedBy ? ` · saved by ${s.updatedBy}` : ''}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
                      <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={have === s.questions.length || value.length >= 30} onClick={() => add(s)}><Plus className="h-3.5 w-3.5" /> {have === s.questions.length ? 'Added' : 'Add to project'}</button>
                      <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : s.key)}><ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} /> {expanded ? 'Hide' : 'See questions'}</button>
                    </div>
                    {expanded && (
                      <div className="border-t border-line px-3 py-2">
                        <ol className="list-decimal space-y-1 pl-5 text-sm">
                          {s.questions.map((q) => (
                            <li key={q.id}>
                              <span className={clsx(ids.has(q.id) && 'text-muted')}>{q.text}</span>
                              {q.options?.some((o) => o.action !== 'accept') && <span className="ml-1 text-xs text-muted">(screens: {q.options.filter((o) => o.action !== 'accept').map((o) => `${o.label} → ${o.action === 'qualify' ? 'qualifies' : 'screened out'}`).join('; ')})</span>}
                              {q.qualify && <span className="ml-1 text-xs text-muted">(qualifies {q.qualify.min ?? '…'} to {q.qualify.max ?? '…'})</span>}
                            </li>
                          ))}
                        </ol>
                        {canManage && (
                          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-2">
                            <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" disabled={!value.length || busy === s.key} onClick={() => saveAs(s.key, s.name, s.description)} title="Replace this set with the questions now on this project"><Save className="h-3.5 w-3.5" /> Save this project's questions as this set</button>
                            {s.builtIn && s.edited && <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" disabled={busy === s.key} onClick={() => run(s.key, () => api(`/question-templates/sets/${s.key}`, { method: 'DELETE' }), `${s.name} is back to the standard questions.`)}><RotateCcw className="h-3.5 w-3.5" /> Reset to standard</button>}
                            {!s.builtIn && <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs text-bad" disabled={busy === s.key} onClick={() => window.confirm(`Delete the set “${s.name}”? Projects that already use its questions keep them.`) && run(s.key, () => api(`/question-templates/sets/${s.key}`, { method: 'DELETE' }), `Deleted “${s.name}”.`)}><Trash2 className="h-3.5 w-3.5" /> Delete set</button>}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {canManage && (
          <form className="flex flex-wrap items-center gap-2 border-t border-line p-4" onSubmit={(e) => { e.preventDefault(); if (newName.trim().length >= 2) saveAs('new', newName.trim()).then(() => setNewName('')); }}>
            <label className="min-w-0 flex-1 text-sm">
              <span className="sr-only">Name of the new set</span>
              <input className="input" maxLength={80} placeholder="e.g. IT decision makers, India" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>
            <button className="btn-ghost" disabled={!value.length || newName.trim().length < 2 || busy === 'new'}><Save className="h-4 w-4" /> Save this project's {value.length} question{value.length === 1 ? '' : 's'} as a new set</button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
