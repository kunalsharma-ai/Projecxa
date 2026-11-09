import { EntitlementsService } from '../super-admin/entitlements';
/**
 * Client and vendor self-service portals (spec modules 8 and 9, first slice).
 *
 * Data rules:
 * - A vendor user sees only allocations, sessions and callbacks of its own vendor, and
 *   only its own payout. Client CPI, revenue, client names of other vendors' work and
 *   other vendors are never returned.
 * - A client user sees only its own client's projects, with revenue (its spend) but never
 *   vendor names, vendor UIDs or payouts. Respondents are identified by the session
 *   token the client survey received.
 * - Portal users never pass the staff endpoints (the global guard defaults to staff roles).
 */
import { forVendor } from '../common/vendor-safe';
import { BadRequestException, Body, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { config } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { emptyStats } from '../projects/projects.service';
import { FinanceModule } from '../finance/finance.controller';
import { PayablesService } from '../finance/payables.service';
import { UniqueLinksModule, UniqueLinksService } from '../unique-links/unique-links';

/** Projects a portal can see: not drafts. */
const VISIBLE_PROJECT_STATUSES = ['TEST', 'LIVE', 'HOLD', 'CLOSED', 'INVOICED'] as const;

async function portalUser(prisma: PrismaService, u: AuthUser) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { clientId: true, vendorId: true } });
  return user;
}

function statsFrom(rows: { status: keyof ReturnType<typeof emptyStats>; _count: { _all: number } }[]) {
  const s = emptyStats();
  for (const r of rows) s[r.status] = r._count._all;
  return s;
}

// ─────────────────────────────── Vendor portal ───────────────────────────────

