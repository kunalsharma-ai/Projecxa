import { z } from 'zod';

const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const periodSchema = z
  .object({ from: dayStr.optional(), to: dayStr.optional() })
  .refine((p) => !p.from || !p.to || p.from <= p.to, { message: '`from` must be on or before `to`', path: ['from'] })
  .refine((p) => !p.from || !p.to || (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000 <= 731, { message: 'Pick at most two years', path: ['to'] });
export const seriesSchema = z.object({ interval: z.enum(['day', 'week', 'month']).default('day') });
export const DAY = 86_400_000;
export const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The requested period (default: the last 30 UTC days) and the period of the same length just before it. */
export function periods(p: z.infer<typeof periodSchema>) {
  const to = p.to ?? iso(Date.now());
  const from = p.from ?? iso(Date.parse(to) - 29 * DAY);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  return { from, to, days, prevFrom: iso(Date.parse(from) - days * DAY), prevTo: iso(Date.parse(from) - DAY) };
}

