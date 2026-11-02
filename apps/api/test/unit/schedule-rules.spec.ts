import { describe as label, nextRunAt, periodRange, scheduleSchema, zonedTime } from '../../src/schedules/schedule.rules';

describe('scheduled report rules', () => {
  it('converts local hours to UTC, including half-hour and DST zones', () => {
    expect(zonedTime(2026, 11, 2, 9, 'Asia/Kolkata').toISOString()).toBe('2026-11-02T03:30:00.000Z');
    expect(zonedTime(2026, 7, 1, 9, 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedTime(2026, 12, 1, 9, 'Europe/London').toISOString()).toBe('2026-12-01T09:00:00.000Z');
    expect(zonedTime(2026, 3, 8, 2, 'America/New_York').toISOString()).toBe('2026-03-08T07:00:00.000Z'); // DST gap → 03:00 EDT
  });

  it('finds the next daily, weekly and monthly send', () => {
    const now = new Date('2026-11-02T04:00:00Z'); // Monday 09:30 in Kolkata
    expect(nextRunAt({ frequency: 'daily', hour: 9, timezone: 'Asia/Kolkata' }, now).toISOString()).toBe('2026-11-03T03:30:00.000Z');
    expect(nextRunAt({ frequency: 'daily', hour: 10, timezone: 'Asia/Kolkata' }, now).toISOString()).toBe('2026-11-02T04:30:00.000Z');
    expect(nextRunAt({ frequency: 'weekly', dayOfWeek: 1, hour: 9, timezone: 'Asia/Kolkata' }, now).toISOString()).toBe('2026-11-09T03:30:00.000Z');
    expect(nextRunAt({ frequency: 'weekly', dayOfWeek: 5, hour: 18, timezone: 'Asia/Kolkata' }, now).toISOString()).toBe('2026-11-06T12:30:00.000Z');
    expect(nextRunAt({ frequency: 'monthly', dayOfMonth: 1, hour: 8, timezone: 'Asia/Kolkata' }, now).toISOString()).toBe('2026-12-01T02:30:00.000Z');
  });

  it('works out the period in the local calendar', () => {
    const now = new Date('2026-11-01T20:00:00Z'); // already 2 Nov in Kolkata
    expect(periodRange('yesterday', 'Asia/Kolkata', now)).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(periodRange('yesterday', 'UTC', now)).toEqual({ from: '2026-10-31', to: '2026-10-31' });
    expect(periodRange('last_7_days', 'Asia/Kolkata', now)).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(periodRange('month_to_date', 'Asia/Kolkata', now)).toEqual({ from: '2026-11-01', to: '2026-11-02' });
    expect(periodRange('last_month', 'Asia/Kolkata', new Date('2026-03-01T06:00:00Z'))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('last_month', 'UTC', new Date('2026-01-15T06:00:00Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('validates input', () => {
    const base = { name: 'Weekly', report: 'client', period: 'last_7_days', frequency: 'weekly', hour: 9, recipients: ['Ops@Example.com'] };
    expect(scheduleSchema.safeParse(base).success).toBe(false); // weekly needs a day
    const ok = scheduleSchema.parse({ ...base, dayOfWeek: 1 });
    expect(ok.recipients).toEqual(['ops@example.com']);
    expect(ok.timezone).toBe('Asia/Kolkata');
    expect(scheduleSchema.safeParse({ ...base, dayOfWeek: 1, timezone: 'Mars/Base' }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...base, dayOfWeek: 1, recipients: ['nope'] }).success).toBe(false);
    expect(label({ frequency: 'weekly', dayOfWeek: 1, hour: 9, timezone: 'Asia/Kolkata' })).toBe('Every Monday at 09:00 (Asia/Kolkata)');
  });
});
