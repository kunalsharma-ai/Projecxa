/**
 * Smart form rules (docs/SMART_FORMS.md): the schema types, validation and date reading used by
 * components/form. No React here, so scripts/check-forms.ts can test it with plain Node.
 */
import type { ReactNode } from 'react';
import type { Choice } from '../components/form/choice';
import type { Option } from '../components/form/combobox';

export interface DayRange { from: string | null; to: string | null }

export type Values = Record<string, unknown>;
export type FieldType =
  | 'text' | 'email' | 'url' | 'number' | 'textarea' | 'richtext'
  | 'select' | 'multiselect' | 'country' | 'countries' | 'currency'
  | 'date' | 'daterange' | 'radiocards' | 'checkboxes' | 'segmented' | 'switch' | 'tags' | 'file' | 'group' | 'color';

export interface Suggestion { value: unknown; label?: string; reason?: string }

/** One field in a form schema. Every rule is optional; `values` is the whole form. */
export interface FieldDef {
  name: string;
  type: FieldType;
  label: string;
  hint?: ReactNode;
  help?: ReactNode;
  placeholder?: string;
  required?: boolean | ((values: Values) => boolean);
  /** Options for select, multiselect, radiocards, checkboxes and segmented. */
  options?: (Option & Choice)[];
  /** Server-side search for select/multiselect (auto-complete). */
  onSearch?: (q: string) => Promise<Option[]>;
  creatable?: boolean;
  min?: number;
  max?: number;
  integer?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: [RegExp, string];
  /** Extra check: return a message to show, or null when the value is fine. */
  validate?: (value: unknown, values: Values) => string | null;
  /** Show the field only when this returns true. Hidden fields are not validated or submitted. */
  showIf?: (values: Values) => boolean;
  /** Columns the field spans in its section's grid. */
  span?: 1 | 2 | 3 | 'full';
  floating?: boolean;
  /** A value to offer (rule-based or from the server). Shown under the field with a "Use" button. */
  suggest?: (values: Values) => Suggestion | null | Promise<Suggestion | null>;
  /** Repeatable group: its own fields, and how many items are allowed. */
  fields?: FieldDef[];
  minItems?: number;
  maxItems?: number;
  itemLabel?: string;
  /** Pass-through settings for the control (columns, accept, maxSizeMb, selectAll, rows, prefix…). */
  props?: Record<string, unknown>;
}
export interface SectionDef { id?: string; title?: string; description?: ReactNode; columns?: 1 | 2 | 3 | 4; fields: FieldDef[]; showIf?: (values: Values) => boolean }
export interface FormSchema { sections: SectionDef[] }

// ───────────── Validation ─────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isEmpty(v: unknown): boolean {
  if (v == null || v === false || (typeof v === 'string' && !v.trim())) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object' && 'from' in (v as object)) return !(v as DayRange).from;
  return false;
}
export const isRequired = (d: FieldDef, values: Values) => (typeof d.required === 'function' ? d.required(values) : !!d.required);

