import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Raw delivery counts for one vendor (or one vendor in one market) over the scoring window. */
export interface DeliveryStats {
  clicks: number;
  completes: number;
  terminates: number;
  quotaFull: number;
  /** Quality fail, duplicate and security reject. */
  quality: number;
  /** Partial, technical error, and sessions that expired without an outcome. */
  drops: number;
  approved: number;
  rejected: number;
  /** IR the projects expected, weighted by completes + terminates. */
  expectedIr: number | null;
  /** Finished links: share of their target delivered, averaged. */
  delivery: number | null;
  finishedLinks: number;
  projects: number;
}

export interface ScoreParts {
  quality: number | null;
  acceptance: number | null;
  delivery: number | null;
  incidence: number | null;
  engagement: number | null;
}

export interface Score {
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | null;
  parts: ScoreParts;
  /** Why the score is what it is, in words. */
  notes: string[];
}

/** Clicks needed before a score is given. Fewer clicks still show the raw counts. */
export const MIN_CLICKS = 30;
export const WEIGHTS: Record<keyof ScoreParts, number> = { quality: 0.3, acceptance: 0.25, delivery: 0.2, incidence: 0.15, engagement: 0.1 };

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export function emptyStats(): DeliveryStats {
  return { clicks: 0, completes: 0, terminates: 0, quotaFull: 0, quality: 0, drops: 0, approved: 0, rejected: 0, expectedIr: null, delivery: null, finishedLinks: 0, projects: 0 };
}

/**
 * Scores a vendor 0–100 from its delivery history. Each part is 0–100; parts without enough data are
 * left out and the weights of the rest are scaled up. A = 85+, B = 70+, C = 55+, D below.
 *
 * - quality: share of clicks rejected for quality, duplicates or security; 25% or more scores 0.
 * - acceptance: approved completes out of those approved or rejected (client reconciliation).
 * - delivery: share of target reached on finished links.
 * - incidence: actual IR (completes / completes + terminates) against the IR the projects expected.
 * - engagement: share of clicks that dropped out; 40% or more scores 0.
 */
export function scoreVendor(s: DeliveryStats): Score {
  const notes: string[] = [];
  const parts: ScoreParts = { quality: null, acceptance: null, delivery: null, incidence: null, engagement: null };
  if (s.clicks < MIN_CLICKS) return { score: null, grade: null, parts, notes: [`Not enough data yet: ${s.clicks} of ${MIN_CLICKS} clicks needed`] };

  const qualityRate = s.quality / s.clicks;
  parts.quality = clamp(100 * (1 - qualityRate / 0.25));
  if (qualityRate >= 0.1) notes.push(`${pct(qualityRate)} of clicks failed quality, duplicate or security checks`);

  const decided = s.approved + s.rejected;
  if (decided >= 10) {
    parts.acceptance = clamp((100 * s.approved) / decided);
    if (s.rejected / decided >= 0.1) notes.push(`${pct(s.rejected / decided)} of reconciled completes were rejected by clients`);
  }

  if (s.delivery !== null) {
    parts.delivery = clamp(100 * s.delivery);
    if (s.delivery < 0.8) notes.push(`Reached ${pct(s.delivery)} of target on finished links`);
  }

  const qualified = s.completes + s.terminates;
  if (qualified >= 20 && s.expectedIr) {
    const ir = s.completes / qualified;
    parts.incidence = clamp((100 * ir) / (s.expectedIr / 100));
    if (ir < (s.expectedIr / 100) * 0.7) notes.push(`Actual IR ${pct(ir)} against ${s.expectedIr}% expected`);
  }

  const dropRate = s.drops / s.clicks;
  parts.engagement = clamp(100 * (1 - dropRate / 0.4));
  if (dropRate >= 0.15) notes.push(`${pct(dropRate)} of clicks dropped out`);

  let total = 0;
  let weight = 0;
  for (const k of Object.keys(parts) as (keyof ScoreParts)[]) {
    if (parts[k] === null) continue;
    parts[k] = Math.round(parts[k]!);
    total += parts[k]! * WEIGHTS[k];
    weight += WEIGHTS[k];
  }
  const score = Math.round(total / weight);
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
  if (!notes.length) notes.push('No problems found');
  return { score, grade, parts, notes };
}

interface AllocRow {
  id: string;
  vendorId: string;
  status: string;
  targetCompletes: number;
  completes: number;
  cpi: unknown;
  createdAt: Date;
  projectCountry: { countryCode: string; currency: string; irPercent: number; project: { id: string; projectCode: string; name: string; status: string; fieldEndAt: Date | null } };
}

/** Builds per-vendor and per-vendor-per-market delivery stats for an organisation. */
@Injectable()
export class VendorScoringService {
  constructor(private readonly prisma: PrismaService) {}

