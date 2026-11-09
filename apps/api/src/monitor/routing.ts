import { AlertSettings, AutoRoute } from './monitor.rules';
import { DonorReason, MarketInput, suggest } from './reallocation';

/**
 * Vendor auto-routing (docs/VENDOR_AUTO_ROUTING.md). Builds on the reallocation suggestions: they
 * say which completes a market will not get from its current links (the donors) and which live
 * links have room. Routing then ranks the links with room by a routing score made of three parts,
 * drops the ones that must never receive, caps how much moves in one run, and gives the completes
 * to the best link first. Pure, so every rule is unit-testable; every number it uses is returned so
 * the screen can explain the plan.
 */

/** Vendors without a score yet (fewer than MIN_CLICKS clicks) are ranked as if they scored this. */
export const UNSCORED_AS = 60;

export interface VendorScoreInput {
  score: number | null;
  grade: string | null;
  /** market: the vendor's score in this country; overall: across all its work; none: not enough data. */
  source: 'market' | 'overall' | 'none';
}

export interface RouteMarketInput extends MarketInput {
  /** Client CPI of the market, in the market currency. */
  clientCpi: number;
}

export interface RankedLink {
  id: string;
  vendorId: string;
  name: string;
  rank: number;
  /** 0–100, the weighted average of the parts. */
  routingScore: number;
  parts: { score: number; cost: number; room: number };
  vendorScore: number | null;
  grade: string | null;
  scoreSource: VendorScoreInput['source'];
  cpi: number;
  /** (client CPI − link CPI) / client CPI, in %. */
  marginPct: number;
  room: number;
  /** Completes this link gets in the plan. */
  gets: number;
  because: string;
}

export interface SkippedLink {
  id: string;
  name: string;
  why: string;
}

export interface RouteMove {
  from: string | null;
  to: string;
  completes: number;
  reason: DonorReason;
  because: string;
  cpiDelta: number;
}

