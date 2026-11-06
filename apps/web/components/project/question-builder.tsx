'use client';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronDown, ClipboardPaste, Copy, Library, Plus, Trash2, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Field, Toggle } from '@/components/ui';
import { get } from '@/lib/api';
import { QuestionSetsDialog } from './question-sets';
import { QUESTION_TYPE_LABELS, TEXT_FORMAT_LABELS, type OptionAction, type Question, type QuestionOption, type QuestionType, type TextFormat } from '@/lib/types';

const ACTION_LABELS: Record<OptionAction, string> = { accept: 'Accept', qualify: 'Must pick one of these', terminate: 'Screen out' };
const CHOICE: QuestionType[] = ['single', 'multi', 'dropdown', 'grid'];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'q';
function uniqueId(base: string, taken: string[]) {
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base.slice(0, 28)}_${i}`;
  return id;
}
const nextOptionId = (opts: { id: string }[], prefix = 'o') => uniqueId(`${prefix}${opts.length + 1}`, opts.map((o) => o.id));

function blank(type: QuestionType, taken: string[]): Question {
  const id = uniqueId(`q${taken.length + 1}`, taken);
  const base: Question = { id, type, text: '', required: true, validation: {} };
  if (type === 'single' || type === 'multi' || type === 'dropdown') base.options = [{ id: 'o1', label: '', action: 'accept' }, { id: 'o2', label: '', action: 'accept' }];
  if (type === 'grid') {
    base.rows = [{ id: 'r1', label: '' }];
    base.options = [{ id: 'c1', label: 'Agree', action: 'accept' }, { id: 'c2', label: 'Neutral', action: 'accept' }, { id: 'c3', label: 'Disagree', action: 'accept' }];
  }
  if (type === 'number') base.validation = { integer: true };
  return base;
}

/** Problems the API would also reject; shown inline so executives can fix them before saving. */
export function questionProblems(q: Question): string[] {
  const p: string[] = [];
  const v = q.validation;
  if (!q.text.trim()) p.push('Write the question.');
  if (CHOICE.includes(q.type)) {
    if ((q.options ?? []).length < 2) p.push('Add at least two answers.');
    if ((q.options ?? []).some((o) => !o.label.trim())) p.push('Fill in every answer.');
    if ((q.options ?? []).length && (q.options ?? []).every((o) => o.action === 'terminate')) p.push('Every answer screens out, so nobody could qualify.');
  }
  if (q.type === 'grid' && (!(q.rows ?? []).length || (q.rows ?? []).some((r) => !r.label.trim()))) p.push('Fill in every row.');
  if (v.min !== undefined && v.max !== undefined && v.min > v.max) p.push('Maximum must be at least the minimum.');
  if (v.minSelect !== undefined && v.maxSelect !== undefined && v.minSelect > v.maxSelect) p.push('Maximum choices must be at least the minimum.');
  if (v.minLength !== undefined && v.maxLength !== undefined && v.minLength > v.maxLength) p.push('Maximum length must be at least the minimum.');
  if (q.qualify?.min !== undefined && q.qualify.max !== undefined && q.qualify.min > q.qualify.max) p.push('Qualifying maximum must be at least the minimum.');
  return p;
}

/** Strips empty values so what is saved matches the API schema exactly. */
export function cleanQuestion(q: Question): Question {
  const v = Object.fromEntries(Object.entries(q.validation).filter(([, x]) => x !== undefined && x !== false &&!(typeof x === 'number' && Number.isNaN(x)))) as Question['validation'];
  if (v.format === 'any') delete v.format;
  const out: Question = { id: q.id, type: q.type, text: q.text.trim(), required: q.required, validation: v };
  if (q.help?.trim()) out.help = q.help.trim();
  if (CHOICE.includes(q.type)) out.options = (q.options ?? []).map((o) => ({ id: o.id, label: o.label.trim(), action: o.action, ...(q.type === 'multi' && o.exclusive ? { exclusive: true } : {}) }));
  if (q.type === 'grid') out.rows = (q.rows ?? []).map((r) => ({ id: r.id, label: r.label.trim() }));
  if (q.type === 'number' && q.qualify && (q.qualify.min !== undefined || q.qualify.max !== undefined)) out.qualify = q.qualify;
  return out;
}

const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

export function QuestionBuilder({
  value,
  onChange,
  editable,
  templatesCurrency,
  emptyText,
}: {
  value: Question[];
  onChange: (q: Question[]) => void;
  editable: boolean;
  /** When set, offers the starter library (demographics, financial, education). */
  templatesCurrency?: string;
  emptyText: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState<'add' | 'library' | null>(null);
  const [setsOpen, setSetsOpen] = useState(false);
  const [library, setLibrary] = useState<{ group: string; question: Question }[] | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (menu === 'library' && !library && templatesCurrency) get<{ group: string; question: Question }[]>(`/question-templates?currency=${templatesCurrency}`).then(setLibrary).catch(() => setLibrary([]));
  }, [menu, library, templatesCurrency]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);

  const ids = value.map((q) => q.id);
  const set = (i: number, q: Question) => onChange(value.map((x, k) => (k === i ? q : x)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  function add(q: Question) {
    onChange([...value, q]);
    setOpen(q.id);
    setMenu(null);
  }

  return (
    <div>
      {value.length === 0 && <p className="mb-3 rounded-lg border border-dashed border-line p-4 text-sm text-muted">{emptyText}</p>}
      <ol className="space-y-2">
        {value.map((q, i) => {
          const expanded = open === q.id;
          const problems = questionProblems(q);
          return (
            <li key={i} className={clsx('rounded-lg border bg-panel', problems.length && !expanded ? 'border-bad/50' : 'border-line')}>
              <div className="flex items-start gap-2 p-3">
                <button type="button" onClick={() => setOpen(expanded ? null : q.id)} aria-expanded={expanded} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                  <span className="mt-0.5 w-6 shrink-0 text-sm font-semibold tabular-nums text-muted">{i + 1}.</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{q.text || <span className="text-muted">Untitled question</span>}</span>
                    <span className="block truncate text-xs text-muted">{summary(q)}</span>
                  </span>
                  <ChevronDown className={clsx('mt-1 h-4 w-4 shrink-0 text-muted transition-transform duration-[var(--dur)]', expanded && 'rotate-180')} />
                </button>
                {editable && (
                  <div className="flex shrink-0 items-center">
                    <IconBtn label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn label="Duplicate" onClick={() => add({ ...structuredClone(q), id: uniqueId(`${q.id}_copy`.slice(0, 32), ids) })}><Copy className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn label="Delete" onClick={() => onChange(value.filter((_, k) => k !== i))}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                  </div>
                )}
              </div>
              {expanded && <QuestionEditor q={q} onChange={(n) => set(i, n)} editable={editable} takenIds={ids.filter((x) => x !== q.id)} />}
              {problems.length > 0 && <p className="border-t border-line px-3 py-2 text-xs text-bad">{problems.join(' ')}</p>}
            </li>
          );
        })}
      </ol>
      {editable && (
        <div ref={menuRef} className="relative mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" aria-expanded={menu === 'add'} onClick={() => setMenu(menu === 'add' ? null : 'add')}><Plus className="h-4 w-4" /> Add question</button>
          {templatesCurrency && <button type="button" className="btn-ghost" aria-haspopup="dialog" onClick={() => { setMenu(null); setSetsOpen(true); }}><Users className="h-4 w-4" /> Audience sets</button>}
          {templatesCurrency && <button type="button" className="btn-ghost" aria-expanded={menu === 'library'} onClick={() => setMenu(menu === 'library' ? null : 'library')}><Library className="h-4 w-4" /> Add from library</button>}
          {menu === 'add' && (
            <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-line bg-panel p-1 shadow-lg" role="menu">
              {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => (
                <button key={t} type="button" role="menuitem" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-sunken" onClick={() => add(blank(t, ids))}>{QUESTION_TYPE_LABELS[t]}</button>
              ))}
            </div>
          )}
          {menu === 'library' && (
            <div className="absolute left-0 top-full z-20 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-panel p-1 shadow-lg" role="menu">
              {!library ? <p className="p-3 text-sm text-muted">Loading…</p> : library.map((t) => {
                const taken = ids.includes(t.question.id);
                return (
                  <button key={t.question.id} type="button" role="menuitem" disabled={taken} className="block w-full rounded px-3 py-2 text-left hover:bg-sunken disabled:opacity-50" onClick={() => add(t.question)}>
                    <span className="block text-xs uppercase tracking-wide text-muted">{t.group}{taken ? ' · added' : ''}</span>
                    <span className="block text-sm">{t.question.text}</span>
                  </button>
                );
              })}
              {library && (
                <button type="button" className="mt-1 block w-full rounded border-t border-line px-3 py-2 text-left text-sm font-medium text-brand hover:bg-sunken" onClick={() => {
                  onChange([...value, ...library.filter((t) => !ids.includes(t.question.id)).map((t) => t.question)]);
                  setMenu(null);
                }}>Add all standard profile questions</button>
              )}
            </div>
          )}
        </div>
      )}
      {setsOpen && templatesCurrency && <QuestionSetsDialog currency={templatesCurrency} value={value} onChange={onChange} onClose={() => setSetsOpen(false)} canManage={editable} />}
    </div>
  );
}

function summary(q: Question) {
  const v = q.validation;
  const parts: string[] = [QUESTION_TYPE_LABELS[q.type], q.required ? 'required' : 'optional'];
  if (q.options && q.type !== 'grid') parts.push(`${q.options.length} answers`);
  if (q.type === 'grid') parts.push(`${q.rows?.length ?? 0} rows × ${q.options?.length ?? 0} columns`);
  const outs = (q.options ?? []).filter((o) => o.action === 'terminate').length;
  const must = (q.options ?? []).filter((o) => o.action === 'qualify').length;
  if (outs) parts.push(`${outs} screen out`);
  if (must) parts.push(`must pick 1 of ${must}`);
  if (q.type === 'number' && (v.min !== undefined || v.max !== undefined)) parts.push(v.min !== undefined && v.max !== undefined ? `allowed ${v.min} to ${v.max}` : v.min !== undefined ? `allowed ${v.min} and over` : `allowed up to ${v.max}`);
  if (q.qualify?.min !== undefined && q.qualify.max !== undefined) parts.push(`qualifies ${q.qualify.min} to ${q.qualify.max}`);
  else if (q.qualify?.min !== undefined) parts.push(`qualifies ${q.qualify.min} and over`);
  else if (q.qualify?.max !== undefined) parts.push(`qualifies up to ${q.qualify.max}`);
  if (v.format) parts.push(TEXT_FORMAT_LABELS[v.format].toLowerCase());
  return parts.join(' · ');
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="rounded p-1.5 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30">
      {children}
    </button>
  );
}

function QuestionEditor({ q, onChange, editable, takenIds }: { q: Question; onChange: (q: Question) => void; editable: boolean; takenIds: string[] }) {
  const v = q.validation;
  const setV = (patch: Partial<Question['validation']>) => onChange({ ...q, validation: { ...v, ...patch } });
  const [paste, setPaste] = useState<string | null>(null);
  const idClash = takenIds.includes(q.id);

  function changeType(type: QuestionType) {
    const fresh = blank(type, takenIds);
    const keepOptions = CHOICE.includes(type) && type !== 'grid' && q.options && q.type !== 'grid';
    onChange({ ...fresh, id: q.id, text: q.text, help: q.help, required: q.required, ...(keepOptions ? { options: q.options!.map((o) => ({ ...o, exclusive: type === 'multi' ? o.exclusive : undefined })) } : {}) });
  }
  const setOption = (i: number, patch: Partial<QuestionOption>) => onChange({ ...q, options: (q.options ?? []).map((o, k) => (k === i ? { ...o, ...patch } : o)) });

  return (
    <fieldset disabled={!editable} className="space-y-4 border-t border-line p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_200px]">
        <Field label="Question">
          <input className="input" value={q.text} maxLength={500} placeholder="e.g. Which of these brands have you heard of?" onChange={(e) => onChange({ ...q, text: e.target.value, id: !q.text && /^q\d+$/.test(q.id) ? uniqueId(slug(e.target.value), takenIds) : q.id })} />
        </Field>
        <Field label="Type">
          <select className="input" value={q.type} onChange={(e) => changeType(e.target.value as QuestionType)}>
            {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_200px]">
        <Field label="Help text (optional)">
          <input className="input" value={q.help ?? ''} maxLength={300} onChange={(e) => onChange({ ...q, help: e.target.value })} />
        </Field>
        <Field label="Question ID" hint={idClash ? 'Another question uses this ID' : 'Column name in reports and exports'}>
          <input className={clsx('input font-mono text-xs', idClash && 'border-bad')} value={q.id} maxLength={32} onChange={(e) => onChange({ ...q, id: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })} />
        </Field>
      </div>
      <div className="flex items-center gap-3 text-sm"><Toggle checked={q.required} onChange={(required) => onChange({ ...q, required })} label="Required" /> Required</div>

      {q.type === 'grid' && (
        <div>
          <div className="label">Rows (statements)</div>
          <div className="space-y-2">
            {(q.rows ?? []).map((r, i) => (
              <div key={i} className="flex gap-2">
                <input className="input" value={r.label} placeholder={`Row ${i + 1}`} onChange={(e) => onChange({ ...q, rows: (q.rows ?? []).map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                <IconBtn label="Remove row" disabled={(q.rows ?? []).length < 2} onClick={() => onChange({ ...q, rows: (q.rows ?? []).filter((_, k) => k !== i) })}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
              </div>
            ))}
          </div>
          <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => onChange({ ...q, rows: [...(q.rows ?? []), { id: nextOptionId(q.rows ?? [], 'r'), label: '' }] })}><Plus className="h-3.5 w-3.5" /> Add row</button>
        </div>
      )}

      {CHOICE.includes(q.type) && (
        <div>
          <div className="label">{q.type === 'grid' ? 'Columns (answer scale)' : 'Answers'}</div>
          <div className="space-y-2">
            {(q.options ?? []).map((o, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_190px_auto]">
                <input className="input" value={o.label} placeholder={`Answer ${i + 1}`} maxLength={200} onChange={(e) => setOption(i, { label: e.target.value })} />
                <select className="input col-span-1 row-start-2 sm:row-start-auto" aria-label="What this answer does" value={o.action} onChange={(e) => setOption(i, { action: e.target.value as OptionAction })}>
                  {(Object.keys(ACTION_LABELS) as OptionAction[]).filter((a) => q.type !== 'grid' || a !== 'qualify').map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
                </select>
                <div className="flex items-center">
                  {q.type === 'multi' && (
                    <label className="mr-1 flex items-center gap-1 whitespace-nowrap text-xs text-muted" title="Choosing it clears the other answers">
                      <input type="checkbox" checked={!!o.exclusive} onChange={(e) => setOption(i, { exclusive: e.target.checked })} /> Only answer
                    </label>
                  )}
                  <IconBtn label="Remove answer" disabled={(q.options ?? []).length < 3} onClick={() => onChange({ ...q, options: (q.options ?? []).filter((_, k) => k !== i) })}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => onChange({ ...q, options: [...(q.options ?? []), { id: nextOptionId(q.options ?? [], q.type === 'grid' ? 'c' : 'o'), label: '', action: 'accept' }] })}><Plus className="h-3.5 w-3.5" /> Add answer</button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setPaste(paste === null ? '' : null)}><ClipboardPaste className="h-3.5 w-3.5" /> Paste a list</button>
          </div>
          {paste !== null && (
            <div className="mt-2 space-y-2">
              <textarea className="input min-h-[100px] text-sm" placeholder="One answer per line" value={paste} onChange={(e) => setPaste(e.target.value)} />
              <button type="button" className="btn-primary text-xs" onClick={() => {
                const lines = paste.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 50);
                const opts: QuestionOption[] = [];
                for (const label of lines) opts.push({ id: nextOptionId(opts, q.type === 'grid' ? 'c' : 'o'), label: label.slice(0, 200), action: 'accept' });
                if (opts.length >= 2) onChange({ ...q, options: opts });
                setPaste(null);
              }}>Replace answers with this list</button>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            <b>Screen out</b> ends the survey for anyone who picks it. <b>Must pick one of these</b> lets through only people who choose at least one marked answer.
            {q.type === 'grid' && ' In a grid, a screen-out column applies to every row.'}
          </p>
        </div>
      )}

      <div>
        <div className="label">Validation</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {q.type === 'number' && (
            <>
              <Field label="Lowest allowed"><input className="input" type="number" value={v.min ?? ''} onChange={(e) => setV({ min: num(e.target.value) })} /></Field>
              <Field label="Highest allowed"><input className="input" type="number" value={v.max ?? ''} onChange={(e) => setV({ max: num(e.target.value) })} /></Field>
              <label className="col-span-2 flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={!!v.integer} onChange={(e) => setV({ integer: e.target.checked })} /> Whole numbers only</label>
              <Field label="Qualifies from"><input className="input" type="number" value={q.qualify?.min ?? ''} onChange={(e) => onChange({ ...q, qualify: { ...q.qualify, min: num(e.target.value) } })} /></Field>
              <Field label="Qualifies up to"><input className="input" type="number" value={q.qualify?.max ?? ''} onChange={(e) => onChange({ ...q, qualify: { ...q.qualify, max: num(e.target.value) } })} /></Field>
              <p className="col-span-2 self-end pb-2 text-xs text-muted">Answers outside the qualifying range are screened out, e.g. age 18 and over.</p>
            </>
          )}
          {q.type === 'multi' && (
            <>
              <Field label="Fewest choices"><input className="input" type="number" min={0} value={v.minSelect ?? ''} onChange={(e) => setV({ minSelect: num(e.target.value) })} /></Field>
              <Field label="Most choices"><input className="input" type="number" min={1} value={v.maxSelect ?? ''} onChange={(e) => setV({ maxSelect: num(e.target.value) })} /></Field>
            </>
          )}
          {q.type === 'text' && (
            <>
              <Field label="Format">
                <select className="input" value={v.format ?? 'any'} onChange={(e) => setV({ format: e.target.value as TextFormat })}>
                  {(Object.keys(TEXT_FORMAT_LABELS) as TextFormat[]).map((f) => <option key={f} value={f}>{TEXT_FORMAT_LABELS[f]}</option>)}
                </select>
              </Field>
              <Field label="Shortest"><input className="input" type="number" min={0} value={v.minLength ?? ''} onChange={(e) => setV({ minLength: num(e.target.value) })} /></Field>
              <Field label="Longest"><input className="input" type="number" min={1} max={2000} value={v.maxLength ?? ''} onChange={(e) => setV({ maxLength: num(e.target.value) })} /></Field>
            </>
          )}
          {(q.type === 'single' || q.type === 'dropdown' || q.type === 'grid') && <p className="col-span-full text-xs text-muted">The answer must be one of the listed {q.type === 'grid' ? 'columns, on every row' : 'answers'}{q.required ? '' : ' (or left blank)'}.</p>}
        </div>
      </div>
    </fieldset>
  );
}
