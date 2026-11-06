import { fractionValue, isSpeeder, speederCheckSchema, speederOf, speederThresholdMinutes, toMetrics } from '../../src/projects/field-metrics';
import { autoPauseAt, autoPauseDecision, autoPauseSchema, autoPauseStateOf, autopilotOf, DEFAULT_AUTO_PAUSE } from '../../src/monitor/monitor.rules';

describe('speeder check', () => {
  const t0 = new Date('2026-11-10T12:00:00Z');
  const after = (min: number) => new Date(t0.getTime() + min * 60_000);

  it('accepts fractions below one with a denominator up to 10', () => {
    for (const f of ['1/4', '1/3', '2/4', '2/3', '3/4', '9/10']) expect(speederCheckSchema.safeParse({ enabled: true, fraction: f }).success).toBe(true);
    for (const f of ['4/4', '5/4', '0/3', '1/12', '0.3', '1:3', '']) expect(speederCheckSchema.safeParse({ enabled: true, fraction: f }).success).toBe(false);
  });

  it('falls back to off for missing or bad settings', () => {
    expect(speederOf(null)).toEqual({ enabled: false, fraction: '1/3' });
    expect(speederOf({ enabled: true, fraction: 'abc' }).enabled).toBe(false);
  });

  it('flags completes faster than the share of the planned LOI', () => {
    const c = { enabled: true, fraction: '1/3' };
    expect(fractionValue('2/4')).toBe(0.5);
    expect(speederThresholdMinutes(c, 15)).toBe(5);
    expect(isSpeeder(c, 15, t0, after(4.9))).toBe(true);
    expect(isSpeeder(c, 15, t0, after(5))).toBe(false);
    expect(isSpeeder({ enabled: true, fraction: '3/4' }, 20, t0, after(14))).toBe(true);
  });

  it('never flags when off', () => {
    expect(isSpeeder({ enabled: false, fraction: '3/4' }, 20, t0, after(0.1))).toBe(false);
    expect(speederThresholdMinutes({ enabled: false, fraction: '1/3' }, 15)).toBeNull();
  });
});

describe('LOI and IR', () => {
  it('averages LOI in minutes and computes IR from completes and terminates', () => {
    expect(toMetrics({ completes: 30, terminates: 70, speeders: 4, loiSeconds: 750 })).toEqual({ avgLoiMinutes: 12.5, irPercent: 30, completes: 30, terminates: 70, speeders: 4 });
  });
  it('leaves both empty before any outcome', () => {
    expect(toMetrics({ completes: 0, terminates: 0, speeders: 0, loiSeconds: null })).toMatchObject({ avgLoiMinutes: null, irPercent: null });
  });
});

describe('auto-pause checkpoint', () => {
  const on = (over = {}) => ({ ...DEFAULT_AUTO_PAUSE, enabled: true, ...over });

  it('fires at a share of the target or a number of completes', () => {
    expect(autoPauseAt(on({ by: 'percent', value: 10 }), 100)).toBe(10);
    expect(autoPauseAt(on({ by: 'percent', value: 10 }), 15)).toBe(2);
    expect(autoPauseAt(on({ by: 'completes', value: 25 }), 100)).toBe(25);
    expect(autoPauseAt(on({ by: 'completes', value: 100 }), 100)).toBeNull();
    expect(autoPauseAt(on(), 0)).toBeNull();
  });

  it('pauses once, then never again for the same market', () => {
    const a = on({ value: 10 });
    const st = autoPauseStateOf(null, a);
    expect(autoPauseDecision(a, st, 'm:1', 9, 100, true)).toBeNull();
    expect(autoPauseDecision(a, st, 'm:1', 10, 100, true)).toMatchObject({ action: 'pause', at: 10 });
    st.done['m:1'] = { reason: 'paused', at: '', completes: 10, target: 100 };
    // Resumed by someone: open again, above the checkpoint, but already done.
    expect(autoPauseDecision(a, st, 'm:1', 30, 100, true)).toBeNull();
  });

  it('marks a market done when it reaches the target without pausing', () => {
    const a = on({ by: 'completes', value: 50 });
    expect(autoPauseDecision(a, autoPauseStateOf(null, a), 'm:2', 100, 100, true)).toMatchObject({ action: 'target' });
  });

  it('does nothing when off or when the market is already paused', () => {
    expect(autoPauseDecision(DEFAULT_AUTO_PAUSE, autoPauseStateOf(null, DEFAULT_AUTO_PAUSE), 'm:1', 50, 100, true)).toBeNull();
    const a = on();
    expect(autoPauseDecision(a, autoPauseStateOf(null, a), 'm:1', 50, 100, false)).toBeNull();
  });

  it('starts afresh when the checkpoint changes', () => {
    const a = on({ value: 10 });
    const saved = { autoPause: { config: 'percent:10:market', done: { 'm:1': { reason: 'paused', at: '', completes: 10, target: 100 } } } };
    expect(Object.keys(autoPauseStateOf(saved, a).done)).toEqual(['m:1']);
    expect(autoPauseStateOf(saved, on({ value: 50 })).done).toEqual({});
  });

  it('validates settings and keeps old autopilot settings working', () => {
    expect(autoPauseSchema.safeParse({ enabled: true, by: 'percent', value: 100, scope: 'market' }).success).toBe(false);
    expect(autoPauseSchema.safeParse({ enabled: true, by: 'completes', value: 500, scope: 'vendor' }).success).toBe(true);
    expect(autopilotOf({ pauseOnQuality: true, closeOnTarget: false })).toMatchObject({ pauseOnQuality: true, autoPause: DEFAULT_AUTO_PAUSE });
  });
});