@Controller('portal/vendor')
@Roles('VENDOR_USER')
export class VendorPortalController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly payables: PayablesService, private readonly uniqueLinks: UniqueLinksService) {}

  /**
   * The one-time unique links staff generated for one of this vendor's markets, as CSV, so the
   * vendor can send one link to each respondent (docs/UNIQUE_LINKS.md). Unused links only by default.
   */
  @Get('allocations/:id/unique-links.csv')
  async uniqueLinksCsv(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('all') all: string | undefined, @Res() res: Response) {
    const vendorId = await this.vendorId(u);
    const a = await this.prisma.vendorAllocation.findFirst({
      where: { id, vendorId, projectCountry: { project: { organizationId: u.organizationId, status: { in: [...VISIBLE_PROJECT_STATUSES] } } } },
      select: { id: true, projectCountry: { select: { projectId: true } } },
    });
    if (!a) throw new NotFoundException('Allocation not found');
    await this.uniqueLinks.exportCsv(u.organizationId, a.projectCountry.projectId, { allocationId: a.id, ...(all === 'true' ? {} : { status: 'UNUSED' as const }) }, res);
  }

  /** Bills we approved or paid for this vendor (drafts and voided bills stay internal). */
  @Get('bills')
  async bills(@CurrentUser() u: AuthUser) {
    return this.payables.list(u.organizationId, { vendorId: await this.vendorId(u), vendorView: true });
  }

  @Get('bills/:id')
  async bill(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.payables.get(u.organizationId, id, await this.vendorId(u));
  }

  private async vendorId(u: AuthUser): Promise<string> {
    const { vendorId } = await portalUser(this.prisma, u);
    if (!vendorId) throw new ForbiddenException('This account is not linked to a vendor');
    return vendorId;
  }

  @Get('summary')
  async summary(@CurrentUser() u: AuthUser) {
    const vendorId = await this.vendorId(u);
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: vendorId }, select: { id: true, name: true, code: true } });
    const where = { vendorAllocation: { vendorId }, isTest: false };
    const [byStatus, payout, active] = await Promise.all([
      this.prisma.respondentSession.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.respondentSession.groupBy({ by: ['approval'], where: { ...where, status: 'COMPLETE' }, _sum: { payout: true }, _count: { _all: true } }),
      this.prisma.vendorAllocation.count({ where: { vendorId, status: 'ACTIVE', projectCountry: { status: 'LIVE', project: { status: 'LIVE' } } } }),
    ]);
    const stats = statsFrom(byStatus);
    const clicks = Object.values(stats).reduce((a, b) => a + b, 0);
    const byApproval = Object.fromEntries(payout.map((p) => [p.approval, { completes: p._count._all, payout: Number(p._sum.payout ?? 0) }]));
    return {
      vendor,
      liveAllocations: active,
      clicks,
      stats,
      conversion: clicks ? Math.round((stats.COMPLETE / clicks) * 1000) / 10 : 0,
      payout: {
        approved: byApproval.APPROVED ?? { completes: 0, payout: 0 },
        pending: byApproval.PENDING ?? { completes: 0, payout: 0 },
        rejected: byApproval.REJECTED ?? { completes: 0, payout: 0 },
      },
      currencyNote: 'Payouts are in each market’s currency.',
    };
  }

  @Get('allocations')
  async allocations(@CurrentUser() u: AuthUser) {
    const vendorId = await this.vendorId(u);
    const rows = await this.prisma.vendorAllocation.findMany({
      where: { vendorId, projectCountry: { project: { status: { in: [...VISIBLE_PROJECT_STATUSES] } } } },
      orderBy: { createdAt: 'desc' },
      include: {
        projectCountry: {
          select: {
            countryCode: true, language: true, targetGroup: true, loiMinutes: true, irPercent: true, currency: true, status: true,
            project: { select: { id: true, projectCode: true, name: true, vendorTitle: true, status: true, category: true, devices: true } },
          },
        },
      },
    });
    const grouped = await this.prisma.respondentSession.groupBy({
      by: ['vendorAllocationId', 'status'],
      where: { vendorAllocationId: { in: rows.map((r) => r.id) }, isTest: false },
      _count: { _all: true },
    });
    const ids = rows.map((r) => r.id);
    const [linkTotals, linkUnused] = await Promise.all([
      this.prisma.uniqueLink.groupBy({ by: ['vendorAllocationId'], where: { vendorAllocationId: { in: ids } }, _count: { _all: true } }),
      this.prisma.uniqueLink.groupBy({
        by: ['vendorAllocationId'],
        where: { vendorAllocationId: { in: ids }, status: 'UNUSED', batch: { OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] } },
        _count: { _all: true },
      }),
    ]);
    const base = config.publicBaseUrl;
    return rows.map((a) => {
      const stats = statsFrom(grouped.filter((g) => g.vendorAllocationId === a.id));
      const live = a.status === 'ACTIVE' && a.projectCountry.status === 'LIVE' && a.projectCountry.project.status === 'LIVE';
      return {
        id: a.id,
        project: forVendor(a.projectCountry.project),
        countryCode: a.projectCountry.countryCode,
        language: a.projectCountry.language,
        targetGroup: a.projectCountry.targetGroup,
        loiMinutes: a.projectCountry.loiMinutes,
        irPercent: a.projectCountry.irPercent,
        status: a.status,
        accepting: live,
        cpi: a.cpi,
        currency: a.projectCountry.currency,
        targetCompletes: a.targetCompletes,
        completes: a.completes,
        uidParam: a.uidParam,
        entryLink: `${base}/s/${a.entryCode}?${encodeURIComponent(a.uidParam)}=[UID]`,
        testEntryLink: `${base}/s/${a.testEntryCode}?${encodeURIComponent(a.uidParam)}=[UID]`,
        uniqueLinksOnly: a.uniqueLinksOnly,
        uniqueLinks: {
          total: linkTotals.find((l) => l.vendorAllocationId === a.id)?._count._all ?? 0,
          unused: linkUnused.find((l) => l.vendorAllocationId === a.id)?._count._all ?? 0,
        },
        stats,
      };
    });
  }

  @Get('sessions')
  async sessions(@CurrentUser() u: AuthUser, @Query('allocationId') allocationId?: string, @Query('status') status?: string) {
    const vendorId = await this.vendorId(u);
    if (allocationId) {
      const own = await this.prisma.vendorAllocation.findFirst({ where: { id: allocationId, vendorId } });
      if (!own) throw new NotFoundException('Allocation not found');
    }
    const st = status && status in emptyStats() ? (status as keyof ReturnType<typeof emptyStats>) : undefined;
    const rows = await this.prisma.respondentSession.findMany({
      where: { vendorAllocation: { vendorId }, ...(allocationId ? { vendorAllocationId: allocationId } : {}), ...(st === 'SPEEDER' ? { status: 'QUALITY_FAIL', statusDetail: 'SPEEDER' } : st ? { status: st } : {}) },
      orderBy: { startedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        vendorRespondentId: true,
        status: true,
        approval: true,
        isTest: true,
        payout: true,
        startedAt: true,
        outcomeAt: true,
        project: { select: { projectCode: true, name: true, vendorTitle: true } },
        projectCountry: { select: { countryCode: true, currency: true } },
      },
    });
    return rows.map((r) => ({ ...r, project: forVendor(r.project) }));
  }

  @Get('callbacks')
  async callbacks(@CurrentUser() u: AuthUser) {
    const vendorId = await this.vendorId(u);
    return this.prisma.callbackDelivery.findMany({
      where: { targetType: 'VENDOR', targetId: vendorId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, url: true, state: true, attempts: true, lastStatusCode: true, lastError: true, createdAt: true, deliveredAt: true },
    });
  }
}

