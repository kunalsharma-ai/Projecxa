'use client';
import clsx from 'clsx';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { ClipboardEvent, KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useFieldIds } from './field';

/**
 * Free-text tags. Enter, comma or Tab adds; pasting a list adds each item; Backspace on an empty
 * box removes the last tag. `validate` returns an error for a bad tag, which is then not added.
 */
export function TagInput({ value, onChange, placeholder = 'Type and press Enter', validate, normalise = (s) => s.trim(), max, suggestions = [] }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string; validate?: (tag: string) => string | null; normalise?: (s: string) => string; max?: number; suggestions?: string[];
}) {
  const f = useFieldIds();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  function add(raw: string[]) {
    const next = [...value];
    let problem: string | null = null;
    for (const r of raw) {
      const t = normalise(r);
      if (!t || next.includes(t)) continue;
      if (max && next.length >= max) { problem = `Up to ${max}.`; break; }
      const bad = validate?.(t);
      if (bad) { problem = `${t}: ${bad}`; continue; }
      next.push(t);
    }
    setErr(problem);
    if (next.length !== value.length) onChange(next);
    return !problem;
  }
  function key(e: KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && text.trim())) && text.trim()) {
      e.preventDefault();
      if (add([text])) setText('');
    } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
  }
  function paste(e: ClipboardEvent<HTMLInputElement>) {
    const t = e.clipboardData.getData('text');
    if (/[,\n\s]/.test(t.trim())) { e.preventDefault(); add(t.split(/[,\n\s]+/)); }
  }
  const unused = suggestions.filter((s) => !value.includes(s));
  return (
    <div>
      <div className={clsx('input flex min-h-[2.375rem] cursor-text flex-wrap items-center gap-1 focus-within:border-brand focus-within:shadow-[0_0_0_3px_rgb(var(--brand)/0.2)]', (f.invalid || err) && 'border-bad')} onClick={() => input.current?.focus()}>
        {value.map((t) => (
          <span key={t} className="chip max-w-full bg-sunken text-ink">
            <span className="truncate">{t}</span>
            <button type="button" className="rounded-full text-muted hover:text-ink" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}><X className="h-3 w-3" /></button>
          </span>
        ))}
        <input ref={input} id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid || !!err || undefined} className="min-w-[6rem] flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted focus-visible:outline-none"
          value={text} placeholder={value.length ? '' : placeholder} onChange={(e) => { setText(e.target.value); setErr(null); }} onKeyDown={key} onPaste={paste} onBlur={() => { if (text.trim() && add([text])) setText(''); }} />
      </div>
      {err && <p className="mt-1 text-xs text-bad" role="alert">{err}</p>}
      {unused.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted">
          <span>Suggested:</span>
          {unused.map((s) => <button key={s} type="button" className="chip border border-dashed border-line hover:border-brand hover:text-brand" onClick={() => add([s])}>+ {s}</button>)}
        </div>
      )}
    </div>
  );
}

/**
 * Text that turns into an input when clicked (or on Enter). Enter or blur saves, Escape cancels.
 * `onSave` may be async; while it runs the field shows a spinner, and a thrown error is shown inline.
 */
export function InlineEdit({ value, onSave, label, placeholder = 'Add…', multiline, validate, display }: {
  value: string; onSave: (v: string) => Promise<void> | void; label: string; placeholder?: string; multiline?: boolean; validate?: (v: string) => string | null; display?: (v: string) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);
  useEffect(() => { if (state !== 'saved') return; const t = setTimeout(() => setState('idle'), 1500); return () => clearTimeout(t); }, [state]);
  async function save() {
    if (draft === value) { setEditing(false); return; }
    const bad = validate?.(draft);
    if (bad) { setErr(bad); return; }
    setState('saving');
    try {
      await onSave(draft);
      setErr(null);
      setEditing(false);
      setState('saved');
      setTimeout(() => btn.current?.focus(), 0);
    } catch (e) {
      setState('idle');
      setErr(e instanceof Error ? e.message : 'Could not save');
    }
  }
  const cancel = () => { setDraft(value); setErr(null); setEditing(false); setTimeout(() => btn.current?.focus(), 0); };
  if (!editing) {
    return (
      <button ref={btn} type="button" aria-label={`Edit ${label}`} onClick={() => setEditing(true)} className="group -mx-1.5 flex w-full min-w-0 items-start gap-1.5 rounded-md px-1.5 py-0.5 text-left text-sm hover:bg-sunken">
        <span className={clsx('min-w-0 flex-1', multiline ? 'whitespace-pre-line' : 'truncate', !value && 'text-muted')}>{value ? (display ? display(value) : value) : placeholder}</span>
        {state === 'saved' ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" aria-label="Saved" /> : <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />}
      </button>
    );
  }
  const common = {
    ref, value: draft, 'aria-label': label, 'aria-invalid': !!err || undefined, disabled: state === 'saving',
    onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); setErr(null); },
    onBlur: () => { if (state !== 'saving') void save(); },
    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } },
  };
  return (
    <div>
      <div className="relative">
        {multiline ? <textarea {...common} className="input min-h-[4.5rem] pr-8 text-sm" /> : <input {...common} className="input py-1 pr-8 text-sm" />}
        {state === 'saving' && <Loader2 className="absolute right-2 top-2 h-4 w-4 animate-spin text-muted" />}
      </div>
      <p className={clsx('mt-1 text-xs', err ? 'text-bad' : 'text-muted')} role={err ? 'alert' : undefined}>{err ?? (multiline ? 'Ctrl+Enter to save · Esc to cancel' : 'Enter to save · Esc to cancel')}</p>
    </div>
  );
}
