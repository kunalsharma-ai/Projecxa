import { BadRequestException, Body, Controller, ConflictException, Get, HttpCode, Injectable, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { settingsOf } from './monitor.rules';
import { MonitorService } from './monitor.service';
import { DonorReason, suggest } from './reallocation';

export const reallocateSchema = z
  .object({
    moves: z
      .array(z.object({ from: z.string().max(64).nullable(), to: z.string().max(64), completes: z.number().int().min(1).max(1_000_000) }).strict())
      .min(1)
      .max(50),
  })
  .strict()
  .refine((b) => b.moves.every((m) => m.from !== m.to), { message: 'A move needs two different vendor links' });

const REASON: Record<DonorReason, string> = {
  paused: 'Paused link',
  closed: 'Closed link',
  quality: 'Quality problems',
  stalled: 'Stalled',
  behind: 'Behind pace',
  unassigned: 'Not given to any vendor',
};

@Injectable()
export class ReallocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly monitor: MonitorService,
    private readonly audit: AuditService,
  ) {}

  /** Suggestions for every live market (of one project, or the whole organisation). Markets with nothing to suggest are left out. */
  async suggestions(org: string, projectId?: string, now = new Date()) {
    const [markets, o] = await Promise.all([
      this.monitor.markets(org, projectId, now),
      this.prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { alertSettings: true } }),
    ]);
    const s = settingsOf(o.alertSettings);
    const out = [];
    for (const m of markets) {
      if (m.country.status !== 'LIVE') continue;
      const links = m.allocations.map((a) => ({ id: a.id, vendor: a.vendor, status: a.status, target: a.metrics.target, completes: a.metrics.completes, cpi: a.cpi, pace: a.pace, entries24h: a.metrics.entries24h, qualityShare24h: a.qualityShare24h }));
      const r = suggest({ target: m.metrics.target, completes: m.metrics.completes, daysLeft: m.pace.daysLeft, links }, s);
      if (!r.moves.length && !r.uncovered) continue;
      const byId = new Map(links.map((l) => [l.id, l]));
      const name = (id: string | null) => (id ? byId.get(id)?.vendor.name ?? '?' : 'Unassigned');
      out.push({
        project: m.project,
        country: m.country,
        pace: m.pace,
        target: m.metrics.target,
        completes: m.metrics.completes,
        moves: r.moves.map((x) => ({ ...x, reasonLabel: REASON[x.reason], fromName: name(x.from), toName: name(x.to) })),
        uncovered: r.uncovered,
        donors: r.donors.map((d) => ({ ...d, name: name(d.id), reasonLabel: REASON[d.reason] })),
        receivers: r.receivers.map((x) => ({ ...x, name: name(x.id) })),
        links: links.map((l) => ({ id: l.id, vendor: l.vendor, status: l.status, target: l.target, completes: l.completes, cpi: l.cpi, perDay: l.pace.perDay, paceStatus: l.pace.status, qualityShare24h: l.qualityShare24h })),
      });
    }
    return out;
  }

  /**
   * Moves completes between vendor links of one market in one transaction. Each target change is
   * checked against the value that was read, so two people applying at once cannot both succeed.
   */
  async apply(u: AuthUser, projectId: string, countryId: string, body: z.infer<typeof reallocateSchema>) {
    const country = await this.prisma.projectCountry.findFirst({
      where: { id: countryId, projectId, project: { organizationId: u.organizationId } },
      include: { allocations: { include: { vendor: { select: { name: true } } } } },
    });
    if (!country) throw new NotFoundException('Market not found');
    const links = new Map(country.allocations.map((a) => [a.id, a]));
    const next = new Map(country.allocations.map((a) => [a.id, a.targetCompletes]));
    let fromUnassigned = 0;
    for (const m of body.moves) {
      const to = links.get(m.to);
      if (!to || (m.from && !links.has(m.from))) throw new BadRequestException('A vendor link is not in this market');
      if (to.status !== 'ACTIVE') throw new BadRequestException(`${to.vendor.name} is ${to.status.toLowerCase()}. Reactivate it before giving it more completes.`);
      next.set(m.to, next.get(m.to)! + m.completes);
      if (m.from) next.set(m.from, next.get(m.from)! - m.completes);
      else fromUnassigned += m.completes;
    }
    for (const [id, t] of next) {
      const a = links.get(id)!;
      if (t < a.completes) throw new BadRequestException(`${a.vendor.name} already has ${a.completes} completes; its target cannot go below that`);
    }
    const assigned = country.allocations.reduce((t, a) => t + Math.max(a.targetCompletes, a.completes), 0);
    if (fromUnassigned > Math.max(0, country.targetCompletes - assigned)) throw new BadRequestException('That is more than the unassigned part of the market target');

    const changed = [...next].filter(([id, t]) => t !== links.get(id)!.targetCompletes);
    await this.prisma.$transaction(async (tx) => {
      for (const [id, t] of changed) {
        const r = await tx.vendorAllocation.updateMany({ where: { id, targetCompletes: links.get(id)!.targetCompletes, completes: { lte: t } }, data: { targetCompletes: t } });
        if (r.count !== 1) throw new ConflictException('Targets changed while you were looking. Refresh the suggestions and try again.');
      }
      await this.audit.record(
        {
          organizationId: u.organizationId,
          actorId: u.id,
          action: 'allocation.reallocate',
          entityType: 'ProjectCountry',
          entityId: countryId,
          detail: { moves: body.moves, targets: changed.map(([id, t]) => ({ id, vendor: links.get(id)!.vendor.name, from: links.get(id)!.targetCompletes, to: t })) },
        },
        tx,
      );
    });
    return { changed: changed.map(([id, t]) => ({ id, vendor: links.get(id)!.vendor.name, from: links.get(id)!.targetCompletes, to: t })) };
  }
}

const query = z.object({ projectId: z.string().max(64).optional() });

@Controller()
export class ReallocationController {
  constructor(
    private readonly svc: ReallocationService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('monitor/reallocation')
  async list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(query)) q: z.infer<typeof query>) {
    if (q.projectId && !(await this.prisma.project.count({ where: { id: q.projectId, organizationId: u.organizationId } }))) throw new NotFoundException('Project not found');
    return this.svc.suggestions(u.organizationId, q.projectId);
  }

  @Post('projects/:id/countries/:countryId/reallocate')
  @HttpCode(200)
  @Roles(...EDITORS)
  apply(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('countryId') countryId: string, @Body(new ZodPipe(reallocateSchema)) body: z.infer<typeof reallocateSchema>) {
    return this.svc.apply(u, id, countryId, body);
  }
}