// ─────────────────────────────── Client portal ───────────────────────────────

const approvalSchema = z.object({
  sessionIds: z.array(z.string()).min(1).max(5000),
  approval: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().max(500).optional(),
});

@Controller('portal/client')
@Roles('CLIENT_USER')
export class ClientPortalController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async clientId(u: AuthUser): Promise<string> {
    const { clientId } = await portalUser(this.prisma, u);
    if (!clientId) throw new ForbiddenException('This account is not linked to a client');
    return clientId;
  }

  private async ownProject(u: AuthUser, projectId: string) {
    const clientId = await this.clientId(u);
    const p = await this.prisma.project.findFirst({
      where: { id: projectId, clientId, status: { in: [...VISIBLE_PROJECT_STATUSES] } },
      select: {
        id: true, projectCode: true, workOrderNo: true, name: true, status: true, category: true, createdAt: true,
        projectManager: { select: { name: true, email: true } },
        countries: {
          orderBy: { countryCode: 'asc' },
          select: { id: true, countryCode: true, language: true, targetGroup: true, status: true, loiMinutes: true, irPercent: true, cpi: true, currency: true, targetCompletes: true, completes: true },
        },
      },
    });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  @Get('summary')
  async summary(@CurrentUser() u: AuthUser) {
    const clientId = await this.clientId(u);
    const client = await this.prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, name: true } });
    const pending = await this.prisma.respondentSession.count({
      where: { project: { clientId }, isTest: false, status: 'COMPLETE', approval: 'PENDING' },
    });
    return { client, pendingApprovals: pending };
  }

  @Get('projects')
  async projects(@CurrentUser() u: AuthUser) {
    const clientId = await this.clientId(u);
    const rows = await this.prisma.project.findMany({
      where: { clientId, status: { in: [...VISIBLE_PROJECT_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, projectCode: true, workOrderNo: true, name: true, status: true, category: true, createdAt: true,
        countries: { select: { countryCode: true, targetCompletes: true, completes: true } },
      },
    });
    const pending = await this.prisma.respondentSession.groupBy({
      by: ['projectId'],
      where: { projectId: { in: rows.map((r) => r.id) }, isTest: false, status: 'COMPLETE', approval: 'PENDING' },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      ...r,
      countries: r.countries.map((c) => c.countryCode),
      targetCompletes: r.countries.reduce((a, c) => a + c.targetCompletes, 0),
      completes: r.countries.reduce((a, c) => a + c.completes, 0),
      pendingApprovals: pending.find((p) => p.projectId === r.id)?._count._all ?? 0,
    }));
  }

  @Get('projects/:id')
  async project(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.ownProject(u, id);
    const [byStatus, money] = await Promise.all([
      this.prisma.respondentSession.groupBy({ by: ['status'], where: { projectId: p.id, isTest: false }, _count: { _all: true } }),
      this.prisma.respondentSession.groupBy({
        by: ['approval'],
        where: { projectId: p.id, isTest: false, status: 'COMPLETE' },
        _sum: { revenue: true },
        _count: { _all: true },
      }),
    ]);
    const stats = statsFrom(byStatus);
    // Terminates and quota-fulls are shown; quality and security rejections are summarised, not itemised.
    return {
      ...p,
      stats: {
        completes: stats.COMPLETE,
        terminates: stats.TERMINATE,
        quotaFull: stats.QUOTA_FULL,
        inProgress: stats.STARTED,
        partial: stats.PARTIAL,
        removedForQuality: stats.QUALITY_FAIL + stats.DUPLICATE + stats.SECURITY_REJECT,
        incidence: stats.COMPLETE + stats.TERMINATE ? Math.round((stats.COMPLETE / (stats.COMPLETE + stats.TERMINATE)) * 1000) / 10 : null,
      },
      spend: Object.fromEntries(money.map((m) => [m.approval, { completes: m._count._all, amount: Number(m._sum.revenue ?? 0) }])),
    };
  }

  @Get('projects/:id/completes')
  async completes(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('approval') approval?: string) {
    const p = await this.ownProject(u, id);
    const ap = approval && ['PENDING', 'APPROVED', 'REJECTED'].includes(approval) ? (approval as 'PENDING' | 'APPROVED' | 'REJECTED') : undefined;
    return this.prisma.respondentSession.findMany({
      where: { projectId: p.id, isTest: false, status: 'COMPLETE', ...(ap ? { approval: ap } : {}) },
      orderBy: { outcomeAt: 'desc' },
      take: 1000,
      select: {
        id: true,
        token: true, // the respondent ID the client's own survey received
        approval: true,
        outcomeVerified: true,
        revenue: true,
        outcomeAt: true,
        projectCountry: { select: { countryCode: true, currency: true } },
      },
    });
  }

  /** Client reconciliation: accept or reject completes. Only pending completes can be decided here. */
  @Post('projects/:id/approval')
  async approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(approvalSchema)) body: z.infer<typeof approvalSchema>) {
    const p = await this.ownProject(u, id);
    const r = await this.prisma.respondentSession.updateMany({
      where: { id: { in: body.sessionIds }, projectId: p.id, status: 'COMPLETE', isTest: false, approval: 'PENDING' },
      data: { approval: body.approval, approvalAt: new Date() },
    });
    await this.audit.record({
      organizationId: u.organizationId,
      actorId: u.id,
      action: `client-portal.${body.approval.toLowerCase()}`,
      entityType: 'Project',
      entityId: p.id,
      detail: { requested: body.sessionIds.length, updated: r.count, reason: body.reason },
    });
    return { updated: r.count, skipped: body.sessionIds.length - r.count };
  }
}

