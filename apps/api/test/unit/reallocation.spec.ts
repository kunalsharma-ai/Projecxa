import { DEFAULT_ALERT_SETTINGS, Pace } from '../../src/monitor/monitor.rules';
import { LinkInput, suggest } from '../../src/monitor/reallocation';

const pace = (perDay: number, status: Pace['status'] = 'on_track'): Pace => ({ status, perDay, requiredPerDay: null, remaining: 0, etaDays: null, daysLeft: null });
const link = (id: string, o: Partial<LinkInput>): LinkInput => ({ id, vendor: { id: `v-${id}`, name: id.toUpperCase(), code: id }, status: 'ACTIVE', target: 100, completes: 0, cpi: 3, pace: pace(10), entries24h: 30, qualityShare24h: 0, ...o });
const s = DEFAULT_ALERT_SETTINGS;

describe('reallocation suggestions', () => {
  it('moves what a slow link will not deliver to a link with room, by the field end date', () => {
    const r = suggest({ target: 200, completes: 40, daysLeft: 4, links: [link('slow', { completes: 20, pace: pace(5, 'behind') }), link('fast', { completes: 20, pace: pace(40) })] }, s);
    // slow: 80 left, on pace for 20 -> gives 60. fast: 80 left, can do 160 -> room 80.
    expect(r.moves).toEqual([{ from: 'slow', to: 'fast', completes: 60, reason: 'behind', because: expect.stringContaining('40/day'), cpiDelta: 0 }]);
    expect(r.uncovered).toBe(0);
  });

  it('frees everything left on paused, closed, stalled and low-quality links, and reports what nobody can take', () => {
    const r = suggest(
      {
        target: 400, completes: 40, daysLeft: 2,
        links: [
          link('paused', { status: 'PAUSED', completes: 10 }),
          link('stalled', { completes: 10, pace: pace(0, 'stalled') }),
          link('dirty', { completes: 10, qualityShare24h: 40 }),
          link('good', { completes: 10, pace: pace(50), cpi: 4.5 }),
        ],
      },
      s,
    );
    expect(r.donors.map((d) => [d.id, d.reason, d.give])).toEqual([['paused', 'paused', 90], ['stalled', 'stalled', 90], ['dirty', 'quality', 90]]);
    // good: 90 left, 100 by the end date -> room 10
    expect(r.moves).toEqual([expect.objectContaining({ from: 'paused', to: 'good', completes: 10, cpiDelta: 1.5 })]);
    expect(r.uncovered).toBe(260);
  });

  it('offers the unassigned part of the market target, and prefers clean, fast, cheap receivers', () => {
    const r = suggest({ target: 100, completes: 0, daysLeft: null, links: [link('a', { target: 30, pace: pace(5), cpi: 2, qualityShare24h: 5 }), link('b', { target: 30, pace: pace(5), cpi: 2 }), link('c', { target: 30, pace: pace(5), cpi: 1 })] }, s);
    // No end date: room = 3 days of pace = 15 each; unassigned 10 goes to the cleanest then cheapest.
    expect(r.moves).toEqual([expect.objectContaining({ from: null, to: 'c', completes: 10, reason: 'unassigned', cpiDelta: 1 })]);
  });

  it('suggests nothing for a finished market or a link that has not started', () => {
    expect(suggest({ target: 10, completes: 10, daysLeft: 1, links: [link('a', { status: 'PAUSED' })] }, s).moves).toEqual([]);
    const r = suggest({ target: 100, completes: 0, daysLeft: 5, links: [link('new', { target: 50, pace: pace(0, 'not_started') }), link('b', { target: 50, pace: pace(20) })] }, s);
    expect(r.donors).toEqual([]);
  });

  it('ignores a quality share on too few entries', () => {
    const r = suggest({ target: 100, completes: 0, daysLeft: 5, links: [link('a', { target: 50, qualityShare24h: 50, entries24h: 4, pace: pace(10) }), link('b', { target: 50, pace: pace(10) })] }, s);
    expect(r.donors).toEqual([]);
  });
});

describe('reallocation caps', () => {
  it('never frees more than the market is short when link targets add up to more than the market target', () => {
    // Market needs 12 more; links have 37 left between them, the slow one on pace for 2 of 25.
    const r = suggest({ target: 30, completes: 18, daysLeft: 4, links: [link('a', { target: 30, completes: 18, pace: pace(5) }), link('b', { target: 25, completes: 0, pace: pace(0.5, 'behind') })] }, s);
    // a delivers its 12 left (room 8 more); b would deliver 2; the market is not short at all.
    expect(r.moves).toEqual([]);
    expect(r.uncovered).toBe(0);
  });
});
