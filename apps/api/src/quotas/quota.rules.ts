/**
 * Quota cells: which cells a respondent belongs to, and whether any of them is full.
 * Pure functions so the matching rules are unit-testable; the survey service calls them
 * at entry (device-only cells) and again after the gate page (answer-based cells).
 */
import { z } from 'zod';
import type { Question } from '../survey/questions';

export const DEVICES = ['desktop', 'mobile', 'tablet'] as const;
/** Device quota values: a device type, or a system (android / ios, on phones and tablets). */
export const DEVICE_VALUES = [...DEVICES, 'android', 'ios'] as const;
export const QUOTA_SOURCES = ['device', 'gate', 'prescreen'] as const;
/** Question types a quota can target. Text and grid answers are too free-form to count against. */
export const QUOTABLE_TYPES = ['single', 'dropdown', 'multi', 'number'] as const;

export const conditionSchema = z
  .object({
    source: z.enum(QUOTA_SOURCES),
    /** gate / prescreen: the question's id. */
    questionId: z.string().regex(/^[a-z0-9_-]{1,32}$/i).optional(),
    /** device: desktop/mobile/tablet/android/ios; choice questions: option ids (any one matches). */
    values: z.array(z.string().min(1).max(64)).min(1).max(50).optional(),
    /** number questions: inclusive range. */
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.source === 'device') {
      if (!c.values?.length) ctx.addIssue({ code: 'custom', message: 'Pick at least one device' });
      else if (c.values.some((v) => !(DEVICE_VALUES as readonly string[]).includes(v))) ctx.addIssue({ code: 'custom', message: 'Unknown device' });
      return;
    }
    if (!c.questionId) ctx.addIssue({ code: 'custom', message: 'Pick a question' });
    if (!c.values?.length && c.min == null && c.max == null) ctx.addIssue({ code: 'custom', message: 'Pick answers or a range' });
    if (c.min != null && c.max != null && c.min > c.max) ctx.addIssue({ code: 'custom', message: 'Range minimum is above the maximum' });
  });
export type Condition = z.infer<typeof conditionSchema>;

export const cellInputSchema = z
  .object({
    /** Existing cell id; omit to create. */
    id: z.string().min(1).max(40).optional(),
    group: z.string().max(60).default(''),
    name: z.string().trim().min(1).max(120),
    target: z.number().int().min(1).max(1_000_000),
    isOpen: z.boolean().default(true),
    conditions: z.array(conditionSchema).min(1, 'A cell needs at least one condition').max(6),
  })
  .strict();
export const cellsInputSchema = z.object({ cells: z.array(cellInputSchema).max(200) }).strict();
export type CellInput = z.infer<typeof cellInputSchema>;

export interface CellState {
  id: string;
  conditions: unknown;
  target: number;
  completes: number;
  isOpen: boolean;
}

/** What is known about a respondent: device at entry, answers once the gate page is passed. */
export interface Respondent {
  device: string | null;
  /** android / ios / other, from the user agent. */
  os?: string | null;
  answers: { gate?: Record<string, { value: unknown }>; prescreen?: Record<string, { value: unknown }> } | null;
}

export const conditionsOf = (json: unknown): Condition[] => {
  const r = z.array(conditionSchema).safeParse(json);
  return r.success ? r.data : [];
};

/** Answer value for a condition; undefined when the respondent has not answered it (yet). */
function valueFor(c: Condition, r: Respondent): unknown {
  if (c.source === 'device') return r.device ?? undefined;
  return r.answers?.[c.source]?.[c.questionId!]?.value;
}

export function conditionMatches(c: Condition, r: Respondent): boolean {
  // A device condition matches the device type or the system (e.g. "android" or "mobile").
  if (c.source === 'device') return !!c.values?.some((x) => x === r.device || (!!r.os && x === r.os));
  const v = valueFor(c, r);
  if (v === undefined || v === null) return false;
  if (typeof v === 'number') {
    if (c.values?.length) return c.values.includes(String(v));
    return (c.min == null || v >= c.min) && (c.max == null || v <= c.max);
  }
  if (Array.isArray(v)) return !!c.values?.some((x) => v.includes(x));
  if (typeof v === 'string') return !!c.values?.includes(v);
  return false;
}

/** A cell matches when every one of its conditions does (cells interlock by combining conditions). */
export function cellMatches(cell: Pick<CellState, 'conditions'>, r: Respondent): boolean {
  const cs = conditionsOf(cell.conditions);
  return cs.length > 0 && cs.every((c) => conditionMatches(c, r));
}

/** True when the cell can only be judged after the gate page (it uses an answer). */
export const needsAnswers = (cell: Pick<CellState, 'conditions'>) => conditionsOf(cell.conditions).some((c) => c.source !== 'device');

export function matchCells<T extends CellState>(cells: T[], r: Respondent): { matched: T[]; full: T | null } {
  const matched = cells.filter((c) => cellMatches(c, r));
  const full = matched.find((c) => !c.isOpen || c.completes >= c.target) ?? null;
  return { matched, full };
}

/**
 * Checks cells against the project's questions. Returns readable problems, so the builder can
 * show "Q3 is not in the prescreener any more" instead of silently never matching.
 */
export function validateCells(cells: CellInput[], questions: { gate: Question[]; prescreen: Question[] }): string[] {
  const issues: string[] = [];
  cells.forEach((cell) => {
    cell.conditions.forEach((c) => {
      if (c.source === 'device') return;
      const q = questions[c.source].find((x) => x.id === c.questionId);
      const where = c.source === 'gate' ? 'gate survey' : 'prescreener';
      if (!q) return issues.push(`${cell.name}: question ${c.questionId} is not in the ${where}`);
      if (!(QUOTABLE_TYPES as readonly string[]).includes(q.type)) return issues.push(`${cell.name}: ${q.id} is a ${q.type} question; quotas need a choice or number question`);
      if (q.type === 'number') {
        if (c.values?.length) issues.push(`${cell.name}: use a range for the number question ${q.id}`);
      } else {
        if (!c.values?.length) issues.push(`${cell.name}: pick answers for ${q.id}`);
        const unknown = (c.values ?? []).filter((v) => !q.options?.some((o) => o.id === v));
        if (unknown.length) issues.push(`${cell.name}: ${q.id} has no option ${unknown.join(', ')}`);
      }
    });
  });
  return issues;
}
