/**
 * PROJEXA quota cells → SAMPLEON quotas on SUPPLY360 profile attributes.
 *
 * A PROJEXA cell counts respondents by their gate or prescreener answers (or device). SAMPLEON
 * counts its respondents by their SUPPLY360 profile, so each question a cell uses is mapped once
 * onto a profile attribute, and each answer onto one of the attribute's values. The map is kept
 * on the project; answers whose label matches an attribute value are mapped without help.
 *
 * Cells that cannot be expressed this way (device cells, unmapped questions or answers, closed
 * cells) are not sent and are listed with the reason. PROJEXA keeps counting its own cells for the
 * respondents it routes itself; SAMPLEON counts its quotas for the respondents it invites.
 */
import { z } from 'zod';
import type { Question } from '../survey/questions';
import { conditionSchema, type Condition } from '../quotas/quota.rules';

export interface AttributeDef {
  key: string;
  label: string;
  type: 'enum' | 'number' | 'boolean' | 'string';
  values?: string[];
  synonyms?: Record<string, string[]>;
}

type Scalar = string | number | boolean;
export type Criterion =
  | { attribute: string; op: 'in'; values: Scalar[] }
  | { attribute: string; op: 'gte' | 'lte'; value: number }
  | { attribute: string; op: 'between'; min: number; max: number };

export interface SampleonQuota {
  id: string;
  label: string;
  country: string;
  conditions: Criterion[];
  target: number;
  hard: true;
}

/** Key of a question in the map: "gate:q_specialty" or "prescreen:age". */
export const questionKey = (source: 'gate' | 'prescreen', questionId: string) => `${source}:${questionId}`;

const ATTRIBUTE_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
export const quotaMapSchema = z
  .record(
    z.string().regex(/^(gate|prescreen):[a-z0-9_-]{1,32}$/i),
    z.object({
      attribute: z.string().regex(ATTRIBUTE_KEY),
      /** Answer id → attribute value. Answers left out are matched by label. */
      values: z.record(z.string().max(64), z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
    }),
  )
  .refine((m) => Object.keys(m).length <= 60, 'Map at most 60 questions');
export type QuotaMap = z.infer<typeof quotaMapSchema>;

export interface CellForTranslation {
  id: string;
  group: string;
  name: string;
  target: number;
  isOpen: boolean;
  country: string;
  conditions: unknown;
}

export interface Translation {
  quotas: SampleonQuota[];
  skipped: { cellId: string; name: string; country: string; reason: string }[];
  /** Questions the cells use, with the attribute they map to (saved or suggested). */
  questions: {
    key: string;
    text: string;
    type: string;
    attribute: string | null;
    suggested: boolean;
    answers: { id: string; label: string; value: Scalar | null; suggested: boolean }[];
  }[];
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 2));

/** An attribute value whose name or synonyms equal the answer label, or yes/no for booleans. */
export function matchValue(attr: AttributeDef, label: string): Scalar | null {
  const l = norm(label);
  if (attr.type === 'boolean') {
    if (['yes', 'true', 'y'].includes(l)) return true;
    if (['no', 'false', 'n'].includes(l)) return false;
    return null;
  }
  for (const v of attr.values ?? []) {
    if (norm(v) === l || (attr.synonyms?.[v] ?? []).some((s) => norm(s) === l)) return v;
  }
  return null;
}

/** The attribute whose label or synonyms share the most words with the question text. */
export function suggestAttribute(q: Question, catalogue: AttributeDef[]): AttributeDef | null {
  const want = q.type === 'number' ? ['number'] : ['enum', 'boolean', 'string'];
  const qw = words(q.text);
  let best: { a: AttributeDef; score: number } | null = null;
  for (const a of catalogue) {
    if (!want.includes(a.type)) continue;
    const aw = new Set([...words(a.label), ...words(a.key.replace(/[._]/g, ' ')), ...(a.synonyms?.[a.key] ?? []).flatMap((s) => [...words(s)])]);
    let score = [...aw].filter((w) => qw.has(w)).length;
    // Answers that match the attribute's values are strong evidence.
    if (q.options?.length) score += q.options.filter((o) => matchValue(a, o.label) !== null).length * 2;
    if (score > 0 && (!best || score > best.score)) best = { a, score };
  }
  return best?.a ?? null;
}

const quotaId = (cellId: string) => `pjx-${cellId}`.slice(0, 60);

