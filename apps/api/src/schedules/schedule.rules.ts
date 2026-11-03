/**
 * Pure rules for scheduled reports: when the next email goes out and which days it covers.
 * Times are the schedule's local time in an IANA timezone (default Asia/Kolkata).
 */
import { z } from 'zod';

export const REPORTS = { overall: 'Overall summary', client: 'By client', vendor: 'By vendor', project: 'By project', country: 'By country', day: 'By day' } as const;
export const PERIODS = { yesterday: 'Yesterday', last_7_days: 'Last 7 days', last_30_days: 'Last 30 days', month_to_date: 'This month so far', last_month: 'Last month' } as const;
export const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type ReportKind = keyof typeof REPORTS;
export type Period = keyof typeof PERIODS;
export type Frequency = (typeof FREQUENCIES)[number];

export function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const id = z.string().min(1).max(64);
export const scheduleSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the schedule a name').max(120),
    report: z.enum(Object.keys(REPORTS) as [ReportKind, ...ReportKind[]]),
    period: z.enum(Object.keys(PERIODS) as [Period, ...Period[]]),
    filters: z.object({ clientId: id.optional(), vendorId: id.optional(), projectId: id.optional() }).strict().default({}),
    frequency: z.enum(FREQUENCIES),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
    hour: z.number().int().min(0).max(23),
    timezone: z.string().max(64).refine(isTimezone, 'Unknown timezone').default('Asia/Kolkata'),
    recipients: z.array(z.string().trim().toLowerCase().email('Not a valid email address')).min(1, 'Add at least one recipient').max(20, 'Up to 20 recipients'),
    skipEmpty: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .refine((s) => s.frequency !== 'weekly' || s.dayOfWeek != null, { message: 'Pick a day of the week', path: ['dayOfWeek'] })
  .refine((s) => s.frequency !== 'monthly' || s.dayOfMonth != null, { message: 'Pick a day of the month (1 to 28)', path: ['dayOfMonth'] });
export type ScheduleInput = z.infer<typeof scheduleSchema>;

interface Local { y: number; m: number; d: number; h: number; min: number }

/** Wall-clock parts of an instant in a timezone. */
export function localParts(t: Date, tz: string): Local {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(t)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  );
  return { y: parts.year, m: parts.month, d: parts.day, h: parts.hour, min: parts.minute };
}

function offsetMs(t: number, tz: string) {
  const p = localParts(new Date(t), tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(t / 60_000) * 60_000;
}

/** The instant when it is y-m-d h:00 in `tz`. In a DST gap, the next valid hour. */
export function zonedTime(y: number, m: number, d: number, h: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h);
  const a = guess - offsetMs(guess, tz);
  const b = guess - offsetMs(a, tz);
  // Whichever candidate really shows h:00 locally; in a DST gap neither does, so take the later one.
  for (const t of [b, a]) if (localParts(new Date(t), tz).h === h) return new Date(t);
  return new Date(Math.max(a, b));
}

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The first send time strictly after `after`. */
export function nextRunAt(s: { frequency: string; dayOfWeek?: number | null; dayOfMonth?: number | null; hour: number; timezone: string }, after: Date): Date {
  const start = localParts(after, s.timezone);
  const base = Date.UTC(start.y, start.m - 1, start.d);
  for (let i = 0; i < 400; i++) {
    const day = new Date(base + i * 86_400_000);
    const ok = s.frequency === 'daily' || (s.frequency === 'weekly' && day.getUTCDay() === s.dayOfWeek) || (s.frequency === 'monthly' && day.getUTCDate() === s.dayOfMonth);
    if (!ok) continue;
    const t = zonedTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), s.hour, s.timezone);
    if (t.getTime() > after.getTime()) return t;
  }
  throw new Error('No next run found');
}

/** The days a report covers when sent at `now`, as inclusive YYYY-MM-DD dates in the schedule's timezone. */
export function periodRange(period: Period, tz: string, now: Date): { from: string; to: string } {
  const p = localParts(now, tz);
  const today = Date.UTC(p.y, p.m - 1, p.d);
  const day = 86_400_000;
  switch (period) {
    case 'yesterday':
      return { from: ymd(today - day), to: ymd(today - day) };
    case 'last_7_days':
      return { from: ymd(today - 7 * day), to: ymd(today - day) };
    case 'last_30_days':
      return { from: ymd(today - 30 * day), to: ymd(today - day) };
    case 'month_to_date':
      return { from: ymd(Date.UTC(p.y, p.m - 1, 1)), to: ymd(today) };
    case 'last_month':
      return { from: ymd(Date.UTC(p.y, p.m - 2, 1)), to: ymd(Date.UTC(p.y, p.m - 1, 0)) };
  }
}

/** "Every Monday at 09:00 (Asia/Kolkata)" */
export function describe(s: { frequency: string; dayOfWeek?: number | null; dayOfMonth?: number | null; hour: number; timezone: string }): string {
  const at = `${String(s.hour).padStart(2, '0')}:00 (${s.timezone})`;
  if (s.frequency === 'weekly') return `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][s.dayOfWeek ?? 1]} at ${at}`;
  if (s.frequency === 'monthly') return `Monthly on day ${s.dayOfMonth} at ${at}`;
  return `Every day at ${at}`;
}
