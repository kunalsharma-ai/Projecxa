/**
 * Live client dashboards (docs/CLIENT_DASHBOARD_LINKS.md).
 *
 * A project manager makes a read-only link per project and sends it to the client. Anyone with the
 * link sees the project's completes, markets and quota cells as they move, without signing in.
 *
 * Data rules for the public view:
 * - Never: vendor CPI, vendor cost, margin, respondent IDs, session tokens, survey links, internal ids.
 * - Client CPI and spend so far only when the link has "Show money" on.
 * - Vendor names with their completes only when the link has "Show vendors" on.
 * - Revoked, expired and draft-project links answer 404, the same as a wrong token.
 */
import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Injectable, Module, NotFoundException, Param, Patch, Post, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Public, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { fieldMetrics, emptyFieldMetrics } from '../projects/field-metrics';
import { RateLimiter } from '../public-api/api-key.guard';
import { EntitlementsModule, EntitlementsService } from '../super-admin/entitlements';

/** At most this many links that still work, per project. */
export const MAX_ACTIVE_DASHBOARD_LINKS = 20;
/** Projects a client may watch: not drafts. */
const SHAREABLE_STATUSES = ['TEST', 'LIVE', 'HOLD', 'CLOSED', 'INVOICED'] as const;
/** The page refreshes every 30 seconds; 120 a minute per network leaves room for many open tabs. */
export const dashboardLimiter = new RateLimiter(120, 60_000);

/** 24 random bytes as base64url: 32 characters, not guessable. */
export const newDashboardToken = () => randomBytes(24).toString('base64url');
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

