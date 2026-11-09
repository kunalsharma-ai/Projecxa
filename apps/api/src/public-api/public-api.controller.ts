import { Body, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Public } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsModule } from '../projects/projects.controller';
import { ProjectsService } from '../projects/projects.service';
import { ApiKeyGuard, ApiRequest, Scope } from './api-key.guard';
import { ApiKeysController, ApiKeysService } from './api-keys';
import { openApiSpec } from './openapi';

const num = (d: number | null | undefined) => (d == null ? null : Number(d));
const iso = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const since = z.string().regex(iso, 'Use an ISO date, e.g. 2026-11-01 or 2026-11-01T09:00:00Z').transform((s) => new Date(s)).refine((d) => !Number.isNaN(d.getTime()), 'Not a valid date').optional();
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(60).optional() };

export const projectsQuery = z.object({ status: z.enum(['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED', 'INVOICED']).optional(), updatedSince: since, ...page });
export const sessionsQuery = z.object({
  status: z.enum(['STARTED', 'COMPLETE', 'TERMINATE', 'QUOTA_FULL', 'QUALITY_FAIL', 'DUPLICATE', 'SECURITY_REJECT', 'PARTIAL', 'TECHNICAL_ERROR']).optional(),
  outcomeSince: since,
  ...page,
});
export const financeQuery = z.object({ status: z.string().regex(/^[A-Z]+$/).optional(), updatedSince: since, ...page });

export const projectPatch = z.object({
  status: z.enum(['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED']).optional(),
  fieldStartAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional(),
  fieldEndAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional(),
}).strict();
export const marketPatch = z.object({ status: z.enum(['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED']).optional(), targetCompletes: z.number().int().min(1).max(1_000_000).optional() }).strict();
export const vendorLinkPatch = z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']).optional(), targetCompletes: z.number().int().min(1).max(1_000_000).optional() }).strict();

/** Page through rows ordered newest first; `cursor` is the id of the last row of the previous page. */
function paged<T extends { id: string }>(rows: T[], limit: number) {
  const more = rows.length > limit;
  const data = more ? rows.slice(0, limit) : rows;
  return { data, nextCursor: more ? data[data.length - 1].id : null };
}
const cursorArgs = (cursor: string | undefined, limit: number) => ({ take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });

const PROJECT_SELECT = {
  id: true, projectCode: true, workOrderNo: true, bidReference: true, name: true, type: true, category: true, status: true,
  fieldStartAt: true, fieldEndAt: true, createdAt: true, updatedAt: true,
  client: { select: { id: true, name: true, code: true } },
  projectManager: { select: { name: true, email: true } },
} satisfies Prisma.ProjectSelect;

/**
 * Public REST API for other systems (docs/PUBLIC_API.md). Authenticated with API keys, never
 * with staff sessions. Everything is scoped to the key's organization.
 */
