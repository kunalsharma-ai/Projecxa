import { ForecastMarketIn, forecastMarket, forecastProject, marginFloorOf, marginRules, remainingCostPerComplete } from '../../src/monitor/forecast';
import { autopilotOf, DEFAULT_ALERT_SETTINGS, Pace } from '../../src/monitor/monitor.rules';

const now = new Date('2026-11-10T12:00:00Z');
const DAY = 86_400_000;
const pace = (over: Partial<Pace> = {}): Pace => ({ status: 'no_deadline', perDay: 10, requiredPerDay: null, remaining: 60, etaDays: 6, daysLeft: null, ...over });
const market = (over: Partial<ForecastMarketIn> = {}): ForecastMarketIn => ({
  id: 'c1', countryCode: 'US', status: 'LIVE', currency: 'USD', cpi: 5, target: 100, completes: 40, revenue: 200, cost: 80, pace: pace(),
  vendors: [
    { cpi: 2, target: 60, completes: 30, status: 'ACTIVE', perDay: 8 },
    { cpi: 4, target: 40, completes: 10, status: 'ACTIVE', perDay: 2 },
  ],
  ...over,
});
const opts = { now, fieldEndAt: null, marginFloorPct: 20, marginDropPts: 10 };

describe('remaining cost per complete', () => {
  it('weights the open vendor links by their pace', () => {
    expect(remainingCostPerComplete(market())).toEqual({ cpc: 2.4, basis: 'vendor_pace' }); // (2×8 + 4×2) / 10
  });
  it('falls back to what each open link still has to deliver', () => {
    const m = market({ vendors: [{ cpi: 2, target: 60, completes: 30, status: 'ACTIVE', perDay: 0 }, { cpi: 5, target: 40, completes: 10, status: 'ACTIVE', perDay: 0 }] });
    expect(remainingCostPerComplete(m)).toEqual({ cpc: 3.5, basis: 'vendor_capacity' }); // (2×30 + 5×30) / 60
  });
  it('leaves out paused and full links, then uses the average payout so far, then the plan', () => {
    const closed = [{ cpi: 9, target: 10, completes: 10, status: 'ACTIVE', perDay: 5 }, { cpi: 9, target: 50, completes: 1, status: 'PAUSED', perDay: 5 }];
    expect(remainingCostPerComplete(market({ vendors: closed }))).toEqual({ cpc: 2, basis: 'actual' }); // 80 / 40
    expect(remainingCostPerComplete(market({ vendors: closed, completes: 0, cost: 0 }))).toEqual({ cpc: 9, basis: 'planned' });
    expect(remainingCostPerComplete(market({ vendors: [], completes: 0, cost: 0 }))).toEqual({ cpc: null, basis: 'none' });
  });
});

describe('market forecast', () => {
  it('adds the remaining completes to the money so far', () => {
    const f = forecastMarket(market(), now);
    expect(f).toMatchObject({ remaining: 60, revenue: 500, cost: 224, profit: 276, marginPct: 55.2, costBasis: 'vendor_pace' }); // 80 + 60 × 2.4
    expect(f.finishAt).toEqual(new Date(now.getTime() + 6 * DAY));
  });
  it('has no finish date without pace and finishes now when done', () => {
    expect(forecastMarket(market({ pace: pace({ perDay: 0, etaDays: null }) }), now).finishAt).toBeNull();
    expect(forecastMarket(market({ completes: 100, revenue: 500, cost: 250 }), now)).toMatchObject({ remaining: 0, finishAt: now, cost: 250, costBasis: 'done' });
  });
});