  async stats(organizationId: string, days: number, vendorId?: string) {
    const since = new Date(Date.now() - days * 86_400_000);
    const now = new Date();
    const base = { organizationId, isTest: false, startedAt: { gte: since }, ...(vendorId ? { vendorAllocation: { vendorId } } : {}) };
    const [byStatus, expired] = await Promise.all([
      this.prisma.respondentSession.groupBy({ by: ['vendorAllocationId', 'status', 'approval'], where: base, _count: { _all: true } }),
      this.prisma.respondentSession.groupBy({ by: ['vendorAllocationId'], where: { ...base, status: 'STARTED', expiresAt: { lt: now } }, _count: { _all: true } }),
    ]);
    const ids = [...new Set(byStatus.map((g) => g.vendorAllocationId))];
    const allocs: AllocRow[] = await this.prisma.vendorAllocation.findMany({
      where: { id: { in: ids } },
      select: { id: true, vendorId: true, status: true, targetCompletes: true, completes: true, cpi: true, createdAt: true, projectCountry: { select: { countryCode: true, currency: true, irPercent: true, project: { select: { id: true, projectCode: true, name: true, status: true, fieldEndAt: true } } } } },
    });
    const byId = new Map(allocs.map((a) => [a.id, a]));
    const perAlloc = new Map<string, DeliveryStats>();
    for (const g of byStatus) {
      const s = perAlloc.get(g.vendorAllocationId) ?? emptyStats();
      const n = g._count._all;
      s.clicks += n;
      if (g.status === 'COMPLETE') s.completes += n;
      else if (g.status === 'TERMINATE') s.terminates += n;
      else if (g.status === 'QUOTA_FULL') s.quotaFull += n;
      else if (g.status === 'QUALITY_FAIL' || g.status === 'DUPLICATE' || g.status === 'SECURITY_REJECT') s.quality += n;
      else if (g.status === 'PARTIAL' || g.status === 'TECHNICAL_ERROR') s.drops += n;
      if (g.status === 'COMPLETE' && g.approval === 'APPROVED') s.approved += n;
      if (g.status === 'COMPLETE' && g.approval === 'REJECTED') s.rejected += n;
      perAlloc.set(g.vendorAllocationId, s);
    }
    for (const g of expired) {
      const s = perAlloc.get(g.vendorAllocationId);
      if (s) s.drops += g._count._all;
    }

    const finished = (a: AllocRow) => a.status === 'CLOSED' || ['CLOSED', 'INVOICED'].includes(a.projectCountry.project.status) || (!!a.projectCountry.project.fieldEndAt && a.projectCountry.project.fieldEndAt < now);
    const vendors = new Map<string, Acc>();
    const markets = new Map<string, Acc>();
    for (const [id, s] of perAlloc) {
      const a = byId.get(id);
      if (!a) continue;
      const keys: [Map<string, Acc>, string][] = [[vendors, a.vendorId], [markets, `${a.vendorId}|${a.projectCountry.countryCode}`]];
      for (const [map, key] of keys) {
        const acc = map.get(key) ?? newAcc();
        add(acc, s, a, finished(a));
        map.set(key, acc);
      }
    }
    return { vendors: finish(vendors), markets: finish(markets), allocations: allocs, perAlloc, finished };
  }
}

interface Acc { s: DeliveryStats; irWeight: number; irSum: number; deliverySum: number; projects: Set<string> }
const newAcc = (): Acc => ({ s: emptyStats(), irWeight: 0, irSum: 0, deliverySum: 0, projects: new Set() });

function add(acc: Acc, s: DeliveryStats, a: AllocRow, done: boolean) {
  for (const k of ['clicks', 'completes', 'terminates', 'quotaFull', 'quality', 'drops', 'approved', 'rejected'] as const) acc.s[k] += s[k];
  const w = s.completes + s.terminates;
  acc.irWeight += w;
  acc.irSum += w * a.projectCountry.irPercent;
  if (done && a.targetCompletes > 0) {
    acc.s.finishedLinks += 1;
    acc.deliverySum += Math.min(1, a.completes / a.targetCompletes);
  }
  acc.projects.add(a.projectCountry.project.id);
}

function finish(map: Map<string, Acc>) {
  const out = new Map<string, DeliveryStats>();
  for (const [k, acc] of map) {
    out.set(k, {
      ...acc.s,
      expectedIr: acc.irWeight ? Math.round((acc.irSum / acc.irWeight) * 10) / 10 : null,
      delivery: acc.s.finishedLinks ? acc.deliverySum / acc.s.finishedLinks : null,
      projects: acc.projects.size,
    });
  }
  return out;
}
