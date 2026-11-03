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

  /**
   * Rules-based attention list for the insights panel and notification count.
   * Every item is computed from live data and links to where it can be acted on.
   */
  @Get('insights')
  async insights(@CurrentUser() u: AuthUser) {
    const org = u.organizationId;
    const day = new Date(Date.now() - 24 * 3600_000);
    const [pending, liveCountries, recentTraffic, callbacks, fallbacks, activity] = await Promise.all([
      this.prisma.respondentSession.groupBy({
        by: ['projectId'],
        where: { organizationId: org, isTest: false, status: 'COMPLETE', approval: 'PENDING' },
        _count: { _all: true },
        orderBy: { _count: { projectId: 'desc' } },
        take: 5,
      }),
      this.prisma.projectCountry.findMany({
        where: { status: 'LIVE', project: { organizationId: org, status: 'LIVE' } },
        select: { id: true, countryCode: true, completes: true, targetCompletes: true, project: { select: { id: true, projectCode: true, name: true } } },
      }),
      this.prisma.respondentSession.groupBy({
        by: ['projectCountryId'],
        where: { organizationId: org, isTest: false, startedAt: { gte: day } },
        _count: { _all: true },
      }),
      this.prisma.callbackDelivery.count({ where: { organizationId: org, state: { in: ['FAILED', 'DEAD_LETTER'] } } }),
      this.prisma.redirectExecution.count({ where: { usedFallback: true, createdAt: { gte: day }, session: { organizationId: org } } }),
      this.prisma.auditEvent.findMany({ where: { organizationId: org }, orderBy: { createdAt: 'desc' }, take: 8 }),
    ]);
    const projects = await this.prisma.project.findMany({ where: { id: { in: pending.map((p) => p.projectId) }, organizationId: org }, select: { id: true, projectCode: true, name: true } });
    const actors = await this.prisma.user.findMany({ where: { id: { in: activity.map((a) => a.actorId).filter((x): x is string => !!x) }, organizationId: org }, select: { id: true, name: true } });
    const traffic = new Set(recentTraffic.map((t) => t.projectCountryId));

    type Item = { id: string; severity: 'info' | 'warn' | 'bad'; title: string; detail: string; href: string };
    const items: Item[] = [];
    if (callbacks) items.push({ id: 'callbacks', severity: 'bad', title: `${callbacks} vendor callback${callbacks === 1 ? '' : 's'} failed`, detail: 'Replay them from the project page once the vendor endpoint is fixed.', href: '/projects' });
    if (fallbacks) items.push({ id: 'fallbacks', severity: 'warn', title: `${fallbacks} redirect${fallbacks === 1 ? '' : 's'} used a fallback in 24h`, detail: 'A rule was missing or blocked by the security policy.', href: '/projects' });
    for (const c of liveCountries) {
      const share = c.targetCompletes ? c.completes / c.targetCompletes : 0;
      if (share >= 0.9) {
        items.push({ id: `quota-${c.id}`, severity: share >= 1 ? 'info' : 'warn', title: `${c.project.projectCode} ${c.countryCode} at ${Math.round(share * 100)}% of target`, detail: share >= 1 ? 'Target reached; new entries are sent to quota full.' : 'Close to target; plan to close or raise the quota.', href: `/projects/${c.project.id}` });
      } else if (!traffic.has(c.id)) {
        items.push({ id: `idle-${c.id}`, severity: 'warn', title: `${c.project.projectCode} ${c.countryCode} has had no traffic for 24h`, detail: `${c.completes} of ${c.targetCompletes} completes so far.`, href: `/projects/${c.project.id}` });
      }
    }
    for (const p of pending) {
      const proj = projects.find((x) => x.id === p.projectId);
      if (proj) items.push({ id: `approve-${proj.id}`, severity: 'info', title: `${p._count._all} complete${p._count._all === 1 ? '' : 's'} to review on ${proj.projectCode}`, detail: proj.name, href: `/projects/${proj.id}` });
    }
    const rank = { bad: 0, warn: 1, info: 2 } as const;
    items.sort((a, b) => rank[a.severity] - rank[b.severity]);
    return {
      items: items.slice(0, 20),
      alerts: items.filter((i) => i.severity !== 'info').length,
      activity: activity.map((a) => ({ id: a.id, action: a.action, entityType: a.entityType, entityId: a.entityId, at: a.createdAt, actor: actors.find((x) => x.id === a.actorId)?.name ?? 'System' })),
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
