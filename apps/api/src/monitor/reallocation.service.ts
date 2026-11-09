import { Body, Controller, Get, HttpCode, Injectable, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { settingsOf } from './monitor.rules';
import { MonitorService } from './monitor.service';
import { applyMoves } from './apply-moves';
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

  apply(u: AuthUser, projectId: string, countryId: string, body: z.infer<typeof reallocateSchema>) {
    return applyMoves(this.prisma, this.audit, { organizationId: u.organizationId, actorId: u.id, projectId, countryId, moves: body.moves, action: 'allocation.reallocate' });
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
