import { allocationRules, DEFAULT_ALERT_SETTINGS as S, marketRules, Metrics, pace } from '../../src/monitor/monitor.rules';

const now = new Date('2026-11-10T12:00:00Z');
const h = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const m = (over: Partial<Metrics> = {}): Metrics => ({
  target: 100, completes: 40, terminates: 60, entries24h: 50, quality24h: 0, dropped24h: 0, completes72h: 30,
  firstEntryAt: h(24 * 10), lastEntryAt: h(1), medianLoiMinutes: 14, ...over,
});
const plan = { irPercent: 40, loiMinutes: 15 };
const rules = (x: Metrics, end: Date | null = null, live = true) => marketRules('k', 'PRX1 US', x, pace(x, end, now, S.stalledHours), plan, S, live, now).map((c) => c.rule);

describe('pace', () => {
  it('uses the last three days of completes', () => {
    expect(pace(m(), null, now, 24)).toMatchObject({ status: 'no_deadline', perDay: 10, remaining: 60, etaDays: 6, requiredPerDay: null });
  });
  it('uses the real age when fieldwork started less than three days ago', () => {
    expect(pace(m({ firstEntryAt: h(12), completes72h: 10 }), null, now, 24).perDay).toBe(20);
  });
  it('compares with the rate needed by the end date', () => {
    expect(pace(m(), new Date(now.getTime() + 10 * 86_400_000), now, 24)).toMatchObject({ status: 'on_track', requiredPerDay: 6 });
    expect(pace(m(), new Date(now.getTime() + 5.5 * 86_400_000), now, 24).status).toBe('slightly_behind');
    expect(pace(m(), new Date(now.getTime() + 3 * 86_400_000), now, 24)).toMatchObject({ status: 'behind', requiredPerDay: 20 });
    expect(pace(m(), new Date(now.getTime() - 86_400_000), now, 24).status).toBe('overdue');
  });
  it('knows done, stalled and not started', () => {
    expect(pace(m({ completes: 100 }), null, now, 24)).toMatchObject({ status: 'done', etaDays: 0 });
    expect(pace(m({ lastEntryAt: h(30) }), null, now, 24).status).toBe('stalled');
    expect(pace(m({ firstEntryAt: null, lastEntryAt: null, completes: 0, completes72h: 0 }), null, now, 24)).toMatchObject({ status: 'not_started', perDay: 0, etaDays: null });
  });
});

describe('market rules', () => {
  it('is quiet when fieldwork is healthy', () => {
    expect(rules(m())).toEqual([]);
  });
  it('flags stalled and behind-pace markets only while live', () => {
    expect(rules(m({ lastEntryAt: h(30) }))).toContain('stalled');
    expect(rules(m({ lastEntryAt: h(30) }), null, false)).not.toContain('stalled');
    expect(rules(m(), new Date(now.getTime() + 3 * 86_400_000))).toEqual(['behind_pace']);
  });
  it('flags low incidence once enough respondents decided', () => {
    expect(rules(m({ completes: 20, terminates: 80 }))).toContain('low_ir'); // 20% vs 40% planned
    expect(rules(m({ completes: 3, terminates: 12 }))).not.toContain('low_ir'); // too few
  });
  it('flags speeders and long interviews', () => {
    expect(rules(m({ medianLoiMinutes: 4 }))).toContain('loi_short');
    expect(rules(m({ medianLoiMinutes: 30 }))).toContain('loi_long');
    expect(rules(m({ completes: 5, terminates: 5, medianLoiMinutes: 4 }))).not.toContain('loi_short');
  });
  it('reports quota near and reached', () => {
    expect(rules(m({ completes: 92 }))).toContain('quota_near');
    expect(rules(m({ completes: 100 }))).toEqual(['target_reached']);
  });
});

describe('vendor link rules', () => {
  it('flags quality spikes and drop-outs with enough entries', () => {
    expect(allocationRules('a', 'X', m({ entries24h: 40, quality24h: 12 }), S).map((c) => c.rule)).toEqual(['quality_spike']);
    expect(allocationRules('a', 'X', m({ entries24h: 40, dropped24h: 14 }), S).map((c) => c.rule)).toEqual(['drop_off']);
    expect(allocationRules('a', 'X', m({ entries24h: 10, quality24h: 9 }), S)).toEqual([]);
  });
});
