import { z } from 'zod';

/**
 * Question model shared by the gate survey and the prescreener.
 * Executives build these per project; the gate page renders them, and the server validates
 * every answer again and applies the screening rules (the browser is never trusted).
 */

export const QUESTION_TYPES = ['single', 'multi', 'dropdown', 'number', 'text', 'grid'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** What choosing an option does. "qualify": if a question has any, one of them must be chosen. */
export const OPTION_ACTIONS = ['accept', 'qualify', 'terminate'] as const;

/** Text formats; fixed patterns only (no free regex, which could hang the server). */
export const TEXT_FORMATS = {
  any: { label: 'Any text', re: null },
  letters: { label: 'Letters and spaces', re: /^[\p{L}\p{M}' .-]+$/u },
  digits: { label: 'Digits only', re: /^\d+$/ },
  alphanumeric: { label: 'Letters and digits', re: /^[\p{L}\p{N} ]+$/u },
  email: { label: 'Email address', re: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ },
  postal: { label: 'Postal / ZIP code', re: /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/ },
  phone: { label: 'Phone number', re: /^\+?[0-9 ()-]{6,20}$/ },
} as const;
export type TextFormat = keyof typeof TEXT_FORMATS;

const idRe = /^[a-z0-9_-]{1,32}$/i;
const optionSchema = z.object({
  id: z.string().regex(idRe),
  label: z.string().min(1).max(200),
  action: z.enum(OPTION_ACTIONS).default('accept'),
  /** "None of these": choosing it clears the other choices in a multi question. */
  exclusive: z.boolean().optional(),
});

export const questionSchema = z
  .object({
    id: z.string().regex(idRe, 'Use letters, digits, - or _ (max 32)'),
    type: z.enum(QUESTION_TYPES),
    text: z.string().min(1).max(500),
    help: z.string().max(300).optional(),
    required: z.boolean().default(true),
    options: z.array(optionSchema).max(50).optional(),
    /** Grid: statements (rows); columns are the options. */
    rows: z.array(z.object({ id: z.string().regex(idRe), label: z.string().min(1).max(200) })).max(30).optional(),
    validation: z
      .object({
        /** number: allowed range and whether decimals are allowed. */
        min: z.number().optional(),
        max: z.number().optional(),
        integer: z.boolean().optional(),
        /** multi: how many choices. */
        minSelect: z.number().int().min(0).max(50).optional(),
        maxSelect: z.number().int().min(1).max(50).optional(),
        /** text */
        minLength: z.number().int().min(0).max(2000).optional(),
        maxLength: z.number().int().min(1).max(2000).optional(),
        format: z.enum(Object.keys(TEXT_FORMATS) as [TextFormat, ...TextFormat[]]).optional(),
      })
      .strict()
      .default({}),
    /** number: answers outside this range are screened out (they are valid answers, just not qualifying). */
    qualify: z.object({ min: z.number().optional(), max: z.number().optional() }).strict().optional(),
  })
  .superRefine((q, ctx) => {
    const v = q.validation;
    const needsOptions = q.type === 'single' || q.type === 'multi' || q.type === 'dropdown' || q.type === 'grid';
    if (needsOptions && (!q.options || q.options.length < 2)) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least two answers' });
    if (q.options && new Set(q.options.map((o) => o.id)).size !== q.options.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Answer ids must be unique' });
    if (q.options?.length && q.options.every((o) => o.action === 'terminate')) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Every answer screens out; nobody could qualify' });
    if (q.type === 'grid') {
      if (!q.rows || q.rows.length < 1) ctx.addIssue({ code: 'custom', path: ['rows'], message: 'Add at least one row' });
      if (q.rows && new Set(q.rows.map((r) => r.id)).size !== q.rows.length) ctx.addIssue({ code: 'custom', path: ['rows'], message: 'Row ids must be unique' });
    }
    if (v.min !== undefined && v.max !== undefined && v.min > v.max) ctx.addIssue({ code: 'custom', path: ['validation', 'max'], message: 'Max must be at least min' });
    if (v.minSelect !== undefined && v.maxSelect !== undefined && v.minSelect > v.maxSelect) ctx.addIssue({ code: 'custom', path: ['validation', 'maxSelect'], message: 'Max choices must be at least min choices' });
    if (v.minLength !== undefined && v.maxLength !== undefined && v.minLength > v.maxLength) ctx.addIssue({ code: 'custom', path: ['validation', 'maxLength'], message: 'Max length must be at least min length' });
    if (q.qualify && q.type !== 'number') ctx.addIssue({ code: 'custom', path: ['qualify'], message: 'Qualifying ranges apply to number questions' });
    if (q.qualify?.min !== undefined && q.qualify.max !== undefined && q.qualify.min > q.qualify.max) ctx.addIssue({ code: 'custom', path: ['qualify', 'max'], message: 'Qualifying max must be at least min' });
  });

export const questionListSchema = z
  .array(questionSchema)
  .max(30)
  .refine((qs) => new Set(qs.map((q) => q.id)).size === qs.length, 'Question ids must be unique');

export type Question = z.infer<typeof questionSchema>;
export type Answer = { value: string | number | string[] | Record<string, string>; label: string };
export type AnswerSet = Record<string, Answer>;

export function questionsOf(json: unknown): Question[] {
  const r = questionListSchema.safeParse(json ?? []);
  return r.success ? r.data : [];
}

/**
 * Validates submitted answers. Returns the cleaned answers, the first invalid question (if any)
 * and the first question whose answer screens the respondent out (if any).
 */
export function evaluate(questions: Question[], raw: unknown): { answers: AnswerSet; invalid?: string; screenedOut?: string } {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const answers: AnswerSet = {};
  let screenedOut: string | undefined;
  for (const q of questions) {
    const r = readOne(q, input[q.id]);
    if (r === 'invalid') return { answers, invalid: q.id };
    if (r === 'empty') continue;
    answers[q.id] = r.answer;
    if (!screenedOut && r.out) screenedOut = q.id;
  }
  return { answers, screenedOut };
}

function readOne(q: Question, v: unknown): 'invalid' | 'empty' | { answer: Answer; out: boolean } {
  const val = q.validation;
  const blank = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && v !== null && Object.keys(v).length === 0);
  if (blank) return q.required ? 'invalid' : 'empty';
  const opts = q.options ?? [];
  const byId = (id: unknown) => opts.find((o) => o.id === id);
  const optionRule = (chosen: typeof opts) => chosen.some((o) => o.action === 'terminate') || (opts.some((o) => o.action === 'qualify') && !chosen.some((o) => o.action === 'qualify'));

  switch (q.type) {
    case 'single':
    case 'dropdown': {
      const o = byId(v);
      if (!o) return 'invalid';
      return { answer: { value: o.id, label: o.label }, out: optionRule([o]) };
    }
    case 'multi': {
      if (!Array.isArray(v) || v.length > opts.length) return 'invalid';
      const ids = [...new Set(v)];
      const chosen = ids.map(byId);
      if (chosen.some((o) => !o)) return 'invalid';
      const list = chosen as typeof opts;
      if (list.length > 1 && list.some((o) => o.exclusive)) return 'invalid';
      if (val.minSelect !== undefined && list.length < val.minSelect) return 'invalid';
      if (val.maxSelect !== undefined && list.length > val.maxSelect) return 'invalid';
      return { answer: { value: list.map((o) => o.id), label: list.map((o) => o.label).join('; ') }, out: optionRule(list) };
    }
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
      if (!Number.isFinite(n)) return 'invalid';
      if (val.integer && !Number.isInteger(n)) return 'invalid';
      if ((val.min !== undefined && n < val.min) || (val.max !== undefined && n > val.max)) return 'invalid';
      const out = !!q.qualify && ((q.qualify.min !== undefined && n < q.qualify.min) || (q.qualify.max !== undefined && n > q.qualify.max));
      return { answer: { value: n, label: String(n) }, out };
    }
    case 'text': {
      if (typeof v !== 'string') return 'invalid';
      const t = v.trim();
      const max = Math.min(val.maxLength ?? 500, 2000);
      if (t.length < (val.minLength ?? (q.required ? 1 : 0)) || t.length > max) return 'invalid';
      const re = TEXT_FORMATS[val.format ?? 'any'].re;
      if (re && !re.test(t)) return 'invalid';
      return { answer: { value: t, label: t }, out: false };
    }
    case 'grid': {
      if (typeof v !== 'object' || Array.isArray(v) || v === null) return 'invalid';
      const g = v as Record<string, unknown>;
      const value: Record<string, string> = {};
      const chosen: typeof opts = [];
      for (const row of q.rows ?? []) {
        const o = byId(g[row.id]);
        if (!o) return 'invalid';
        value[row.id] = o.id;
        chosen.push(o);
      }
      // Grid screening: any "terminate" column chosen on any row screens out.
      return { answer: { value, label: (q.rows ?? []).map((r) => `${r.label}: ${byId(value[r.id])!.label}`).join('; ') }, out: chosen.some((o) => o.action === 'terminate') };
    }
  }
}

// ───────────── Starter templates for the gate survey ─────────────

const INCOME_BANDS: Record<string, string[]> = {
  DEFAULT: ['Under 25,000', '25,000 to 49,999', '50,000 to 74,999', '75,000 to 99,999', '100,000 to 149,999', '150,000 or more'],
  INR: ['Under 3 lakh', '3 to 6 lakh', '6 to 10 lakh', '10 to 20 lakh', '20 to 50 lakh', '50 lakh or more'],
  JPY: ['Under 3 million', '3 to 5 million', '5 to 7 million', '7 to 10 million', '10 to 15 million', '15 million or more'],
};
const opt = (id: string, label: string, action: 'accept' | 'qualify' | 'terminate' = 'accept') => ({ id, label, action });

/** Ready-made demographics, financial and education questions an executive can insert and edit. */
export function questionTemplates(currency = 'USD'): { group: string; question: Question }[] {
  const bands = INCOME_BANDS[currency] ?? INCOME_BANDS.DEFAULT;
  const t = (group: string, q: Omit<Question, 'required' | 'validation'> & Partial<Pick<Question, 'required' | 'validation'>>) => ({
    group,
    question: { required: true, validation: {}, ...q } as Question,
  });
  return [
    t('Demographics', { id: 'age', type: 'number', text: 'How old are you?', validation: { min: 1, max: 120, integer: true }, qualify: { min: 18 } }),
    t('Demographics', { id: 'gender', type: 'single', text: 'What is your gender?', options: [opt('male', 'Male'), opt('female', 'Female'), opt('nonbinary', 'Non-binary or another gender'), opt('na', 'Prefer not to say')] }),
    t('Demographics', { id: 'postal', type: 'text', text: 'What is your postal or ZIP code?', validation: { format: 'postal', maxLength: 10 } }),
    t('Financial', { id: 'income', type: 'dropdown', text: `What is your total yearly household income before tax (${currency})?`, options: [...bands.map((b, i) => opt(`b${i + 1}`, b)), opt('na', 'Prefer not to say')] }),
    t('Financial', {
      id: 'employment',
      type: 'single',
      text: 'Which best describes your current employment?',
      options: [opt('full_time', 'Employed full-time'), opt('part_time', 'Employed part-time'), opt('self_employed', 'Self-employed or business owner'), opt('unemployed', 'Not working, looking for work'), opt('student', 'Student'), opt('homemaker', 'Homemaker'), opt('retired', 'Retired'), opt('other', 'Other')],
    }),
    t('Education', {
      id: 'education',
      type: 'single',
      text: 'What is the highest level of education you have completed?',
      options: [opt('primary', 'Primary school or less'), opt('secondary', 'Secondary or high school'), opt('vocational', 'Vocational or technical training'), opt('some_college', 'Some college or university, no degree'), opt('bachelor', "Bachelor's degree"), opt('master', "Master's degree"), opt('doctorate', 'Doctorate or professional degree')],
    }),
  ];
}
