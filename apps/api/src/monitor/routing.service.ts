import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { scoreVendor, VendorScoringService } from '../vendors/vendor-scoring';
import { AlertSettings, AutoRoute, autopilotOf } from './monitor.rules';
import type { MarketView } from './monitor.service';
import { applyMoves, TargetChange } from './apply-moves';
import { planRoute, RoutePlan, VendorScoreInput } from './routing';

/** Days of delivery history behind the vendor scores routing uses (same default as Vendor scores). */
export const ROUTING_SCORE_DAYS = 180;

export const REASON: Record<string, string> = { paused: 'Paused link', closed: 'Closed link', quality: 'Quality problems', stalled: 'Stalled', behind: 'Behind pace', unassigned: 'Not given to any vendor' };

/**
 * Vendor auto-routing (docs/VENDOR_AUTO_ROUTING.md): plans per market, applies a plan (by hand or
 * from the monitor when the project is set to "auto"), and undoes a run. Plans come from
 * routing.ts; target changes go through applyMoves, the same guarded path as manual reallocation.
 */
@Injectable()
export class RoutingService {
  private readonly log = new Logger(RoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scoring: VendorScoringService,
  ) {}

  /** Vendor scores by market ("<vendorId>|<country>") and overall; a market score is used once it has enough data. */
  async scores(org: string) {
    const { vendors, markets } = await this.scoring.stats(org, ROUTING_SCORE_DAYS);
    const overall = new Map([...vendors].map(([id, st]) => [id, scoreVendor(st)]));
    const market = new Map([...markets].map(([k, st]) => [k, scoreVendor(st)]));
    return (countryCode: string, vendorIds: string[]) =>
      new Map<string, VendorScoreInput>(
        vendorIds.map((id) => {
          const m = market.get(`${id}|${countryCode}`);
          if (m?.score != null) return [id, { score: m.score, grade: m.grade, source: 'market' }];
          const o = overall.get(id);
          if (o?.score != null) return [id, { score: o.score, grade: o.grade, source: 'overall' }];
          return [id, { score: null, grade: null, source: 'none' }];
        }),
      );
  }

  plan(m: MarketView, cfg: AutoRoute, s: AlertSettings, scoreMap: Map<string, VendorScoreInput>): RoutePlan {
    const links = m.allocations.map((a) => ({ id: a.id, vendor: a.vendor, status: a.status, target: a.metrics.target, completes: a.metrics.completes, cpi: a.cpi, pace: a.pace, entries24h: a.metrics.entries24h, qualityShare24h: a.qualityShare24h }));
    return planRoute({ target: m.metrics.target, completes: m.metrics.completes, daysLeft: m.pace.daysLeft, links, clientCpi: m.country.cpi }, scoreMap, cfg, s);
  }

  /** When the autopilot may next route this market: cooldown after the last run or undo. */
  async cooldowns(countryIds: string[], hours: number, now: Date) {
    const since = new Date(now.getTime() - hours * 3_600_000);
    const runs = await this.prisma.routingRun.findMany({
      where: { projectCountryId: { in: countryIds }, OR: [{ createdAt: { gte: since } }, { undoneAt: { gte: since } }] },
      select: { projectCountryId: true, createdAt: true, undoneAt: true },
    });
    const out = new Map<string, Date>();
    for (const r of runs) {
      const last = r.undoneAt && r.undoneAt > r.createdAt ? r.undoneAt : r.createdAt;
      const until = new Date(last.getTime() + hours * 3_600_000);
      if (!out.has(r.projectCountryId) || out.get(r.projectCountryId)! < until) out.set(r.projectCountryId, until);
    }
    return out;
  }

  /** Applies a plan and keeps it as a routing run in the same transaction. */
  async execute(org: string, actorId: string | null, m: MarketView, plan: RoutePlan, cfg: AutoRoute) {
    if (!plan.moves.length) throw new BadRequestException('There is nothing to route in this market right now');
    const trigger = actorId ? 'manual' : 'auto';
    const label = `${m.project.projectCode} ${m.country.countryCode}`;
    const summary = `${label}: ${plan.summary}`;
    let runId = '';
    const { changed } = await applyMoves(this.prisma, this.audit, {
      organizationId: org,
      actorId,
      projectId: m.project.id,
      countryId: m.country.id,
      moves: plan.moves.map(({ from, to, completes }) => ({ from, to, completes })),
      action: actorId ? 'allocation.route' : 'autopilot.route',
      detail: { summary, trigger },
      extra: async (tx, targets) => {
        const run = await tx.routingRun.create({
          data: {
            organizationId: org,
            projectId: m.project.id,
            projectCountryId: m.country.id,
            trigger,
            actorId,
            summary,
            moves: plan.moves as unknown as Prisma.InputJsonValue,
            targets: targets as unknown as Prisma.InputJsonValue,
            explanation: { ranking: plan.ranking, skipped: plan.skipped, freed: plan.freed, cap: plan.cap, held: plan.held, uncovered: plan.uncovered, costDelta: plan.costDelta, settings: cfg } as unknown as Prisma.InputJsonValue,
          },
        });
        runId = run.id;
      },
    });
    return { id: runId, summary, changed };
  }

