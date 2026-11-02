'use client';
import clsx from 'clsx';
import { AlertCircle, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { CSSProperties, FocusEvent, FormEvent, ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CheckboxGroup, Choice, RadioCards, Segmented, Switch } from './choice';
import { Combobox, CountrySelect, CurrencySelect, Option } from './combobox';
import { DatePicker, DateRangePicker, DayRange } from './date';
import { checkField, emptyValue, initialValues, isEmpty, isRequired, validateAll, visibleValues, type FieldDef, type FieldType, type FormSchema, type Suggestion, type Values } from '@/lib/form-rules';

export { checkField, emptyValue, initialValues, isEmpty, validateAll, visibleValues };
export type { FieldDef, FieldType, FormSchema, SectionDef, Suggestion, Values } from '@/lib/form-rules';
import { FormField, fieldProps, useFieldIds } from './field';
import { FileDrop, RichText } from './rich-text';
import { TagInput } from './tags';

// ───────────── Controls ─────────────

function Control({ d, value, set }: { d: FieldDef; value: unknown; set: (v: unknown) => void }) {
  const f = useFieldIds();
  const p = d.props ?? {};
  const opts = d.options ?? [];
  switch (d.type) {
    case 'textarea':
      return <textarea {...fieldProps(f)} className={clsx('input min-h-[5rem]', f.invalid && 'border-bad')} rows={(p.rows as number) ?? 3} maxLength={d.maxLength} placeholder={d.placeholder} value={(value as string) ?? ''} onChange={(e) => set(e.target.value)} />;
    case 'richtext':
      return <RichText value={(value as string) ?? ''} onChange={set} placeholder={d.placeholder} maxLength={d.maxLength} rows={p.rows as number} />;
    case 'select':
      return <Combobox options={opts} value={(value as string) ?? null} onChange={set} placeholder={d.placeholder ?? 'Choose…'} onSearch={d.onSearch} creatable={d.creatable} clearable={!isRequired(d, {})} />;
    case 'multiselect':
      return <Combobox multiple options={opts} value={(value as string[]) ?? []} onChange={set} placeholder={d.placeholder ?? 'Choose…'} onSearch={d.onSearch} creatable={d.creatable} max={d.max} />;
    case 'country':
      return <CountrySelect value={(value as string) ?? null} onChange={set} placeholder={d.placeholder} clearable={!isRequired(d, {})} />;
    case 'countries':
      return <CountrySelect multiple value={(value as string[]) ?? []} onChange={set} placeholder={d.placeholder} max={d.max} />;
    case 'currency':
      return <CurrencySelect value={(value as string) ?? null} onChange={set} placeholder={d.placeholder} />;
    case 'date':
      return <DatePicker value={(value as string) ?? null} onChange={set} min={p.minDate as string} max={p.maxDate as string} placeholder={d.placeholder} />;
    case 'daterange':
      return <DateRangePicker value={(value as DayRange) ?? { from: null, to: null }} onChange={set} placeholder={d.placeholder} />;
    case 'radiocards':
      return <RadioCards items={opts} value={(value as string) ?? null} onChange={set} columns={p.columns as 2 | 3 | 4} />;
    case 'checkboxes':
      return <CheckboxGroup items={opts} value={(value as string[]) ?? []} onChange={set} columns={p.columns as 1 | 2 | 3} selectAll={p.selectAll as boolean} />;
    case 'segmented':
      return <Segmented items={opts} value={(value as string) ?? ''} onChange={set} full={p.full as boolean} />;
    case 'switch':
      return <Switch checked={!!value} onChange={set} label={(p.switchLabel as ReactNode) ?? d.label} description={p.description as ReactNode} />;
    case 'tags':
      return <TagInput value={(value as string[]) ?? []} onChange={set} placeholder={d.placeholder} max={d.max} validate={p.validateTag as (t: string) => string | null} normalise={p.normalise as (s: string) => string} suggestions={p.suggestions as string[]} />;
    case 'file':
      return <FileDrop value={(value as File[]) ?? []} onChange={set} accept={p.accept as string} maxSizeMb={p.maxSizeMb as number} multiple={p.multiple as boolean} />;
    default: {
      const prefix = p.prefix as string | undefined;
      const suffix = p.suffix as string | undefined;
      const input = (
        <input {...fieldProps(f)} className={clsx('input', f.invalid && 'border-bad', prefix && 'pl-8', suffix && 'pr-12')} placeholder={d.floating ? ' ' : d.placeholder}
          type={d.type === 'number' ? 'number' : d.type === 'email' ? 'email' : d.type === 'url' ? 'url' : 'text'} inputMode={d.type === 'number' ? (d.integer ? 'numeric' : 'decimal') : undefined}
          step={d.type === 'number' ? (d.integer ? 1 : 'any') : undefined} min={d.min} max={d.max} maxLength={d.maxLength} autoComplete={(p.autoComplete as string) ?? (d.type === 'email' ? 'email' : 'off')}
          value={(value as string | number) ?? ''} onChange={(e) => set(e.target.value)} />
      );
      if (!prefix && !suffix) return input;
      return (
        <div className="relative">
          {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">{prefix}</span>}
          {input}
          {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span>}
        </div>
      );
    }
  }
}

function SuggestionChip({ d, values, value, set }: { d: FieldDef; values: Values; value: unknown; set: (v: unknown) => void }) {
  const [s, setS] = useState<Suggestion | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const key = JSON.stringify(values);
  useEffect(() => {
    if (!d.suggest) return;
    let live = true;
    const t = setTimeout(() => { Promise.resolve(d.suggest!(values)).then((r) => live && setS(r)).catch(() => live && setS(null)); }, 300);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!s || isEmpty(s.value)) return null;
  const sig = JSON.stringify(s.value);
  if (sig === JSON.stringify(value) || sig === dismissed) return null;
  return (
    <div className="anim-pop mt-1.5 flex items-start gap-1.5 rounded-md bg-brand/5 px-2 py-1 text-xs" role="status">
      <Sparkles className="mt-px h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
      <span className="min-w-0 flex-1 break-words">Suggested: <strong className="font-semibold">{s.label ?? String(s.value)}</strong>{s.reason && <span className="text-muted"> · {s.reason}</span>}</span>
      <span className="-my-0.5 flex shrink-0 items-center gap-0.5">
        <button type="button" className="rounded px-1.5 py-0.5 font-medium text-brand hover:bg-brand/10" onClick={() => set(s.value)}>Use</button>
        <button type="button" className="rounded p-0.5 text-muted hover:text-ink" aria-label="Dismiss suggestion" onClick={() => setDismissed(sig)}><X className="h-3 w-3" /></button>
      </span>
    </div>
  );
}

const SPAN: Record<string, string> = { '1': '', '2': 'sm:col-span-2', '3': 'sm:col-span-3', full: 'col-span-full' };
const COLS: Record<number, string> = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' };
const WIDE: FieldType[] = ['textarea', 'richtext', 'radiocards', 'checkboxes', 'file', 'group'];

interface FieldsProps { defs: FieldDef[]; scope: Values; setScope: (name: string, v: unknown) => void; path: string; errors: Record<string, string>; shown: (p: string) => boolean; touch: (p: string) => void; formId: string; columns: number; root: Values }

function Fields({ defs, scope, setScope, path, errors, shown, touch, formId, columns, root }: FieldsProps) {
  return (
    <div className={clsx('grid grid-cols-1 gap-x-4 gap-y-[calc(var(--field-y)*2+0.25rem)]', COLS[columns])}>
      {defs.map((d) => {
        if (d.showIf && !d.showIf(scope)) return null;
        const p = path + d.name;
        const id = `${formId}-${p.replace(/\./g, '-')}`;
        const err = shown(p) ? errors[p] : undefined;
        const span = d.span ?? (WIDE.includes(d.type) ? 'full' : 1);
        const onBlur = (e: FocusEvent<HTMLDivElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) touch(p); };
        if (d.type === 'group') {
          const items = (scope[d.name] as Values[]) ?? [];
          const fresh = () => Object.fromEntries((d.fields ?? []).map((x) => [x.name, emptyValue(x)]));
          return (
            <fieldset key={d.name} className={clsx('min-w-0', SPAN[String(span)])} id={id}>
              <legend className={clsx(d.props?.hideLabel ? 'sr-only' : 'mb-1.5 text-xs font-medium text-muted')}>{d.label}</legend>
              <div className="space-y-2">
                {items.map((item, i) => (
                  <div key={i} className="relative rounded-lg border border-line bg-sunken/30 p-3 pr-10">
                    <div className="mb-2 text-xs font-semibold text-muted">{d.itemLabel ?? 'Item'} {i + 1}</div>
                    <Fields defs={d.fields ?? []} scope={item} path={`${p}.${i}.`} errors={errors} shown={shown} touch={touch} formId={formId} columns={(d.props?.columns as number) ?? 2} root={root}
                      setScope={(n, v) => setScope(d.name, items.map((it, j) => (j === i ? { ...it, [n]: v } : it)))} />
                    {items.length > (d.minItems ?? 0) && (
                      <button type="button" className="absolute right-2 top-2 rounded p-1.5 text-muted hover:bg-panel hover:text-bad" aria-label={`Remove ${(d.itemLabel ?? 'item').toLowerCase()} ${i + 1}`} onClick={() => setScope(d.name, items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                ))}
              </div>
              {(!d.maxItems || items.length < d.maxItems) && (
                <button type="button" className="btn-ghost mt-2 h-8 px-2.5 text-xs" onClick={() => setScope(d.name, [...items, fresh()])}><Plus className="h-3.5 w-3.5" /> Add {(d.itemLabel ?? 'item').toLowerCase()}</button>
              )}
              {err && <p className="mt-1 text-xs text-bad" role="alert">{err}</p>}
            </fieldset>
          );
        }
        return (
          <div key={d.name} className={clsx('min-w-0', SPAN[String(span)])} onBlur={onBlur} data-field={p}>
            {d.type === 'switch' ? (
              <FormField id={id} label={d.label} error={err} hint={d.hint} help={d.help} className="[&>div:first-child]:hidden">
                <Control d={d} value={scope[d.name]} set={(v) => setScope(d.name, v)} />
              </FormField>
            ) : (
              <FormField id={id} label={d.label} error={err} hint={d.hint} help={d.help} required={isRequired(d, scope)} floating={d.floating}>
                <Control d={d} value={scope[d.name]} set={(v) => setScope(d.name, v)} />
              </FormField>
            )}
            {d.suggest && <SuggestionChip d={d} values={{ ...root, ...scope }} value={scope[d.name]} set={(v) => setScope(d.name, v)} />}
          </div>
        );
      })}
    </div>
  );
}

// ───────────── The form ─────────────

export interface SmartFormProps {
  schema: FormSchema;
  initial?: Values;
  onSubmit: (values: Values) => Promise<void> | void;
  submitLabel?: string;
  onCancel?: () => void;
  /** Autosaves unsent values in this browser under this key, and offers them back next time. */
  draftKey?: string;
  density?: 'compact' | 'comfortable';
  /** Called on every change, for live previews. */
  onChange?: (values: Values) => void;
  footer?: ReactNode;
  className?: string;
}

/**
 * Renders a form from a schema: sections, show-if rules, repeatable groups, validation on blur
 * and on submit with an error summary, suggestions, drafts and Ctrl+Enter to submit.
 */
export function SmartForm({ schema, initial, onSubmit, submitLabel = 'Save', onCancel, draftKey, density, onChange, footer, className }: SmartFormProps) {
  const formId = `sf${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const start = useMemo(() => initialValues(schema, initial), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [values, setValues] = useState<Values>(start);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const errors = useMemo(() => validateAll(schema, values), [schema, values]);
  const dirty = JSON.stringify(values) !== JSON.stringify(start);
  const storageKey = draftKey ? `projexa.draft.${draftKey}` : null;

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) { setValues({ ...start, ...JSON.parse(raw) }); setRestored(true); }
    } catch { /* storage blocked */ }
  }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!storageKey) return;
    const t = setTimeout(() => {
      try {
        if (!dirty) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, JSON.stringify(values, (_k, v) => (typeof File !== 'undefined' && v instanceof File ? undefined : v)));
      } catch { /* storage blocked */ }
    }, 400);
    return () => clearTimeout(t);
  }, [values, dirty, storageKey]);
  useEffect(() => { onChange?.(values); }, [values]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dirty || busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  const shown = (p: string) => submitted || touched.has(p);
  const touch = (p: string) => setTouched((t) => (t.has(p) ? t : new Set(t).add(p)));
  const focusField = (p: string) => {
    const el = document.getElementById(`${formId}-${p.replace(/\./g, '-')}`);
    const target = el?.matches('input,select,textarea,button') ? el : el?.querySelector<HTMLElement>('input,select,textarea,button');
    (target ?? el)?.focus();
    (target ?? el)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length) { requestAnimationFrame(() => summary.current?.focus()); return; }
    setBusy(true);
    try {
      await onSubmit(visibleValues(schema, values));
      if (storageKey) try { localStorage.removeItem(storageKey); } catch { /* storage blocked */ }
    } finally { setBusy(false); }
  }
  const discard = () => { setValues(start); setRestored(false); setTouched(new Set()); setSubmitted(false); if (storageKey) try { localStorage.removeItem(storageKey); } catch { /* storage blocked */ } };
  const labelOf = (p: string) => {
    const parts = p.split('.');
    let defs = schema.sections.flatMap((s) => s.fields);
    const names: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const d = defs.find((x) => x.name === parts[i]);
      if (!d) break;
      if (d.type === 'group' && parts[i + 1] !== undefined) { names.push(`${d.itemLabel ?? d.label} ${+parts[i + 1] + 1}`); defs = d.fields ?? []; i++; } else names.push(d.label);
    }
    return names.join(' › ');
  };
  const errorList = Object.entries(errors);
  const style = density === 'compact' ? ({ '--field-y': '0.3rem' } as CSSProperties) : density === 'comfortable' ? ({ '--field-y': '0.5rem' } as CSSProperties) : undefined;

  return (
    <form noValidate onSubmit={submit} className={clsx('space-y-6', className)} style={style} data-density={density}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }}>
      {restored && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-info/10 px-3 py-2 text-sm text-info" role="status">
          <span className="flex-1">We restored the draft you didn&apos;t send.</span>
          <button type="button" className="font-medium underline" onClick={discard}>Discard it</button>
        </div>
      )}
      {submitted && errorList.length > 0 && (
        <div ref={summary} tabIndex={-1} className="rounded-lg border border-bad/40 bg-bad/5 p-3 text-sm outline-none" role="alert" aria-labelledby={`${formId}-sum`}>
          <p id={`${formId}-sum`} className="flex items-center gap-2 font-semibold text-bad"><AlertCircle className="h-4 w-4" /> Please fix {errorList.length === 1 ? 'this' : `these ${errorList.length} things`} before saving</p>
          <ul className="mt-1.5 space-y-0.5 pl-6">
            {errorList.map(([p, m]) => <li key={p}><button type="button" className="text-left text-bad underline-offset-2 hover:underline" onClick={() => focusField(p)}><strong>{labelOf(p)}</strong>: {m}</button></li>)}
          </ul>
        </div>
      )}
      {schema.sections.map((s, i) => {
        if (s.showIf && !s.showIf(values)) return null;
        return (
          <section key={s.id ?? i} className={clsx(i > 0 && s.title && 'border-t border-line pt-5')} aria-labelledby={s.title ? `${formId}-s${i}` : undefined}>
            {s.title && <h3 id={`${formId}-s${i}`} className="text-sm font-semibold">{s.title}</h3>}
            {s.description && <p className="mt-0.5 text-xs text-muted">{s.description}</p>}
            <div className={clsx(s.title && 'mt-3')}>
              <Fields defs={s.fields} scope={values} root={values} path="" errors={errors} shown={shown} touch={touch} formId={formId} columns={s.columns ?? 2} setScope={(n, v) => setValues((cur) => ({ ...cur, [n]: v }))} />
            </div>
          </section>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {footer}
        <span className="mr-auto hidden text-xs text-muted sm:inline">{dirty ? <>Unsaved changes{storageKey ? ' · draft kept in this browser' : ''}</> : null}</span>
        <span className="hidden text-xs text-muted md:inline">Ctrl+Enter to save</span>
        {onCancel && <button type="button" className="btn-ghost" onClick={() => { discard(); onCancel(); }}>Cancel</button>}
        <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  );
}
