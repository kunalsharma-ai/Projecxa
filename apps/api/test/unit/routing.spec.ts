import { DEFAULT_ALERT_SETTINGS, DEFAULT_AUTO_ROUTE, AutoRoute, Pace } from '../../src/monitor/monitor.rules';
import { LinkInput } from '../../src/monitor/reallocation';
import { planKey, planRoute, UNSCORED_AS, VendorScoreInput } from '../../src/monitor/routing';

const pace = (perDay: number, status: Pace['status'] = 'on_track'): Pace => ({ status, perDay, requiredPerDay: null, remaining: 0, etaDays: null, daysLeft: null });
const link = (id: string, o: Partial<LinkInput>): LinkInput => ({ id, vendor: { id: `v-${id}`, name: id.toUpperCase(), code: id }, status: 'ACTIVE', target: 100, completes: 0, cpi: 2, pace: pace(10), entries24h: 30, qualityShare24h: 0, ...o });
const s = DEFAULT_ALERT_SETTINGS;
const cfg = (o: Partial<AutoRoute> = {}): AutoRoute => ({ ...DEFAULT_AUTO_ROUTE, maxMovePercent: 100, ...o });
const scores = (o: Record<string, number | null>) => new Map<string, VendorScoreInput>(Object.entries(o).map(([id, score]) => [`v-${id}`, { score, grade: score == null ? null : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D', source: score == null ? 'none' : 'overall' }]));

// A paused link frees 90; two healthy links each have room (no end date: 3 days of pace).
const market = (links: LinkInput[], target = links.length * 100) => ({ target, completes: links.reduce((t, l) => t + l.completes, 0), daysLeft: null, clientCpi: 5, links });

describe('vendor auto-routing', () => {
  it('sends freed completes to the best vendor first, by score, margin and room', () => {
    const p = planRoute(
      market([link('paused', { status: 'PAUSED', completes: 10 }), link('good', { completes: 10, pace: pace(20), cpi: 2 }), link('cheapbad', { completes: 10, pace: pace(20), cpi: 1 })]),
      scores({ good: 90, cheapbad: 60, paused: 80 }),
      cfg(),
      s,
    );
    // good: 50*90 + 30*60 + 20*100 = 83; cheapbad: 50*60 + 30*80 + 20*100 = 74
    expect(p.ranking.map((x) => [x.name, x.routingScore, x.parts])).toEqual([
      ['GOOD', 83, { score: 90, cost: 60, room: 100 }],
      ['CHEAPBAD', 74, { score: 60, cost: 80, room: 100 }],
    ]);
    expect(p.moves).toEqual([
      expect.objectContaining({ from: 'paused', to: 'good', completes: 60, reason: 'paused', cpiDelta: 0 }),
      expect.objectContaining({ from: 'paused', to: 'cheapbad', completes: 30, cpiDelta: -1 }),
    ]);
    expect(p.moves[0].because).toContain('Rank 1 of 2, routing score 83: score 90 (A), 60% margin at CPI 2.00, room for 60');
    expect(p.costDelta).toBe(-30);
    expect(p.summary).toBe('Route 90 completes: 60 to GOOD, 30 to CHEAPBAD');
  });

  it('weights change the winner: cost-only routing picks the cheapest link', () => {
    const p = planRoute(
      market([link('paused', { status: 'PAUSED', completes: 10 }), link('good', { completes: 10, pace: pace(20), cpi: 2 }), link('cheapbad', { completes: 10, pace: pace(20), cpi: 1 })]),
      scores({ good: 90, cheapbad: 60 }),
      cfg({ weights: { score: 0, cost: 100, room: 0 } }),
      s,
    );
    expect(p.ranking[0].name).toBe('CHEAPBAD');
    expect(p.moves[0]).toMatchObject({ to: 'cheapbad', completes: 60 });
  });

  it('never routes to a vendor under the minimum score or one that would lose money, and says why', () => {
    const p = planRoute(
      market([link('paused', { status: 'PAUSED', completes: 10 }), link('weak', { pace: pace(20) }), link('dear', { pace: pace(20), cpi: 5.5 }), link('fresh', { pace: pace(5) })]),
      scores({ weak: 40, dear: 95, fresh: null }),
      cfg(),
      s,
    );
    expect(p.skipped).toEqual([
      { id: 'weak', name: 'WEAK', why: 'Vendor score 40 is under the minimum of 55' },
      { id: 'dear', name: 'DEAR', why: expect.stringContaining('CPI 5.50 is at or above the client CPI 5.00') },
    ]);
    // fresh has no score yet: ranked as UNSCORED_AS, still eligible; room = 15.
    expect(p.ranking).toEqual([expect.objectContaining({ name: 'FRESH', vendorScore: null, parts: expect.objectContaining({ score: UNSCORED_AS }), gets: 15 })]);
    expect(p.ranking[0].because).toContain(`no score yet (counted as ${UNSCORED_AS})`);
    expect(p.uncovered).toBe(75);
    // keepMargin off lets the dear link take completes.
    const off = planRoute(market([link('paused', { status: 'PAUSED', completes: 10 }), link('dear', { pace: pace(20), cpi: 5.5 })]), scores({ dear: 95 }), cfg({ keepMargin: false }), s);
    expect(off.moves[0]).toMatchObject({ to: 'dear', completes: 60, cpiDelta: 3.5 });
  });

  it('caps each run at a share of what the market still needs and holds the rest', () => {
    const p = planRoute(market([link('paused', { status: 'PAUSED', completes: 10 }), link('good', { completes: 10, pace: pace(40) })]), scores({ good: 90 }), cfg({ maxMovePercent: 10 }), s);
    // market needs 180 -> cap 18; good has room 120.
    expect(p).toMatchObject({ freed: 90, cap: 18, held: 72, uncovered: 0 });
    expect(p.moves).toEqual([expect.objectContaining({ from: 'paused', to: 'good', completes: 18 })]);
    expect(p.summary).toBe('Route 18 completes: 18 to GOOD; 72 held for a later run');
  });

  it('does nothing when every link is on course', () => {
    const p = planRoute({ target: 100, completes: 0, daysLeft: null, clientCpi: 5, links: [link('a', { target: 50 }), link('b', { target: 50 })] }, scores({}), cfg(), s);
    expect(p).toMatchObject({ moves: [], freed: 0, summary: 'Every link is on course; nothing to route' });
    expect(planKey(p.moves)).toBe('');
    expect(planKey([{ from: null, to: 'x', completes: 3 }, { from: 'a', to: 'x', completes: 2 }])).toBe('->x=3,a>x=2');
  });
});
