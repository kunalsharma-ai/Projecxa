import { Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AutoRoute, autopilotOf, settingsOf } from './monitor.rules';
import { MonitorService } from './monitor.service';
import { planKey } from './routing';
import { REASON, ROUTING_SCORE_DAYS, RoutingService } from './routing.service';

const routeBody = z.object({ key: z.string().max(5000) }).strict();

@Controller()
export class RoutingController {
  constructor(
    private readonly svc: RoutingService,
    private readonly monitor: MonitorService,
    private readonly prisma: PrismaService,
  ) {}

  private async project(u: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, organizationId: u.organizationId }, select: { id: true, autopilot: true } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private async plans(u: AuthUser, projectId: string, cfg: AutoRoute) {
    const now = new Date();
    const [markets, org, scoresFor] = await Promise.all([
      this.monitor.markets(u.organizationId, projectId, now),
      this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { alertSettings: true } }),
      this.svc.scores(u.organizationId),
    ]);
    const s = settingsOf(org.alertSettings);
    const live = markets.filter((m) => m.country.status === 'LIVE');
    return { live, s, scoresFor, now };
  }

  /** Settings, a plan per live market (with every number behind it), and the last routing runs. */
  @Get('projects/:id/routing')
  async view(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.project(u, id);
    const cfg = autopilotOf(p.autopilot).autoRoute;
    const { live, s, scoresFor, now } = await this.plans(u, id, cfg);
    const cool = cfg.enabled && cfg.mode === 'auto' ? await this.svc.cooldowns(live.map((m) => m.country.id), cfg.cooldownHours, now) : new Map<string, Date>();
    const markets = live.map((m) => {
      const plan = this.svc.plan(m, cfg, s, scoresFor(m.country.countryCode, m.allocations.map((a) => a.vendor.id)));
      const name = new Map(m.allocations.map((a) => [a.id, a.vendor.name]));
      return {
        country: m.country,
        target: m.metrics.target,
        completes: m.metrics.completes,
        pace: m.pace,
        key: planKey(plan.moves),
        cooldownUntil: cool.get(m.country.id) ?? null,
        ...plan,
        moves: plan.moves.map((x) => ({ ...x, fromName: x.from ? name.get(x.from) ?? '?' : 'Unassigned', toName: name.get(x.to) ?? '?', reasonLabel: REASON[x.reason] })),
      };
    });
    const runs = await this.prisma.routingRun.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 20, include: { projectCountry: { select: { countryCode: true, targetGroup: true, currency: true } } } });
    const users = await this.prisma.user.findMany({ where: { organizationId: u.organizationId, id: { in: runs.flatMap((r) => [r.actorId, r.undoneById]).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const who = (uid: string | null) => (uid ? users.find((x) => x.id === uid)?.name ?? 'Someone' : 'SampTrek autopilot');
    return {
      settings: cfg,
      scoreDays: ROUTING_SCORE_DAYS,
      markets,
      runs: runs.map((r) => ({ id: r.id, createdAt: r.createdAt, trigger: r.trigger, by: who(r.actorId), summary: r.summary, country: r.projectCountry, moves: r.moves, targets: r.targets, explanation: r.explanation, undoneAt: r.undoneAt, undoneBy: r.undoneAt ? who(r.undoneById) : null })),
    };
  }

  /** Applies the plan the person saw for one market. `key` must match the plan as it is now. */
  @Post('projects/:id/countries/:countryId/route')
  @HttpCode(200)
  @Roles(...EDITORS)
  async route(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('countryId') countryId: string, @Body(new ZodPipe(routeBody)) body: z.infer<typeof routeBody>) {
    const p = await this.project(u, id);
    const cfg = autopilotOf(p.autopilot).autoRoute;
    const { live, s, scoresFor } = await this.plans(u, id, cfg);
    const m = live.find((x) => x.country.id === countryId);
    if (!m) throw new NotFoundException('This market is not live');
    const plan = this.svc.plan(m, cfg, s, scoresFor(m.country.countryCode, m.allocations.map((a) => a.vendor.id)));
    if (planKey(plan.moves) !== body.key) throw new ConflictException('The routing plan changed since you loaded it. Look at the new plan and route again.');
    return this.svc.execute(u.organizationId, u.id, m, plan, cfg);
  }

  @Post('projects/:id/routing/runs/:runId/undo')
  @HttpCode(200)
  @Roles(...EDITORS)
  async undo(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('runId') runId: string) {
    await this.project(u, id);
    return this.svc.undo(u, id, runId);
  }
}