  /** Monitor step: route every live market of projects set to "auto", outside their cooldown. Returns what it did, in words. */
  async runAuto(org: string, markets: MarketView[], s: AlertSettings, now = new Date()): Promise<string[]> {
    const ids = [...new Set(markets.map((m) => m.project.id))];
    if (!ids.length) return [];
    const rows = await this.prisma.project.findMany({ where: { id: { in: ids }, organizationId: org }, select: { id: true, autopilot: true } });
    const cfgs = new Map(rows.map((p) => [p.id, autopilotOf(p.autopilot).autoRoute]).filter(([, c]) => (c as AutoRoute).enabled && (c as AutoRoute).mode === 'auto') as [string, AutoRoute][]);
    const todo = markets.filter((m) => cfgs.has(m.project.id) && m.country.status === 'LIVE');
    if (!todo.length) return [];
    const scoresFor = await this.scores(org);
    const actions: string[] = [];
    for (const m of todo) {
      const cfg = cfgs.get(m.project.id)!;
      if ((await this.cooldowns([m.country.id], cfg.cooldownHours, now)).has(m.country.id)) continue;
      const plan = this.plan(m, cfg, s, scoresFor(m.country.countryCode, m.allocations.map((a) => a.vendor.id)));
      if (!plan.moves.length) continue;
      try {
        actions.push((await this.execute(org, null, m, plan, cfg)).summary);
      } catch (e) {
        this.log.warn(`Auto-routing ${m.project.projectCode} ${m.country.countryCode} skipped: ${(e as Error).message}`);
      }
    }
    return actions;
  }

  /** Puts every vendor target of a run back, as long as nobody changed it since. */
  async undo(u: AuthUser, projectId: string, runId: string) {
    const run = await this.prisma.routingRun.findFirst({ where: { id: runId, projectId, organizationId: u.organizationId } });
    if (!run) throw new NotFoundException('Routing run not found');
    if (run.undoneAt) throw new BadRequestException('This routing run was already undone');
    const targets = run.targets as unknown as TargetChange[];
    const rows = await this.prisma.vendorAllocation.findMany({ where: { id: { in: targets.map((t) => t.id) } }, select: { id: true, targetCompletes: true, completes: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const restored: { id: string; vendor: string; from: number; to: number; note?: string }[] = [];
    for (const t of targets) {
      const a = byId.get(t.id);
      if (!a) continue; // link deleted since
      if (a.targetCompletes !== t.to) throw new ConflictException(`${t.vendor}'s target changed since this run (now ${a.targetCompletes}, the run set ${t.to}). Undo the newer change first, or edit the target by hand.`);
      const back = Math.max(t.from, a.completes);
      restored.push({ id: t.id, vendor: t.vendor, from: t.to, to: back, ...(back !== t.from ? { note: `already has ${a.completes} completes, so it goes back to ${back} instead of ${t.from}` } : {}) });
    }
    await this.prisma.$transaction(async (tx) => {
      for (const r of restored) {
        const x = await tx.vendorAllocation.updateMany({ where: { id: r.id, targetCompletes: r.from }, data: { targetCompletes: r.to } });
        if (x.count !== 1) throw new ConflictException('Targets changed while undoing. Refresh and try again.');
      }
      const done = await tx.routingRun.updateMany({ where: { id: run.id, undoneAt: null }, data: { undoneAt: new Date(), undoneById: u.id } });
      if (done.count !== 1) throw new ConflictException('This routing run was already undone');
      await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'allocation.route_undo', entityType: 'ProjectCountry', entityId: run.projectCountryId, detail: { runId: run.id, summary: run.summary, targets: restored } }, tx);
    });
    return { restored };
  }
}

