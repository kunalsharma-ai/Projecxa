import { AlertSettings, Pace } from './monitor.rules';

/**
 * Quota reallocation suggestions: which vendor links will not deliver their remaining completes,
 * and which links have room to take them. Pure, so it can be tested without a database.
 */

export interface LinkInput {
  id: string;
  vendor: { id: string; name: string; code: string };
  status: 'ACTIVE' | 'PAUSED' | 'CLOSED';
  target: number;
  completes: number;
  cpi: number;
  pace: Pace;
  entries24h: number;
  qualityShare24h: number | null;
}
export interface MarketInput {
  target: number;
  completes: number;
  daysLeft: number | null;
  links: LinkInput[];
}

export type DonorReason = 'paused' | 'closed' | 'quality' | 'stalled' | 'behind' | 'unassigned';
export interface Move {
  /** null = completes in the market target that no vendor link has. */
  from: string | null;
  to: string;
  completes: number;
  reason: DonorReason;
  /** Why the receiving link was picked, in words. */
  because: string;
  /** Payout difference per complete (receiver CPI minus giver CPI; giver 0 when unassigned). */
  cpiDelta: number;
}
export interface Suggestion {
  moves: Move[];
  /** Completes still at risk after the moves: needs another vendor or a later field end date. */
  uncovered: number;
  donors: { id: string | null; give: number; reason: DonorReason; detail: string }[];
  receivers: { id: string; room: number; detail: string }[];
}

/** Without a field end date, a healthy link is assumed able to take about this many days of its current pace. */
export const NO_DEADLINE_DAYS = 3;

const qualityBad = (l: LinkInput, s: AlertSettings) => l.entries24h >= Math.min(s.minSample, 10) && (l.qualityShare24h ?? 0) >= s.qualityPct;

export function suggest(m: MarketInput, s: AlertSettings): Suggestion {
  const marketLeft = Math.max(0, m.target - m.completes);
  const horizon = m.daysLeft != null && m.daysLeft > 0 ? m.daysLeft : null;
  const donors: Suggestion['donors'] = [];
  const receivers: (Suggestion['receivers'][number] & { link: LinkInput })[] = [];
  if (marketLeft === 0) return { moves: [], uncovered: 0, donors, receivers: [] };

  for (const l of m.links) {
    const left = Math.max(0, l.target - l.completes);
    if (l.status !== 'ACTIVE') {
      if (left) donors.push({ id: l.id, give: left, reason: l.status === 'PAUSED' ? 'paused' : 'closed', detail: `${l.status === 'PAUSED' ? 'Paused' : 'Closed'} with ${left} completes still to deliver` });
      continue;
    }
    if (qualityBad(l, s)) {
      if (left) donors.push({ id: l.id, give: left, reason: 'quality', detail: `${l.qualityShare24h}% of its last-24h entries were rejected for quality` });
      continue;
    }
    if (l.pace.status === 'stalled') {
      if (left) donors.push({ id: l.id, give: left, reason: 'stalled', detail: `No entries for over ${s.stalledHours} hours` });
      continue;
    }
    if (horizon != null) {
      const expected = Math.floor(l.pace.perDay * horizon);
      if (left > expected) {
        // A link that has not started yet keeps its share: it may simply not have launched.
        if (l.pace.status !== 'not_started') donors.push({ id: l.id, give: left - expected, reason: 'behind', detail: `On pace for ${expected} of its ${left} remaining by the field end date (${l.pace.perDay}/day)` });
      } else if (expected > left) {
        receivers.push({ id: l.id, room: expected - left, detail: `${l.pace.perDay}/day can deliver ${expected - left} more by the field end date`, link: l });
      }
    } else if (l.pace.perDay > 0) {
      const room = Math.ceil(l.pace.perDay * NO_DEADLINE_DAYS);
      receivers.push({ id: l.id, room, detail: `${l.pace.perDay}/day, about ${NO_DEADLINE_DAYS} days of its pace`, link: l });
    }
  }

  // Market target that is not given to any link.
  const assigned = m.links.reduce((t, l) => t + Math.max(l.target, l.completes), 0);
  const unassigned = Math.max(0, m.target - assigned);
  if (unassigned) donors.push({ id: null, give: unassigned, reason: 'unassigned', detail: `${unassigned} completes of the market target are not given to any vendor link` });

  // Link targets can add up to more than the market needs: only free what the market is actually short.
  const willDeliver = m.links.reduce((t, l) => {
    const left = Math.max(0, l.target - l.completes);
    const donor = donors.find((d) => d.id === l.id);
    return t + (donor ? left - donor.give : l.status === 'ACTIVE' ? left : 0);
  }, 0);
  let short = Math.max(0, marketLeft - willDeliver);
  for (const d of donors.sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : b.give - a.give))) {
    d.give = Math.min(d.give, short);
    short -= d.give;
  }
  for (let i = donors.length - 1; i >= 0; i--) if (!donors[i].give) donors.splice(i, 1);

  // Best receivers first: cleanest quality, then fastest, then cheapest.
  receivers.sort((a, b) => (a.link.qualityShare24h ?? 0) - (b.link.qualityShare24h ?? 0) || b.link.pace.perDay - a.link.pace.perDay || a.link.cpi - b.link.cpi);
  donors.sort((a, b) => b.give - a.give);

  const room = new Map(receivers.map((r) => [r.id, r.room]));
  const cpi = new Map(m.links.map((l) => [l.id, l.cpi]));
  const moves: Move[] = [];
  let uncovered = 0;
  for (const d of donors) {
    let left = d.give;
    for (const r of receivers) {
      if (!left) break;
      if (r.id === d.id) continue;
      const n = Math.min(left, room.get(r.id) ?? 0);
      if (!n) continue;
      room.set(r.id, (room.get(r.id) ?? 0) - n);
      left -= n;
      moves.push({ from: d.id, to: r.id, completes: n, reason: d.reason, because: r.detail, cpiDelta: Math.round(((cpi.get(r.id) ?? 0) - (d.id ? cpi.get(d.id) ?? 0 : 0)) * 100) / 100 });
    }
    uncovered += left;
  }
  // Never suggest moving more than the market still needs.
  return { moves, uncovered, donors, receivers: receivers.map(({ link: _l, ...r }) => r) };
}