export function translateCells(input: {
  cells: CellForTranslation[];
  gate: Question[];
  prescreen: Question[];
  catalogue: AttributeDef[];
  map: QuotaMap;
}): Translation {
  const byKey = new Map<string, Question>();
  for (const q of input.gate) byKey.set(questionKey('gate', q.id), q);
  for (const q of input.prescreen) byKey.set(questionKey('prescreen', q.id), q);
  const attrs = new Map(input.catalogue.map((a) => [a.key, a]));

  // Resolve each used question once: saved attribute, else a suggestion.
  const resolved = new Map<string, { attr: AttributeDef | null; suggested: boolean }>();
  const resolve = (key: string, q: Question) => {
    if (!resolved.has(key)) {
      const saved = input.map[key] ? attrs.get(input.map[key].attribute) ?? null : null;
      resolved.set(key, saved ? { attr: saved, suggested: false } : { attr: suggestAttribute(q, input.catalogue), suggested: true });
    }
    return resolved.get(key)!;
  };
  const valueFor = (key: string, attr: AttributeDef, optionId: string, label: string): { value: Scalar | null; suggested: boolean } => {
    const saved = input.map[key]?.attribute === attr.key ? input.map[key].values[optionId] : undefined;
    if (saved !== undefined) return { value: saved, suggested: false };
    return { value: matchValue(attr, label), suggested: true };
  };

  const merged = new Map<string, SampleonQuota>();
  const skipped: Translation['skipped'] = [];
  for (const cell of input.cells) {
    const skip = (reason: string) => skipped.push({ cellId: cell.id, name: cell.name, country: cell.country, reason });
    if (!cell.isOpen) { skip('The cell is closed in PROJEXA'); continue; }
    const parsed = z.array(conditionSchema).safeParse(cell.conditions);
    if (!parsed.success || !parsed.data.length) { skip('The cell has no usable conditions'); continue; }
    const criteria: Criterion[] = [];
    let problem: string | null = null;
    for (const c of parsed.data as Condition[]) {
      if (c.source === 'device') { problem = 'Device is only known when the respondent opens the survey'; break; }
      const key = questionKey(c.source, c.questionId!);
      const q = byKey.get(key);
      if (!q) { problem = `Question ${c.questionId} is no longer in the ${c.source === 'gate' ? 'gate survey' : 'prescreener'}`; break; }
      const { attr, suggested } = resolve(key, q);
      if (!attr || suggested) { problem = `Map “${q.text}” to a SUPPLY360 profile attribute`; break; }
      if (q.type === 'number') {
        if (attr.type !== 'number') { problem = `${attr.label} is not a number`; break; }
        if (c.min != null && c.max != null) criteria.push({ attribute: attr.key, op: 'between', min: c.min, max: c.max });
        else if (c.min != null) criteria.push({ attribute: attr.key, op: 'gte', value: c.min });
        else if (c.max != null) criteria.push({ attribute: attr.key, op: 'lte', value: c.max });
        continue;
      }
      if (attr.type === 'number') { problem = `${attr.label} is a number; “${q.text}” is a choice`; break; }
      const values: Scalar[] = [];
      for (const optionId of c.values ?? []) {
        const opt = q.options?.find((o) => o.id === optionId);
        const v = opt ? valueFor(key, attr, opt.id, opt.label).value : null;
        if (v === null) { problem = `Map the answer “${opt?.label ?? optionId}” to a value of ${attr.label}`; break; }
        if (!values.includes(v)) values.push(v);
      }
      if (problem) break;
      criteria.push({ attribute: attr.key, op: 'in', values });
    }
    if (problem) { skip(problem); continue; }
    // Language versions of one market have their own cells; SAMPLEON counts per country.
    const sig = `${cell.country}|${JSON.stringify(criteria)}`;
    const existing = merged.get(sig);
    if (existing) existing.target += cell.target;
    else merged.set(sig, { id: quotaId(cell.id), label: (cell.group ? `${cell.group}: ${cell.name}` : cell.name).slice(0, 120), country: cell.country, conditions: criteria, target: cell.target, hard: true });
  }

  const questions: Translation['questions'] = [];
  const used = new Set<string>();
  for (const cell of input.cells) {
    const parsed = z.array(conditionSchema).safeParse(cell.conditions);
    for (const c of parsed.success ? parsed.data : []) if (c.source !== 'device' && c.questionId) used.add(questionKey(c.source, c.questionId));
  }
  for (const key of used) {
    const q = byKey.get(key);
    if (!q) continue;
    const { attr, suggested } = resolve(key, q);
    questions.push({
      key, text: q.text, type: q.type, attribute: attr?.key ?? null, suggested,
      answers: (q.options ?? []).map((o) => ({ id: o.id, label: o.label, ...(attr && q.type !== 'number' ? valueFor(key, attr, o.id, o.label) : { value: null, suggested: false }) })),
    });
  }
  return { quotas: [...merged.values()], skipped, questions };
}