export interface RoutePlan {
  moves: RouteMove[];
  ranking: RankedLink[];
  skipped: SkippedLink[];
  /** Completes the donors free up, before the per-run cap. */
  freed: number;
  /** Per-run cap: maxMovePercent of what the market still needs. */
  cap: number;
  /** Freed completes left for a later run because of the cap. */
  held: number;
  /** Freed completes no eligible link has room for: needs another vendor or a later end date. */
  uncovered: number;
  /** Change in vendor cost if every move delivers: Σ completes × CPI change. */
  costDelta: number;
  /** One line for the screen, the audit log and the history. */
  summary: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function planRoute(m: RouteMarketInput, scores: Map<string, VendorScoreInput>, cfg: AutoRoute, s: AlertSettings): RoutePlan {
  const base = suggest(m, s);
  const freed = base.donors.reduce((t, d) => t + d.give, 0);
  const marketLeft = Math.max(0, m.target - m.completes);
  const cap = Math.max(1, Math.ceil((marketLeft * cfg.maxMovePercent) / 100));
  const links = new Map(m.links.map((l) => [l.id, l]));
  const skipped: SkippedLink[] = [];

  const candidates = base.receivers.flatMap((r) => {
    const l = links.get(r.id)!;
    const sc = scores.get(l.vendor.id) ?? { score: null, grade: null, source: 'none' as const };
    if (sc.score != null && sc.score < cfg.minScore) {
      skipped.push({ id: l.id, name: l.vendor.name, why: `Vendor score ${sc.score} is under the minimum of ${cfg.minScore}` });
      return [];
    }
    if (cfg.keepMargin && m.clientCpi > 0 && l.cpi >= m.clientCpi) {
      skipped.push({ id: l.id, name: l.vendor.name, why: `CPI ${l.cpi.toFixed(2)} is at or above the client CPI ${m.clientCpi.toFixed(2)}, so every routed complete would lose money` });
      return [];
    }
    return [{ l, room: r.room, sc }];
  });
  const maxRoom = Math.max(1, ...candidates.map((c) => c.room));
  const wSum = cfg.weights.score + cfg.weights.cost + cfg.weights.room;

  const ranking: RankedLink[] = candidates
    .map(({ l, room, sc }) => {
      const marginPct = m.clientCpi > 0 ? r1((100 * (m.clientCpi - l.cpi)) / m.clientCpi) : 0;
      const parts = {
        score: sc.score ?? UNSCORED_AS,
        cost: Math.max(0, Math.min(100, Math.round(marginPct))),
        room: Math.round((100 * room) / maxRoom),
      };
      const routingScore = Math.round((parts.score * cfg.weights.score + parts.cost * cfg.weights.cost + parts.room * cfg.weights.room) / wSum);
      return { id: l.id, vendorId: l.vendor.id, name: l.vendor.name, rank: 0, routingScore, parts, vendorScore: sc.score, grade: sc.grade, scoreSource: sc.source, cpi: l.cpi, marginPct, room, gets: 0, because: '' };
    })
    // Best routing score first; ties go to the cheaper link, then the one with more room.
    .sort((a, b) => b.routingScore - a.routingScore || a.cpi - b.cpi || b.room - a.room);
  ranking.forEach((x, i) => {
    x.rank = i + 1;
    const score = x.vendorScore == null ? `no score yet (counted as ${UNSCORED_AS})` : `score ${x.vendorScore}${x.grade ? ` (${x.grade})` : ''}${x.scoreSource === 'market' ? ' in this country' : ''}`;
    x.because = `Rank ${x.rank} of ${ranking.length}, routing score ${x.routingScore}: ${score}, ${x.marginPct}% margin at CPI ${x.cpi.toFixed(2)}, room for ${x.room}`;
  });

  // Largest donor first (as the suggestions), best receiver first, never past the per-run cap.
  const room = new Map(ranking.map((x) => [x.id, x.room]));
  const moves: RouteMove[] = [];
  let budget = Math.min(freed, cap);
  let unplaced = 0;
  for (const d of [...base.donors].sort((a, b) => b.give - a.give)) {
    let left = d.give;
    for (const x of ranking) {
      if (!left || !budget) break;
      if (x.id === d.id) continue;
      const n = Math.min(left, budget, room.get(x.id) ?? 0);
      if (!n) continue;
      room.set(x.id, (room.get(x.id) ?? 0) - n);
      left -= n;
      budget -= n;
      x.gets += n;
      const fromCpi = d.id ? links.get(d.id)?.cpi ?? 0 : 0;
      moves.push({ from: d.id, to: x.id, completes: n, reason: d.reason, because: x.because, cpiDelta: r2(x.cpi - fromCpi) });
    }
    unplaced += left;
  }
  const moved = moves.reduce((t, x) => t + x.completes, 0);
  // What was not placed is either held back by the cap (there was still room) or has nowhere to go.
  const roomLeft = [...room.values()].reduce((t, n) => t + n, 0);
  const held = budget === 0 ? Math.min(unplaced, roomLeft) : 0;
  const uncovered = Math.max(0, freed - moved - held);
  const costDelta = r2(moves.reduce((t, x) => t + x.completes * x.cpiDelta, 0));

  const nameOf = (id: string | null) => (id ? links.get(id)?.vendor.name ?? '?' : 'Unassigned');
  let summary: string;
  if (!freed) summary = 'Every link is on course; nothing to route';
  else if (!moves.length) summary = ranking.length || !skipped.length ? `${freed} completes at risk, but no live link has room for them` : `${freed} completes at risk, but no link is eligible to receive them`;
  else {
    const to = [...new Set(moves.map((x) => x.to))].map((id) => `${moves.filter((x) => x.to === id).reduce((t, x) => t + x.completes, 0)} to ${nameOf(id)}`);
    summary = `Route ${moved} completes: ${to.join(', ')}`;
    if (held) summary += `; ${held} held for a later run`;
  }
  return { moves, ranking, skipped, freed, cap, held, uncovered, costDelta, summary };
}

/** Stable key of a plan's moves, so "apply" can check it is applying the plan the person saw. */
export const planKey = (moves: Pick<RouteMove, 'from' | 'to' | 'completes'>[]) => moves.map((x) => `${x.from ?? '-'}>${x.to}=${x.completes}`).join(',');
