/**
 * One-time unique respondent links (docs/UNIQUE_LINKS.md).
 *
 * Staff generate N links for a vendor in a market. Every link carries its own random key
 * (/u/{key}); the first respondent to open it claims it atomically and nobody can enter with
 * it again (see SurveyService.enterUnique). Staff can list links with their status, download
 * them as CSV, revoke unused ones, and close the shared vendor link so only unique links work.
 */
import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { Prisma, UniqueLinkStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { config } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** Most links one request may create, and most links one project may hold. */
export const MAX_PER_BATCH = 50_000;
export const MAX_PER_PROJECT = 500_000;
const KEY_LENGTH = 24;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // 57 symbols, no look-alikes

/**
 * A random key of 24 symbols from a 57-letter alphabet (about 140 bits), drawn without modulo
 * bias. Letters and digits only, so keys survive spreadsheets, e-mail clients and SMS.
 */
export function newKey(): string {
  let out = '';
  while (out.length < KEY_LENGTH) {
    for (const b of randomBytes(KEY_LENGTH * 2)) {
      if (b >= 228) continue; // 228 = 57 * 4, keeps every symbol equally likely
      out += ALPHABET[b % 57];
      if (out.length === KEY_LENGTH) break;
    }
  }
  return out;
}

export const linkUrl = (key: string) => `${config.publicBaseUrl}/u/${key}`;

export const generateSchema = z
  .object({
    allocationId: z.string().min(1),
    count: z.number().int().min(1).max(MAX_PER_BATCH),
    label: z.string().trim().max(120).optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

const revokeSchema = z
  .object({ batchId: z.string().min(1).optional(), linkIds: z.array(z.string().min(1)).min(1).max(10_000).optional() })
  .strict()
  .refine((b) => !!b.batchId !== !!b.linkIds, 'Give either a batch or a list of links');

const onlySchema = z.object({ uniqueLinksOnly: z.boolean() }).strict();

const listSchema = z.object({
  allocationId: z.string().optional(),
  batchId: z.string().optional(),
  status: z.enum(['UNUSED', 'USED', 'REVOKED', 'EXPIRED']).optional(),
  q: z.string().trim().max(64).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(500).default(100),
});

type Filters = z.infer<typeof listSchema>;

/** What a link looks like from outside: EXPIRED is an unused link whose batch has run out. */
export function shownStatus(l: { status: UniqueLinkStatus; batch: { expiresAt: Date | null } }, now = new Date()) {
  if (l.status === 'UNUSED' && l.batch.expiresAt && l.batch.expiresAt < now) return 'EXPIRED';
  return l.status;
}

function csvCell(v: unknown) {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
}
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

export const CSV_HEADER = ['Key', 'Link', 'Vendor', 'Market', 'Batch', 'Link status', 'Used at', 'Respondent status', 'Respondent detail', 'Blocked re-use attempts', 'Expires at', 'Created at'];

const LINK_SELECT = {
  id: true,
  key: true,
  status: true,
  usedAt: true,
  revokedAt: true,
  blockedAttempts: true,
  lastBlockedAt: true,
  createdAt: true,
  batch: { select: { id: true, label: true, expiresAt: true } },
  vendorAllocation: { select: { id: true, vendor: { select: { name: true, code: true } }, projectCountry: { select: { countryCode: true } } } },
  session: { select: { id: true, status: true, statusDetail: true, startedAt: true, outcomeAt: true } },
} satisfies Prisma.UniqueLinkSelect;

export type LinkRow = Prisma.UniqueLinkGetPayload<{ select: typeof LINK_SELECT }>;

export function csvRows(links: LinkRow[]) {
  const now = new Date();
  return links.map((l) => [
    l.key,
    linkUrl(l.key),
    l.vendorAllocation.vendor.name,
    l.vendorAllocation.projectCountry.countryCode,
    l.batch.label ?? '',
    shownStatus(l, now),
    l.usedAt,
    l.session?.status ?? '',
    l.session?.statusDetail ?? '',
    l.blockedAttempts,
    l.batch.expiresAt,
    l.createdAt,
  ]);
}

@Injectable()
export class UniqueLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async project(organizationId: string, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, organizationId }, select: { id: true, projectCode: true, organizationId: true } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  async allocation(projectId: string, allocationId: string) {
    const a = await this.prisma.vendorAllocation.findFirst({ where: { id: allocationId, projectCountry: { projectId } }, include: { vendor: { select: { name: true } }, projectCountry: { select: { countryCode: true } } } });
    if (!a) throw new NotFoundException('That vendor is not on this project');
    return a;
  }

  /** Creates the batch and its keys. Keys are random; a clash (practically impossible) is simply redrawn. */
  async generate(u: AuthUser, projectId: string, body: z.infer<typeof generateSchema>) {
    const p = await this.project(u.organizationId, projectId);
    const a = await this.allocation(projectId, body.allocationId);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) throw new BadRequestException('The expiry must be in the future');
    const existing = await this.prisma.uniqueLink.count({ where: { projectId } });
    if (existing + body.count > MAX_PER_PROJECT) throw new BadRequestException(`A project can hold at most ${MAX_PER_PROJECT.toLocaleString('en')} unique links (this one has ${existing.toLocaleString('en')})`);

    const batch = await this.prisma.uniqueLinkBatch.create({
      data: { organizationId: p.organizationId, projectId, vendorAllocationId: a.id, label: body.label || null, count: body.count, expiresAt, createdById: u.id },
    });
    let made = 0;
    for (let tries = 0; made < body.count && tries < 20; tries++) {
      const n = Math.min(5_000, body.count - made);
      const r = await this.prisma.uniqueLink.createMany({
        data: Array.from({ length: n }, () => ({ organizationId: p.organizationId, projectId, vendorAllocationId: a.id, batchId: batch.id, key: newKey() })),
        skipDuplicates: true,
      });
      made += r.count;
    }
    await this.audit.record({
      organizationId: u.organizationId,
      actorId: u.id,
      action: 'unique-links.generate',
      entityType: 'Project',
      entityId: projectId,
      detail: { batchId: batch.id, count: made, vendor: a.vendor.name, country: a.projectCountry.countryCode, label: batch.label, expiresAt },
    });
    return { batch: { ...batch, count: made }, created: made };
  }

  /** Per vendor and market: how many links exist in each state, plus the batches. */
  async summary(organizationId: string, projectId: string) {
    await this.project(organizationId, projectId);
    const now = new Date();
    const [allocations, grouped, expired, batches, batchCounts, outcomes] = await Promise.all([
      this.prisma.vendorAllocation.findMany({
        where: { projectCountry: { projectId } },
        orderBy: [{ projectCountry: { countryCode: 'asc' } }, { createdAt: 'asc' }],
        select: { id: true, status: true, uniqueLinksOnly: true, vendor: { select: { id: true, name: true, code: true } }, projectCountry: { select: { id: true, countryCode: true } } },
      }),
      this.prisma.uniqueLink.groupBy({ by: ['vendorAllocationId', 'status'], where: { projectId }, _count: { _all: true } }),
      this.prisma.uniqueLink.groupBy({ by: ['vendorAllocationId'], where: { projectId, status: 'UNUSED', batch: { expiresAt: { lt: now } } }, _count: { _all: true } }),
      this.prisma.uniqueLinkBatch.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.uniqueLink.groupBy({ by: ['batchId', 'status'], where: { projectId }, _count: { _all: true } }),
      this.prisma.respondentSession.groupBy({ by: ['vendorAllocationId', 'status'], where: { projectId, uniqueLinkId: { not: null } }, _count: { _all: true } }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: batches.map((b) => b.createdById).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const who = new Map(users.map((x) => [x.id, x.name]));
    const count = (rows: { _count: { _all: number } }[]) => rows.reduce((n, r) => n + r._count._all, 0);
    const byAlloc = new Map(allocations.map((a) => [a.id, a]));
    return {
      linkBase: `${config.publicBaseUrl}/u/`,
      maxPerBatch: MAX_PER_BATCH,
      allocations: allocations.map((a) => {
        const mine = grouped.filter((g) => g.vendorAllocationId === a.id);
        const exp = count(expired.filter((e) => e.vendorAllocationId === a.id));
        const st = (s: UniqueLinkStatus) => count(mine.filter((g) => g.status === s));
        const res = outcomes.filter((o) => o.vendorAllocationId === a.id);
        return {
          ...a,
          total: count(mine),
          unused: st('UNUSED') - exp,
          used: st('USED'),
          revoked: st('REVOKED'),
          expired: exp,
          completes: count(res.filter((o) => o.status === 'COMPLETE')),
          inSurvey: count(res.filter((o) => o.status === 'STARTED')),
        };
      }),
      batches: batches.map((b) => {
        const mine = batchCounts.filter((g) => g.batchId === b.id);
        const st = (s: UniqueLinkStatus) => count(mine.filter((g) => g.status === s));
        const a = byAlloc.get(b.vendorAllocationId);
        const isExpired = !!b.expiresAt && b.expiresAt < now;
        return {
          id: b.id,
          label: b.label,
          allocationId: b.vendorAllocationId,
          vendor: a?.vendor.name ?? '',
          countryCode: a?.projectCountry.countryCode ?? '',
          count: b.count,
          unused: isExpired ? 0 : st('UNUSED'),
          used: st('USED'),
          revoked: st('REVOKED'),
          expired: isExpired ? st('UNUSED') : 0,
          expiresAt: b.expiresAt,
          createdAt: b.createdAt,
          createdBy: b.createdById ? who.get(b.createdById) ?? null : null,
        };
      }),
    };
  }

  where(projectId: string, f: Omit<Filters, 'skip' | 'take'>): Prisma.UniqueLinkWhereInput {
    const now = new Date();
    const status: Prisma.UniqueLinkWhereInput =
      f.status === 'EXPIRED'
        ? { status: 'UNUSED', batch: { expiresAt: { lt: now } } }
        : f.status === 'UNUSED'
          ? { status: 'UNUSED', batch: { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] } }
          : f.status
            ? { status: f.status }
            : {};
    return {
      projectId,
      ...(f.allocationId ? { vendorAllocationId: f.allocationId } : {}),
      ...(f.batchId ? { batchId: f.batchId } : {}),
      ...(f.q ? { key: { startsWith: f.q.replace(/^.*\/u\//, '') } } : {}),
      ...status,
    };
  }

  async list(organizationId: string, projectId: string, f: Filters) {
    await this.project(organizationId, projectId);
    const where = this.where(projectId, f);
    const [total, rows] = await Promise.all([
      this.prisma.uniqueLink.count({ where }),
      this.prisma.uniqueLink.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: f.skip, take: f.take, select: LINK_SELECT }),
    ]);
    const now = new Date();
    return { total, rows: rows.map((l) => ({ ...l, url: linkUrl(l.key), shownStatus: shownStatus(l, now) })) };
  }

  /** Every matching link, oldest first, read in pages so a 50,000-link batch does not load at once. */
  async *allRows(where: Prisma.UniqueLinkWhereInput) {
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.uniqueLink.findMany({ where, orderBy: { id: 'asc' }, take: 5_000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: LINK_SELECT });
      if (!page.length) return;
      yield page;
      cursor = page[page.length - 1].id;
    }
  }

  async exportCsv(organizationId: string, projectId: string, f: Omit<Filters, 'skip' | 'take'>, res: Response) {
    const p = await this.project(organizationId, projectId);
    const where = this.where(projectId, f);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${`${p.projectCode}-unique-links.csv`.replace(/[^\w.-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.write(`﻿${toCsv([CSV_HEADER])}\r\n`);
    for await (const page of this.allRows(where)) res.write(`${toCsv(csvRows(page))}\r\n`);
    res.end();
  }

  /** Revokes links nobody has used yet. Used links keep their history. */
  async revoke(u: AuthUser, projectId: string, body: z.infer<typeof revokeSchema>) {
    await this.project(u.organizationId, projectId);
    const r = await this.prisma.uniqueLink.updateMany({
      where: { projectId, status: 'UNUSED', ...(body.batchId ? { batchId: body.batchId } : { id: { in: body.linkIds } }) },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'unique-links.revoke', entityType: 'Project', entityId: projectId, detail: { batchId: body.batchId, links: body.linkIds?.length, revoked: r.count } });
    return { revoked: r.count };
  }

  async setOnly(u: AuthUser, projectId: string, allocationId: string, uniqueLinksOnly: boolean) {
    await this.project(u.organizationId, projectId);
    const a = await this.allocation(projectId, allocationId);
    const updated = await this.prisma.vendorAllocation.update({ where: { id: a.id }, data: { uniqueLinksOnly }, select: { id: true, uniqueLinksOnly: true } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'allocation.unique-links-only', entityType: 'VendorAllocation', entityId: a.id, detail: { uniqueLinksOnly, vendor: a.vendor.name, country: a.projectCountry.countryCode } });
    return updated;
  }
}

@Controller('projects/:id/unique-links')
export class UniqueLinksController {
  constructor(private readonly svc: UniqueLinksService) {}

  @Get('summary')
  summary(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.summary(u.organizationId, id);
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query(new ZodPipe(listSchema)) q: Filters) {
    return this.svc.list(u.organizationId, id, q);
  }

  @Get('export.csv')
  async export(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query(new ZodPipe(listSchema)) q: Filters, @Res() res: Response) {
    const { skip: _s, take: _t, ...filters } = q;
    await this.svc.exportCsv(u.organizationId, id, filters, res);
  }

  @Post()
  @Roles(...EDITORS)
  generate(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(generateSchema)) body: z.infer<typeof generateSchema>) {
    return this.svc.generate(u, id, body);
  }

  @Post('revoke')
  @Roles(...EDITORS)
  revoke(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(revokeSchema)) body: z.infer<typeof revokeSchema>) {
    return this.svc.revoke(u, id, body);
  }

  @Post('allocations/:allocationId/only')
  @Roles(...EDITORS)
  only(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('allocationId') allocationId: string, @Body(new ZodPipe(onlySchema)) body: z.infer<typeof onlySchema>) {
    return this.svc.setOnly(u, id, allocationId, body.uniqueLinksOnly);
  }
}

@Module({ controllers: [UniqueLinksController], providers: [UniqueLinksService], exports: [UniqueLinksService] })
export class UniqueLinksModule {}