// ─────────────────────────────── Portal user management (staff) ───────────────────────────────

const inviteSchema = z
  .object({
    kind: z.enum(['client', 'vendor']),
    partyId: z.string().min(1),
    name: z.string().min(1).max(200),
    email: z.string().email().transform((s) => s.toLowerCase()),
    password: z.string().min(10, 'Use at least 10 characters'),
  })
  .strict();

@Controller('portal-users')
@Roles(...EDITORS)
export class PortalUsersController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly entitlements: EntitlementsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('clientId') clientId?: string, @Query('vendorId') vendorId?: string) {
    return this.prisma.user.findMany({
      where: {
        organizationId: u.organizationId,
        role: { in: ['CLIENT_USER', 'VENDOR_USER'] },
        ...(clientId ? { clientId } : {}),
        ...(vendorId ? { vendorId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, client: { select: { id: true, name: true } }, vendor: { select: { id: true, name: true } } },
    });
  }

  @Post()
  async invite(@CurrentUser() u: AuthUser, @Body(new ZodPipe(inviteSchema)) body: z.infer<typeof inviteSchema>) {
    const party =
      body.kind === 'client'
        ? await this.prisma.client.findFirst({ where: { id: body.partyId, organizationId: u.organizationId } })
        : await this.prisma.vendor.findFirst({ where: { id: body.partyId, organizationId: u.organizationId } });
    if (!party) throw new BadRequestException(`${body.kind === 'client' ? 'Client' : 'Vendor'} not found`);
    await this.entitlements.assertLimit(u.organizationId, 'portalUsers');
    try {
      const created = await this.prisma.user.create({
        data: {
          organizationId: u.organizationId,
          email: body.email,
          name: body.name,
          role: body.kind === 'client' ? 'CLIENT_USER' : 'VENDOR_USER',
          clientId: body.kind === 'client' ? party.id : null,
          vendorId: body.kind === 'vendor' ? party.id : null,
          passwordHash: await bcrypt.hash(body.password, 10), passwordSetAt: new Date(),
        },
        select: { id: true, name: true, email: true, role: true, active: true },
      });
      await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'portal-user.create', entityType: body.kind === 'client' ? 'Client' : 'Vendor', entityId: party.id, detail: { userId: created.id } });
      return created;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('A user with this email already exists');
      throw e;
    }
  }

  @Patch(':id')
  async setActive(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ active: z.boolean() }))) body: { active: boolean }) {
    const found = await this.prisma.user.findFirst({ where: { id, organizationId: u.organizationId, role: { in: ['CLIENT_USER', 'VENDOR_USER'] } } });
    if (!found) throw new NotFoundException();
    if (body.active && !found.active) await this.entitlements.assertLimit(u.organizationId, 'portalUsers');
    await this.prisma.user.update({ where: { id }, data: { active: body.active } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: body.active ? 'portal-user.activate' : 'portal-user.deactivate', entityType: 'User', entityId: id });
    return { id, active: body.active };
  }
}

@Module({ imports: [FinanceModule, UniqueLinksModule], controllers: [VendorPortalController, ClientPortalController, PortalUsersController] })
export class PortalModule {}