const createSchema = z.object({
  label: z.string().trim().max(120).optional(),
  showMoney: z.boolean().default(false),
  showVendors: z.boolean().default(false),
  expiresAt: z.coerce.date().nullable().optional(),
});
const updateSchema = z.object({
  label: z.string().trim().max(120).nullable().optional(),
  showMoney: z.boolean().optional(),
  showVendors: z.boolean().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

const staffSelect = {
  id: true, token: true, label: true, showMoney: true, showVendors: true, expiresAt: true, revokedAt: true,
  viewCount: true, lastViewedAt: true, createdAt: true, createdById: true,
} satisfies Prisma.ClientDashboardLinkSelect;

type StaffRow = Prisma.ClientDashboardLinkGetPayload<{ select: typeof staffSelect }>;
export function linkState(l: Pick<StaffRow, 'revokedAt' | 'expiresAt'>, now = new Date()): 'ACTIVE' | 'REVOKED' | 'EXPIRED' {
  if (l.revokedAt) return 'REVOKED';
  if (l.expiresAt && l.expiresAt <= now) return 'EXPIRED';
  return 'ACTIVE';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class DashboardLinksService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly entitlements: EntitlementsService) {}

  private async project(organizationId: string, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, organizationId }, select: { id: true, projectCode: true, status: true } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private async link(organizationId: string, projectId: string, linkId: string) {
    const l = await this.prisma.clientDashboardLink.findFirst({ where: { id: linkId, projectId, organizationId }, select: staffSelect });
    if (!l) throw new NotFoundException('Dashboard link not found');
    return l;
  }

  private async withNames(rows: StaffRow[]) {
    const ids = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const now = new Date();
    return rows.map((r) => ({ ...r, state: linkState(r, now), createdBy: users.find((u) => u.id === r.createdById)?.name ?? null }));
  }

  async list(organizationId: string, projectId: string) {
    const p = await this.project(organizationId, projectId);
    const rows = await this.prisma.clientDashboardLink.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'desc' }, select: staffSelect });
    return { projectStatus: p.status, shareable: (SHAREABLE_STATUSES as readonly string[]).includes(p.status), maxActive: MAX_ACTIVE_DASHBOARD_LINKS, links: await this.withNames(rows) };
  }

  async create(u: AuthUser, projectId: string, body: z.infer<typeof createSchema>) {
    const p = await this.project(u.organizationId, projectId);
    if (body.expiresAt && body.expiresAt <= new Date()) throw new BadRequestException('The end date must be in the future');
    const active = await this.prisma.clientDashboardLink.count({
      where: { projectId: p.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    if (active >= MAX_ACTIVE_DASHBOARD_LINKS) throw new BadRequestException(`A project can have at most ${MAX_ACTIVE_DASHBOARD_LINKS} working dashboard links. Revoke one first.`);
    const l = await this.prisma.clientDashboardLink.create({
      data: {
        organizationId: u.organizationId, projectId: p.id, token: newDashboardToken(), label: body.label || null,
        showMoney: body.showMoney, showVendors: body.showVendors, expiresAt: body.expiresAt ?? null, createdById: u.id,
      },
      select: staffSelect,
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'dashboard_link.created', entityType: 'Project', entityId: p.id, detail: { linkId: l.id, label: l.label, showMoney: l.showMoney, showVendors: l.showVendors, expiresAt: l.expiresAt } });
    return (await this.withNames([l]))[0];
  }

  async update(u: AuthUser, projectId: string, linkId: string, body: z.infer<typeof updateSchema>) {
    const l = await this.link(u.organizationId, projectId, linkId);
    if (l.revokedAt) throw new BadRequestException('This link is revoked. Make a new one instead.');
    if (body.expiresAt && body.expiresAt <= new Date()) throw new BadRequestException('The end date must be in the future');
    const next = await this.prisma.clientDashboardLink.update({
      where: { id: l.id },
      data: {
        ...(body.label !== undefined ? { label: body.label || null } : {}),
        ...(body.showMoney !== undefined ? { showMoney: body.showMoney } : {}),
        ...(body.showVendors !== undefined ? { showVendors: body.showVendors } : {}),
        ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
      },
      select: staffSelect,
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'dashboard_link.updated', entityType: 'Project', entityId: projectId, detail: { linkId: l.id, ...body } });
    return (await this.withNames([next]))[0];
  }

  async revoke(u: AuthUser, projectId: string, linkId: string) {
    const l = await this.link(u.organizationId, projectId, linkId);
    const next = l.revokedAt ? l : await this.prisma.clientDashboardLink.update({ where: { id: l.id }, data: { revokedAt: new Date() }, select: staffSelect });
    if (!l.revokedAt) await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'dashboard_link.revoked', entityType: 'Project', entityId: projectId, detail: { linkId: l.id, label: l.label } });
    return (await this.withNames([next]))[0];
  }

  /** The public, read-only view behind /live/{token}. */
  async view(token: string, ip: string | undefined) {
    if (!dashboardLimiter.hit(ip ?? '?').ok) throw new HttpException('Too many requests; try again in a minute', HttpStatus.TOO_MANY_REQUESTS);
    const gone = () => new NotFoundException({ message: 'This dashboard link does not work any more. Ask your project manager for a new one.', code: 'DASHBOARD_LINK_UNAVAILABLE' });
    if (!TOKEN_RE.test(token)) throw gone();
    const link = await this.prisma.clientDashboardLink.findUnique({ where: { token }, select: { id: true, projectId: true, organizationId: true, showMoney: true, showVendors: true, revokedAt: true, expiresAt: true } });
    if (!link || linkState(link) !== 'ACTIVE') throw gone();
    // The organisation's plan must still include client dashboards (docs/FEATURE_ACCESS.md).
    if (!(await this.entitlements.orgAllows(link.organizationId, 'client_dashboards'))) throw gone();
    const p = await this.prisma.project.findFirst({
      where: { id: link.projectId, organizationId: link.organizationId, status: { in: [...SHAREABLE_STATUSES] } },
      select: {
        id: true, projectCode: true, name: true, status: true, fieldStartAt: true, fieldEndAt: true,
        organization: { select: { name: true } },
        countries: {
          orderBy: [{ countryCode: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true, countryCode: true, language: true, targetGroup: true, status: true, loiMinutes: true, irPercent: true,
            targetCompletes: true, completes: true, cpi: true, currency: true,
            quotas: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { group: true, name: true, target: true, completes: true, isOpen: true } },
          },
        },
      },
    });
    if (!p) throw gone();
    await this.prisma.clientDashboardLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } });

    // 24 clock hours: the current one and the 23 before it.
    const hourStart = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    const since = new Date(hourStart - 23 * 3_600_000);
    const [byStatus, metrics, recent, spend, vendors] = await Promise.all([
      this.prisma.respondentSession.groupBy({ by: ['status'], where: { projectId: p.id, isTest: false }, _count: { _all: true } }),
      fieldMetrics(this.prisma, [p.id]),
      this.prisma.$queryRaw<{ h: Date; n: number }[]>`
        SELECT date_trunc('hour', "outcomeAt") AS h, COUNT(*)::int AS n
        FROM "RespondentSession"
        WHERE "projectId" = ${p.id} AND "isTest" = false AND "status" = 'COMPLETE' AND "outcomeAt" >= ${since}
        GROUP BY 1`,
      link.showMoney
        ? this.prisma.respondentSession.groupBy({ by: ['projectCountryId'], where: { projectId: p.id, isTest: false, status: 'COMPLETE' }, _sum: { revenue: true } })
        : Promise.resolve([]),
      link.showVendors
        ? this.prisma.vendorAllocation.findMany({ where: { projectCountry: { projectId: p.id } }, select: { vendorId: true, vendor: { select: { name: true } }, targetCompletes: true, completes: true, status: true } })
        : Promise.resolve([]),
    ]);
    const count = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const m = metrics.get(p.id) ?? emptyFieldMetrics();
    const pace = Array.from({ length: 24 }, () => 0);
    for (const r of recent) {
      const i = Math.round((new Date(r.h).getTime() - since.getTime()) / 3_600_000);
      if (i >= 0 && i < 24) pace[i] += Number(r.n);
    }
    const target = p.countries.reduce((a, c) => a + c.targetCompletes, 0);
    const completes = p.countries.reduce((a, c) => a + c.completes, 0);

    const markets = p.countries.map((c) => ({
      countryCode: c.countryCode,
      language: c.language,
      targetGroup: c.targetGroup,
      status: c.status,
      plannedLoiMinutes: c.loiMinutes,
      plannedIrPercent: c.irPercent,
      target: c.targetCompletes,
      completes: c.completes,
      quotas: c.quotas.map((q) => ({ group: q.group, name: q.name, target: q.target, completes: q.completes, open: q.isOpen && q.completes < q.target })),
      ...(link.showMoney
        ? { money: { currency: c.currency, cpi: Number(c.cpi), spend: round2(Number(spend.find((s) => s.projectCountryId === c.id)?._sum.revenue ?? 0)) } }
        : {}),
    }));

    let vendorRows: { name: string; target: number; completes: number; active: boolean }[] | undefined;
    if (link.showVendors) {
      const byVendor = new Map<string, { name: string; target: number; completes: number; active: boolean }>();
      for (const a of vendors) {
        const v = byVendor.get(a.vendorId) ?? { name: a.vendor.name, target: 0, completes: 0, active: false };
        v.target += a.targetCompletes;
        v.completes += a.completes;
        v.active ||= a.status === 'ACTIVE';
        byVendor.set(a.vendorId, v);
      }
      vendorRows = [...byVendor.values()].sort((a, b) => b.completes - a.completes || a.name.localeCompare(b.name));
    }

    return {
      organization: p.organization.name,
      project: { code: p.projectCode, name: p.name, status: p.status, fieldStartAt: p.fieldStartAt, fieldEndAt: p.fieldEndAt },
      generatedAt: new Date(),
      showMoney: link.showMoney,
      showVendors: link.showVendors,
      totals: {
        target,
        completes,
        inProgress: count('STARTED'),
        terminates: count('TERMINATE'),
        quotaFull: count('QUOTA_FULL'),
        removedForQuality: count('QUALITY_FAIL') + count('DUPLICATE') + count('SECURITY_REJECT'),
        avgLoiMinutes: m.avgLoiMinutes,
        incidence: m.irPercent,
        last24h: pace.reduce((a, n) => a + n, 0),
      },
      /** Completes per hour over the last 24 hours, oldest first. */
      pace,
      markets,
      ...(vendorRows ? { vendors: vendorRows } : {}),
    };
  }
}

@Controller('projects/:id/dashboard-links')
@Roles(...EDITORS)
export class DashboardLinksController {
  constructor(private readonly svc: DashboardLinksService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.list(u.organizationId, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.svc.create(u, id, body);
  }

  @Patch(':linkId')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('linkId') linkId: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    return this.svc.update(u, id, linkId, body);
  }

  @Post(':linkId/revoke')
  revoke(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('linkId') linkId: string) {
    return this.svc.revoke(u, id, linkId);
  }
}

@Public()
@Controller('public/dashboard')
export class PublicDashboardController {
  constructor(private readonly svc: DashboardLinksService) {}

  @Get(':token')
  view(@Param('token') token: string, @Req() req: Request) {
    return this.svc.view(token, req.ip);
  }
}

@Module({ imports: [EntitlementsModule], controllers: [DashboardLinksController, PublicDashboardController], providers: [DashboardLinksService] })
export class DashboardLinksModule {}