/** The message for one field, or null. Runs required, type, length, range, pattern, then `validate`. */
export function checkField(d: FieldDef, value: unknown, values: Values): string | null {
  if (d.type === 'switch') return isRequired(d, values) && !value ? 'Please turn this on to continue.' : d.validate?.(value, values) ?? null;
  if (isEmpty(value)) {
    if (!isRequired(d, values)) return null;
    return ['select', 'country', 'currency', 'radiocards', 'segmented'].includes(d.type) ? 'Please choose one.' : ['multiselect', 'countries', 'checkboxes', 'tags'].includes(d.type) ? 'Please choose at least one.' : d.type === 'file' ? 'Please add a file.' : d.type === 'daterange' ? 'Please choose the dates.' : 'This is required.';
  }
  const s = typeof value === 'string' ? value.trim() : '';
  if (d.type === 'color' && !/^#[0-9a-f]{6}$/i.test(s)) return 'Use a colour like #1d4ed8.';
  if (d.type === 'email' && !EMAIL.test(s)) return 'Enter an email address like name@company.com.';
  if (d.type === 'url') { try { const u = new URL(s); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { return 'Enter a full link starting with https://'; } }
  if (d.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'Enter a number.';
    if (d.integer && !Number.isInteger(n)) return 'Enter a whole number.';
    if (d.min !== undefined && n < d.min) return `Enter ${d.min} or more.`;
    if (d.max !== undefined && n > d.max) return `Enter ${d.max} or less.`;
  }
  if (typeof value === 'string') {
    if (d.minLength && s.length < d.minLength) return `Use at least ${d.minLength} characters.`;
    if (d.maxLength && s.length > d.maxLength) return `Use at most ${d.maxLength} characters.`;
    if (d.pattern && !d.pattern[0].test(s)) return d.pattern[1];
  }
  if (Array.isArray(value)) {
    if (d.min !== undefined && value.length < d.min) return `Choose at least ${d.min}.`;
    if (d.max !== undefined && value.length > d.max) return `Choose no more than ${d.max}.`;
  }
  if (d.type === 'daterange') { const r = value as DayRange; if (r.from && !r.to) return 'Choose the end date.'; }
  return d.validate?.(value, values) ?? null;
}

/** Every error in the form, keyed by path ("contacts.0.email"), for the visible fields only. */
export function validateAll(schema: FormSchema, values: Values): Record<string, string> {
  const errors: Record<string, string> = {};
  const walk = (defs: FieldDef[], scope: Values, prefix: string) => {
    for (const d of defs) {
      if (d.showIf && !d.showIf(scope)) continue;
      const path = prefix + d.name;
      const v = scope[d.name];
      if (d.type === 'group') {
        const items = (v as Values[]) ?? [];
        if (d.minItems && items.length < d.minItems) errors[path] = `Add at least ${d.minItems}.`;
        items.forEach((item, i) => walk(d.fields ?? [], item, `${path}.${i}.`));
        continue;
      }
      const e = checkField(d, v, scope);
      if (e) errors[path] = e;
    }
  };
  for (const s of schema.sections) if (!s.showIf || s.showIf(values)) walk(s.fields, values, '');
  return errors;
}

/** The values to submit: hidden fields and sections left out, text trimmed. */
export function visibleValues(schema: FormSchema, values: Values): Values {
  const pick = (defs: FieldDef[], scope: Values): Values => {
    const out: Values = {};
    for (const d of defs) {
      if (d.showIf && !d.showIf(scope)) continue;
      const v = scope[d.name];
      out[d.name] = d.type === 'group' ? ((v as Values[]) ?? []).map((item) => pick(d.fields ?? [], item)) : d.type === 'number' ? (v === '' || v == null ? null : Number(v)) : typeof v === 'string' ? v.trim() : v;
    }
    return out;
  };
  return Object.assign({}, ...schema.sections.filter((s) => !s.showIf || s.showIf(values)).map((s) => pick(s.fields, values)));
}

export function emptyValue(d: FieldDef): unknown {
  if (d.type === 'group') return Array.from({ length: d.minItems ?? 0 }, () => Object.fromEntries((d.fields ?? []).map((x) => [x.name, emptyValue(x)])));
  if (['multiselect', 'countries', 'checkboxes', 'tags', 'file'].includes(d.type)) return [];
  if (d.type === 'daterange') return { from: null, to: null };
  if (d.type === 'switch') return false;
  if (['select', 'country', 'currency', 'date', 'radiocards'].includes(d.type)) return null;
  if (d.type === 'segmented') return d.options?.[0]?.value ?? '';
  return '';
}
export function initialValues(schema: FormSchema, given: Values = {}): Values {
  const out: Values = {};
  for (const s of schema.sections) for (const d of s.fields) out[d.name] = given[d.name] ?? emptyValue(d);
  return out;
}


// ───────────── Dates ─────────────

/** Dates are plain calendar days, 'YYYY-MM-DD', with no time zone. */
const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = (s: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
};
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const fmt = (s: string | null) => { const d = parseDay(s); return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };

/** Reads what people type: 2026-11-30, 30/11/2026, 30 Nov 2026, today, tomorrow, +7, next week. */
export function readDay(text: string, today = new Date()): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (t === 'today') return isoDay(today);
  if (t === 'tomorrow') return isoDay(addDays(today, 1));
  if (t === 'yesterday') return isoDay(addDays(today, -1));
  if (t === 'next week') return isoDay(addDays(today, 7));
  const rel = /^([+-])\s*(\d{1,3})\s*(d|days?|w|weeks?)?$/.exec(t);
  if (rel) return isoDay(addDays(today, (rel[1] === '-' ? -1 : 1) * +rel[2] * (rel[3]?.startsWith('w') ? 7 : 1)));
  if (parseDay(t)) return t;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (dmy) { const d = parseDay(`${dmy[3]}-${pad(+dmy[2])}-${pad(+dmy[1])}`); return d ? isoDay(d) : null; }
  const parsed = Date.parse(t);
  return Number.isNaN(parsed) ? null : isoDay(new Date(parsed));
}

