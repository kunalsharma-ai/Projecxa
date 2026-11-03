import { Body, Controller, Get, Module, Patch, Post, Param, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { redirectConfigSchema } from '../redirects/redirect.types';

const domain = z.string().regex(/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$|^localhost$/i, 'Use a hostname like example.com or *.example.com');
const orgSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  redirectAllowedDomains: z.array(domain).max(500).optional(),
  fallbackRedirectUrl: z.string().url().nullable().optional(),
  defaultRedirectConfig: redirectConfigSchema.nullable().optional(),
});
const approvalSchema = z.object({
  sessionIds: z.array(z.string()).min(1).max(5000),
  approval: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().max(500).optional(),
});

@Controller()
export class DashboardController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** PM dashboard numbers, computed from live (non-test) data only. */
  @Get('dashboard')
  async dashboard(@CurrentUser() u: AuthUser) {
    const org = u.organizationId;
    const [clients, vendors, projectsByStatus, money, sessionsByStatus, recentRedirects, callbackStates] = await Promise.all([
      this.prisma.client.groupBy({ by: ['status'], where: { organizationId: org }, _count: { _all: true } }),
      this.prisma.vendor.groupBy({ by: ['status'], where: { organizationId: org }, _count: { _all: true } }),
      this.prisma.project.groupBy({ by: ['status'], where: { organizationId: org }, _count: { _all: true } }),
      this.prisma.respondentSession.aggregate({
        where: { organizationId: org, isTest: false, status: 'COMPLETE', approval: { not: 'REJECTED' } },
        _sum: { revenue: true, payout: true },
        _count: { _all: true },
      }),
      this.prisma.respondentSession.groupBy({ by: ['status'], where: { organizationId: org, isTest: false }, _count: { _all: true } }),
      this.prisma.redirectExecution.groupBy({
        by: ['usedFallback'],
        where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) }, session: { organizationId: org } },
        _count: { _all: true },
      }),
      this.prisma.callbackDelivery.groupBy({ by: ['state'], where: { organizationId: org }, _count: { _all: true } }),
    ]);
    const revenue = Number(money._sum.revenue ?? 0);
    const cost = Number(money._sum.payout ?? 0);
    const clicks = sessionsByStatus.reduce((a, s) => a + s._count._all, 0);
    const live = await this.prisma.project.findMany({
      where: { organizationId: org, status: 'LIVE' },
      select: { id: true, projectCode: true, workOrderNo: true, name: true, countries: { select: { targetCompletes: true, completes: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    return {
      clients: { total: sum(clients), active: count(clients, 'ACTIVE'), inactive: count(clients, 'INACTIVE') },
      vendors: { total: sum(vendors), active: count(vendors, 'ACTIVE'), inactive: count(vendors, 'INACTIVE') },
      projects: { total: sum(projectsByStatus), byStatus: Object.fromEntries(projectsByStatus.map((p) => [p.status, p._count._all])) },
      financials: { revenue, cost, profit: revenue - cost, currencyNote: 'Sums are in each country’s own currency; FX conversion comes in a later milestone.' },
      clicks,
      completes: money._count._all,
      sessionsByStatus: Object.fromEntries(sessionsByStatus.map((s) => [s.status, s._count._all])),
      redirectHealth24h: {
        total: recentRedirects.reduce((a, r) => a + r._count._all, 0),
        fallbacks: recentRedirects.find((r) => r.usedFallback)?._count._all ?? 0,
      },
      callbacks: Object.fromEntries(callbackStates.map((c) => [c.state, c._count._all])),
      liveProjects: live.map((p) => ({
        id: p.id,
        projectCode: p.projectCode,
        workOrderNo: p.workOrderNo,
        name: p.name,
        target: p.countries.reduce((a, c) => a + c.targetCompletes, 0),
        completes: p.countries.reduce((a, c) => a + c.completes, 0),
      })),
    };
  }

  @Get('organization')
  async org(@CurrentUser() u: AuthUser) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: u.organizationId },
      select: { id: true, name: true, slug: true, redirectAllowedDomains: true, fallbackRedirectUrl: true, defaultRedirectConfig: true },
    });
  }

  @Patch('organization')
  @Roles('ADMIN')
  async updateOrg(@CurrentUser() u: AuthUser, @Body(new ZodPipe(orgSchema)) body: z.infer<typeof orgSchema>) {
    const { defaultRedirectConfig, ...rest } = body;
    await this.prisma.organization.update({
      where: { id: u.organizationId },
      data: {
        ...rest,
        ...(defaultRedirectConfig !== undefined
          ? { defaultRedirectConfig: defaultRedirectConfig === null ? Prisma.DbNull : (defaultRedirectConfig as unknown as Prisma.InputJsonValue) }
          : {}),
      },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'organization.update', entityType: 'Organization', entityId: u.organizationId, detail: body });
    return this.org(u);
  }

  /** Reconciliation: approve or reject completes. Only approved completes are billable. */
  @Post('projects/:projectId/sessions/approval')
  @Roles(...EDITORS)
  async approve(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @Body(new ZodPipe(approvalSchema)) body: z.infer<typeof approvalSchema>) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organizationId: u.organizationId } });
    if (!project) throw new BadRequestException('Project not found');
    const r = await this.prisma.respondentSession.updateMany({
      where: { id: { in: body.sessionIds }, projectId, status: 'COMPLETE', isTest: false },
      data: { approval: body.approval },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: `sessions.${body.approval.toLowerCase()}`, entityType: 'Project', entityId: projectId, detail: { count: r.count, reason: body.reason } });
    return { updated: r.count };
  }
}

function sum(rows: { _count: { _all: number } }[]) {
  return rows.reduce((a, r) => a + r._count._all, 0);
}
function count(rows: { status: string; _count: { _all: number } }[], s: string) {
  return rows.find((r) => r.status === s)?._count._all ?? 0;
}

@Module({ controllers: [DashboardController] })
export class DashboardModule {}