describe('project forecast', () => {
  it('finishes with the slowest market and reports days late', () => {
    const f = forecastProject([market(), market({ id: 'c2', countryCode: 'GB', pace: pace({ etaDays: 12 }) })], { ...opts, fieldEndAt: new Date(now.getTime() + 10 * DAY) });
    expect(f.finishAt).toEqual(new Date(now.getTime() + 12 * DAY));
    expect(f.daysLate).toBe(2);
    expect(f.unknownMarkets).toEqual([]);
    expect(f.confidence).toBe('high');
  });
  it('has no finish date when an open market has no pace', () => {
    const f = forecastProject([market(), market({ id: 'c2', countryCode: 'DE', pace: pace({ perDay: 0, etaDays: null }) })], opts);
    expect(f.finishAt).toBeNull();
    expect(f.unknownMarkets).toEqual(['DE']);
    expect(f.confidence).toBe('low');
  });
  it('totals money per currency with the planned margin beside it', () => {
    const f = forecastProject([market(), market({ id: 'c2', countryCode: 'GB', currency: 'GBP', cpi: 4, completes: 0, revenue: 0, cost: 0 })], opts);
    expect(f.currencies.map((c) => c.currency)).toEqual(['USD', 'GBP']);
    const usd = f.currencies[0];
    expect(usd).toMatchObject({ revenue: 200, cost: 80, profit: 120, marginPct: 60, plannedRevenue: 500, plannedCost: 300, plannedMarginPct: 40, forecastRevenue: 500, forecastCost: 224, forecastProfit: 276, forecastMarginPct: 55.2 });
  });
});

describe('margin alert', () => {
  const costly = market({ cost: 160, vendors: [{ cpi: 4.5, target: 100, completes: 40, status: 'ACTIVE', perDay: 10 }] }); // 160 + 60 × 4.5 = 430 of 500 → 14%
  it('fires under the floor and is bad when the project loses money', () => {
    const [c] = marginRules('p:1', 'PRX1', forecastProject([costly], opts));
    expect(c).toMatchObject({ rule: 'margin_low', severity: 'warn', dedupeKey: 'p:1:USD:margin_low' });
    expect(c.title).toBe('PRX1 margin is heading for 14% (floor 20%)');
    const losing = market({ cost: 240, vendors: [{ cpi: 6, target: 100, completes: 40, status: 'ACTIVE', perDay: 10 }] });
    expect(marginRules('p:1', 'PRX1', forecastProject([losing], opts))[0].severity).toBe('bad');
  });
  it('fires when the margin falls well under the plan even above the floor', () => {
    // Planned: vendor average 2.5 × 100 = 250 of 500 → 50%. Forecast: the cheap link is paused, so 120 + 60 × 3 = 300 → 40%.
    const m = market({ cost: 120, vendors: [{ cpi: 2, target: 50, completes: 0, status: 'PAUSED', perDay: 0 }, { cpi: 3, target: 100, completes: 40, status: 'ACTIVE', perDay: 10 }] });
    const f = forecastProject([m], opts);
    expect(f.currencies[0].plannedMarginPct).toBe(50);
    expect(f.currencies[0].forecastMarginPct).toBe(40);
    expect(marginRules('p:1', 'PRX1', f)[0].title).toBe('PRX1 margin is heading for 40% (planned 50%)');
    expect(marginRules('p:1', 'PRX1', { ...f, marginDropPts: 20 })).toEqual([]);
  });
  it('waits for enough completes and is quiet for a healthy margin', () => {
    expect(marginRules('p:1', 'PRX1', forecastProject([{ ...costly, completes: 4 }], opts))).toEqual([]);
    expect(marginRules('p:1', 'PRX1', forecastProject([market()], opts))).toEqual([]);
  });
  it('uses the project floor before the organisation default', () => {
    expect(marginFloorOf(DEFAULT_ALERT_SETTINGS, null)).toBe(20);
    expect(marginFloorOf(DEFAULT_ALERT_SETTINGS, 35)).toBe(35);
    expect(autopilotOf({ marginFloorPct: 35 }).marginFloorPct).toBe(35);
    expect(DEFAULT_ALERT_SETTINGS).toMatchObject({ marginFloorPct: 20, marginDropPts: 10 });
  });
});