@Controller('public')
@Public()
@UseGuards(ApiKeyGuard)
export class PublicApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  @Get('me')
  async me(@Req() req: ApiRequest) {
    const k = req.apiKey!;
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: k.organizationId }, select: { name: true, slug: true, baseCurrency: true } });
    return { organization: org, key: { name: k.name, prefix: k.prefix, scopes: k.scopes, expiresAt: k.expiresAt } };
  }

  @Get('projects')
  @Scope('projects:read')
  async listProjects(@Req() req: ApiRequest, @Query(new ZodPipe(projectsQuery)) q: z.infer<typeof projectsQuery>) {
    const rows = await this.prisma.project.findMany({
      where: { organizationId: req.apiKey!.organizationId, ...(q.status ? { status: q.status } : {}), ...(q.updatedSince ? { updatedAt: { gte: q.updatedSince } } : {}) },
      select: { ...PROJECT_SELECT, countries: { select: { countryCode: true, status: true, targetCompletes: true, completes: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q.cursor, q.limit),
    });
    return paged(rows.map((p) => ({
      ...p,
      targetCompletes: p.countries.reduce((a, c) => a + c.targetCompletes, 0),
      completes: p.countries.reduce((a, c) => a + c.completes, 0),
      markets: p.countries.map((c) => ({ countryCode: c.countryCode, status: c.status })),
      countries: undefined,
    })), q.limit);
  }

  @Get('projects/:ref')
  @Scope('projects:read')
  async getProject(@Req() req: ApiRequest, @Param('ref') ref: string) {
    const p = await this.find(req, ref);
    const full = await this.prisma.project.findUniqueOrThrow({
      where: { id: p.id },
      select: {
        ...PROJECT_SELECT,
        countries: {
          orderBy: { countryCode: 'asc' },
          select: {
            id: true, countryCode: true, language: true, targetGroup: true, status: true, loiMinutes: true, irPercent: true, cpi: true, currency: true, targetCompletes: true, completes: true,
            allocations: { orderBy: { createdAt: 'asc' }, select: { id: true, status: true, cpi: true, targetCompletes: true, completes: true, vendor: { select: { id: true, name: true, code: true } } } },
          },
        },
      },
    });
    const counts = await this.prisma.respondentSession.groupBy({ by: ['projectCountryId', 'status'], where: { projectId: p.id, isTest: false }, _count: { _all: true } });
    return {
      ...full,
      countries: undefined,
      markets: full.countries.map((c) => ({
        ...c,
        cpi: num(c.cpi),
        allocations: undefined,
        sessions: Object.fromEntries(counts.filter((x) => x.projectCountryId === c.id).map((x) => [x.status, x._count._all])),
        vendorLinks: c.allocations.map((a) => ({ ...a, cpi: num(a.cpi) })),
      })),
    };
  }

  @Patch('projects/:ref')
  @Scope('projects:write')
  async patchProject(@Req() req: ApiRequest, @Param('ref') ref: string, @Body(new ZodPipe(projectPatch)) body: z.infer<typeof projectPatch>) {
    const p = await this.find(req, ref);
    await this.projects.update(await this.actor(req), p.id, body);
    return this.getProject(req, p.id);
  }

  @Patch('projects/:ref/markets/:countryCode')
  @Scope('projects:write')
  async patchMarket(@Req() req: ApiRequest, @Param('ref') ref: string, @Param('countryCode') cc: string, @Body(new ZodPipe(marketPatch)) body: z.infer<typeof marketPatch>) {
    const p = await this.find(req, ref);
    const c = await this.market(p.id, cc);
    await this.projects.updateCountry(await this.actor(req), p.id, c.id, body);
    return this.getProject(req, p.id);
  }

  @Patch('projects/:ref/markets/:countryCode/vendor-links/:linkId')
  @Scope('projects:write')
  async patchVendorLink(@Req() req: ApiRequest, @Param('ref') ref: string, @Param('countryCode') cc: string, @Param('linkId') linkId: string, @Body(new ZodPipe(vendorLinkPatch)) body: z.infer<typeof vendorLinkPatch>) {
    const p = await this.find(req, ref);
    const c = await this.market(p.id, cc);
    await this.projects.updateAllocation(await this.actor(req), p.id, c.id, linkId, body);
    return this.getProject(req, p.id);
  }

  @Get('projects/:ref/sessions')
  @Scope('sessions:read')
  async sessions(@Req() req: ApiRequest, @Param('ref') ref: string, @Query(new ZodPipe(sessionsQuery)) q: z.infer<typeof sessionsQuery>) {
    const p = await this.find(req, ref);
    const rows = await this.prisma.respondentSession.findMany({
      where: { projectId: p.id, isTest: false, ...(q.status ? { status: q.status } : {}), ...(q.outcomeSince ? { outcomeAt: { gte: q.outcomeSince } } : {}) },
      select: {
        id: true, status: true, statusDetail: true, outcomeVerified: true, approval: true, vendorRespondentId: true, deviceType: true, geoCountry: true,
        startedAt: true, outcomeAt: true, revenue: true, payout: true, quotaCellIds: true,
        projectCountry: { select: { countryCode: true, currency: true } },
        vendorAllocation: { select: { id: true, vendor: { select: { code: true, name: true } } } },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q.cursor, q.limit),
    });
    return paged(rows.map(({ projectCountry, vendorAllocation, revenue, payout, ...s }) => ({
      ...s,
      countryCode: projectCountry.countryCode,
      currency: projectCountry.currency,
      vendor: vendorAllocation.vendor,
      vendorLinkId: vendorAllocation.id,
      revenue: num(revenue),
      payout: num(payout),
    })), q.limit);
  }

  @Get('projects/:ref/quotas')
  @Scope('quotas:read')
  async quotas(@Req() req: ApiRequest, @Param('ref') ref: string) {
    const p = await this.find(req, ref);
    const countries = await this.prisma.projectCountry.findMany({
      where: { projectId: p.id },
      orderBy: { countryCode: 'asc' },
      select: {
        countryCode: true, targetCompletes: true, completes: true,
        quotas: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, group: true, name: true, conditions: true, target: true, completes: true, isOpen: true } },
      },
    });
    return { projectCode: p.projectCode, markets: countries.map((c) => ({ countryCode: c.countryCode, targetCompletes: c.targetCompletes, completes: c.completes, cells: c.quotas })) };
  }

  @Get('invoices')
  @Scope('finance:read')
  async invoices(@Req() req: ApiRequest, @Query(new ZodPipe(financeQuery)) q: z.infer<typeof financeQuery>) {
    const rows = await this.prisma.invoice.findMany({
      where: { organizationId: req.apiKey!.organizationId, ...(q.status ? { status: q.status as never } : {}), ...(q.updatedSince ? { updatedAt: { gte: q.updatedSince } } : {}) },
      select: {
        id: true, number: true, status: true, currency: true, completes: true, subtotal: true, taxName: true, taxPercent: true, taxAmount: true, total: true, lines: true,
        issuedAt: true, dueAt: true, paidAt: true, voidedAt: true, createdAt: true, updatedAt: true,
        project: { select: { projectCode: true, name: true } }, client: { select: { name: true, code: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q.cursor, q.limit),
    });
    return paged(rows.map((r) => ({ ...r, subtotal: num(r.subtotal), taxPercent: num(r.taxPercent), taxAmount: num(r.taxAmount), total: num(r.total) })), q.limit);
  }

  @Get('bills')
  @Scope('finance:read')
  async bills(@Req() req: ApiRequest, @Query(new ZodPipe(financeQuery)) q: z.infer<typeof financeQuery>) {
    const rows = await this.prisma.vendorBill.findMany({
      where: { organizationId: req.apiKey!.organizationId, ...(q.status ? { status: q.status as never } : {}), ...(q.updatedSince ? { updatedAt: { gte: q.updatedSince } } : {}) },
      select: {
        id: true, number: true, status: true, currency: true, completes: true, subtotal: true, taxName: true, taxPercent: true, taxAmount: true, total: true, lines: true,
        vendorReference: true, paymentReference: true, approvedAt: true, dueAt: true, paidAt: true, voidedAt: true, createdAt: true, updatedAt: true,
        vendor: { select: { name: true, code: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q.cursor, q.limit),
    });
    return paged(rows.map((r) => ({ ...r, subtotal: num(r.subtotal), taxPercent: num(r.taxPercent), taxAmount: num(r.taxAmount), total: num(r.total) })), q.limit);
  }

  /** A project by its code (PRX10001) or id, inside the key's organization. */
  private async find(req: ApiRequest, ref: string) {
    const org = req.apiKey!.organizationId;
    const p = await this.prisma.project.findFirst({ where: { organizationId: org, OR: [{ projectCode: ref.toUpperCase() }, { id: ref }] }, select: { id: true, projectCode: true } });
    if (!p) throw new NotFoundException(`Project ${ref} not found`);
    return p;
  }

  private async market(projectId: string, cc: string) {
    const c = await this.prisma.projectCountry.findFirst({ where: { projectId, countryCode: cc.toUpperCase() }, select: { id: true } });
    if (!c) throw new NotFoundException(`Market ${cc.toUpperCase()} not found on this project`);
    return c;
  }

  /** Writes act as the admin who created the key, and stop working if that person loses edit rights. */
  private async actor(req: ApiRequest): Promise<AuthUser> {
    const k = req.apiKey!;
    const u = await this.prisma.user.findUnique({ where: { id: k.createdById } });
    if (!u || !u.active || u.organizationId !== k.organizationId || !['ADMIN', 'PROJECT_MANAGER'].includes(u.role)) {
      throw new ForbiddenException('The person who created this key can no longer make changes. Create a new key.');
    }
    return { id: u.id, organizationId: u.organizationId, role: u.role, email: u.email, name: u.name };
  }
}

/** The OpenAPI description, readable without a key so tools can import it. */
@Controller('public')
export class OpenApiController {
  @Get('openapi.json')
  @Public()
  spec() {
    return openApiSpec();
  }
}

@Module({ imports: [ProjectsModule], controllers: [OpenApiController, PublicApiController, ApiKeysController], providers: [ApiKeysService, ApiKeyGuard] })
export class PublicApiModule {}
