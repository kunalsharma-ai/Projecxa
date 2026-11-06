/**
 * Quote requests (spec module 9: feasibility and CPI quotes). Staff ask vendors what they can deliver
 * in a project market and at what CPI; vendors answer in their portal; staff compare the answers with
 * the client CPI and accept one, which creates the vendor link at the quoted CPI.
 *
 * A vendor sees the brief (market, LOI, IR, target group, completes wanted) but never the client,
 * the client CPI or other vendors' quotes.
 */
import { BrandingService } from '../branding/branding';
import { BadRequestException, Body, Controller, Get, Injectable, Logger, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Prisma, QuoteRequestStatus } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { config } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { MailNotConfigured, MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsModule } from '../projects/projects.controller';
import { ProjectsService } from '../projects/projects.service';

const OPEN_PROJECT = ['DRAFT', 'TEST', 'LIVE', 'HOLD'] as const;
const money = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

const askSchema = z
  .object({
    vendorIds: z.array(z.string().min(1)).min(1).max(30),
    completesWanted: z.number().int().min(1).max(1_000_000).optional(),
    respondBy: z.coerce.date().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();
const acceptSchema = z.object({ targetCompletes: z.number().int().min(1).max(1_000_000).optional() }).strict();
const answerSchema = z.union([
  z.object({ decline: z.literal(true), note: z.string().trim().max(2000).optional() }).strict(),
  z
    .object({
      cpi: z.number().positive().max(100_000),
      feasibleCompletes: z.number().int().min(1).max(1_000_000),
      daysNeeded: z.number().int().min(1).max(365).optional(),
      note: z.string().trim().max(2000).optional(),
    })
    .strict(),
]);

@Injectable()
export class QuotesService {
  private readonly log = new Logger(QuotesService.name);
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly mail: MailService, private readonly projects: ProjectsService, private readonly branding: BrandingService) {}

  private async market(u: AuthUser, projectId: string, countryId: string) {
    const c = await this.prisma.projectCountry.findFirst({
      where: { id: countryId, projectId, project: { organizationId: u.organizationId } },
      include: { project: { select: { id: true, projectCode: true, name: true, status: true, category: true } }, allocations: { select: { vendorId: true } } },
    });
    if (!c) throw new NotFoundException('Market not found');
    return c;
  }

  /** Quotes for one market, with the margin each would leave on the client CPI. */
  async forMarket(u: AuthUser, projectId: string, countryId: string) {
    const c = await this.market(u, projectId, countryId);
    const rows = await this.prisma.quoteRequest.findMany({ where: { projectCountryId: c.id }, include: { vendor: { select: { id: true, name: true, code: true } } }, orderBy: [{ status: 'asc' }, { cpi: 'asc' }] });
    const clientCpi = Number(c.cpi);
    return {
      market: { id: c.id, countryCode: c.countryCode, currency: c.currency, clientCpi, targetCompletes: c.targetCompletes, completes: c.completes, loiMinutes: c.loiMinutes, irPercent: c.irPercent },
      quotes: rows.map((q) => {
        const cpi = money(q.cpi);
        return {
          id: q.id,
          vendor: q.vendor,
          status: q.status,
          completesWanted: q.completesWanted,
          respondBy: q.respondBy,
          cpi,
          feasibleCompletes: q.feasibleCompletes,
          daysNeeded: q.daysNeeded,
          vendorNote: q.vendorNote,
          respondedAt: q.respondedAt,
          createdAt: q.createdAt,
          marginPercent: cpi !== null && clientCpi > 0 ? Math.round(((clientCpi - cpi) / clientCpi) * 1000) / 10 : null,
          allocationId: q.allocationId,
        };
      }),
    };
  }

  /** Asks vendors for a quote. Asking a vendor again (after a decline or a close) reopens its request. */
  async ask(u: AuthUser, projectId: string, countryId: string, b: z.infer<typeof askSchema>) {
    const c = await this.market(u, projectId, countryId);
    if (!(OPEN_PROJECT as readonly string[]).includes(c.project.status)) throw new BadRequestException('This project is closed');
    const vendors = await this.prisma.vendor.findMany({ where: { id: { in: b.vendorIds }, organizationId: u.organizationId, status: 'ACTIVE' }, select: { id: true, name: true } });
    if (vendors.length !== new Set(b.vendorIds).size) throw new BadRequestException('Pick active vendors of your organisation');
    const allocated = new Set(c.allocations.map((a) => a.vendorId));
    const already = vendors.filter((v) => allocated.has(v.id));
    if (already.length) throw new BadRequestException(`${already.map((v) => v.name).join(', ')} already ${already.length === 1 ? 'has' : 'have'} a link in this market`);
    if (b.respondBy && b.respondBy.getTime() < Date.now()) throw new BadRequestException('Pick a reply-by time in the future');
    const wanted = b.completesWanted ?? Math.max(1, c.targetCompletes - c.completes);
    const brief = { completesWanted: wanted, loiMinutes: c.loiMinutes, irPercent: c.irPercent, targetGroup: c.targetGroup, note: b.note || null, respondBy: b.respondBy ?? null, currency: c.currency };
    const created: string[] = [];
    for (const v of vendors) {
      const existing = await this.prisma.quoteRequest.findUnique({ where: { projectCountryId_vendorId: { projectCountryId: c.id, vendorId: v.id } } });
      if (existing && existing.status === 'ACCEPTED') continue;
      if (existing && (existing.status === 'REQUESTED' || existing.status === 'QUOTED')) continue;
      const q = existing
        ? await this.prisma.quoteRequest.update({ where: { id: existing.id }, data: { ...brief, status: 'REQUESTED', requestedById: u.id, cpi: null, feasibleCompletes: null, daysNeeded: null, vendorNote: null, respondedAt: null, respondedById: null } })
        : await this.prisma.quoteRequest.create({ data: { ...brief, organizationId: u.organizationId, projectCountryId: c.id, vendorId: v.id, requestedById: u.id } });
      created.push(q.id);
      await this.emailVendor(v.id, `Quote request: ${c.countryCode} · ${c.project.category} · LOI ${c.loiMinutes} min`, `${u.name} asks for your CPI and feasibility for ${wanted} completes in ${c.countryCode} (LOI ${c.loiMinutes} min, IR ${c.irPercent}%${c.targetGroup ? `, ${c.targetGroup}` : ''}).${b.respondBy ? ` Please answer by ${b.respondBy.toISOString().slice(0, 16).replace('T', ' ')} UTC.` : ''}`);
    }
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'quote.request', entityType: 'ProjectCountry', entityId: c.id, detail: { vendors: vendors.map((v) => v.id), sent: created.length, completesWanted: wanted } });
    return this.forMarket(u, projectId, countryId);
  }

  private async quote(u: AuthUser, id: string) {
    const q = await this.prisma.quoteRequest.findFirst({ where: { id, organizationId: u.organizationId }, include: { projectCountry: { select: { id: true, projectId: true, countryCode: true, completes: true, targetCompletes: true } }, vendor: { select: { name: true } } } });
    if (!q) throw new NotFoundException('Quote not found');
    return q;
  }

  /** Creates the vendor link at the quoted CPI for the feasible completes (or the target given). */
  async accept(u: AuthUser, id: string, b: z.infer<typeof acceptSchema>) {
    const q = await this.quote(u, id);
    if (q.status !== 'QUOTED' || q.cpi === null || !q.feasibleCompletes) throw new BadRequestException('Only an answered quote can be accepted');
    const target = b.targetCompletes ?? Math.min(q.feasibleCompletes, q.completesWanted);
    const alloc = await this.projects.addAllocation(u, q.projectCountry.projectId, q.projectCountry.id, { vendorId: q.vendorId, cpi: Number(q.cpi), targetCompletes: target, uidParam: 'vid', allowAboveCpi: true });
    await this.prisma.quoteRequest.update({ where: { id: q.id }, data: { status: 'ACCEPTED', allocationId: alloc.id } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'quote.accept', entityType: 'QuoteRequest', entityId: q.id, detail: { allocationId: alloc.id, cpi: Number(q.cpi), targetCompletes: target } });
    await this.emailVendor(q.vendorId, `Quote accepted: ${q.projectCountry.countryCode}`, `Your quote of ${q.currency} ${Number(q.cpi).toFixed(2)} for ${target} completes in ${q.projectCountry.countryCode} was accepted. The entry link is in your portal.`);
    return { ok: true, allocationId: alloc.id, targetCompletes: target };
  }

  async close(u: AuthUser, id: string) {
    const q = await this.quote(u, id);
    if (q.status === 'ACCEPTED') throw new BadRequestException('An accepted quote cannot be closed');
    await this.prisma.quoteRequest.update({ where: { id: q.id }, data: { status: 'CLOSED' } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'quote.close', entityType: 'QuoteRequest', entityId: q.id, detail: {} });
    return { ok: true };
  }

  // ─────────────── Vendor portal ───────────────

  private async vendorId(u: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { vendorId: true } });
    if (!user.vendorId) throw new NotFoundException();
    return user.vendorId;
  }

  async forVendor(u: AuthUser, status?: QuoteRequestStatus) {
    const vendorId = await this.vendorId(u);
    const rows = await this.prisma.quoteRequest.findMany({
      where: { organizationId: u.organizationId, vendorId, ...(status ? { status } : {}) },
      orderBy: [{ updatedAt: 'desc' }],
      take: 300,
      include: { projectCountry: { select: { countryCode: true, language: true, project: { select: { projectCode: true, name: true, category: true } } } } },
    });
    return rows.map((q) => ({
      id: q.id,
      status: q.status,
      project: q.projectCountry.project,
      countryCode: q.projectCountry.countryCode,
      language: q.projectCountry.language,
      completesWanted: q.completesWanted,
      loiMinutes: q.loiMinutes,
      irPercent: q.irPercent,
      targetGroup: q.targetGroup,
      note: q.note,
      respondBy: q.respondBy,
      overdue: q.status === 'REQUESTED' && !!q.respondBy && q.respondBy.getTime() < Date.now(),
      currency: q.currency,
      cpi: money(q.cpi),
      feasibleCompletes: q.feasibleCompletes,
      daysNeeded: q.daysNeeded,
      vendorNote: q.vendorNote,
      respondedAt: q.respondedAt,
      createdAt: q.createdAt,
    }));
  }

  async answer(u: AuthUser, id: string, b: z.infer<typeof answerSchema>) {
    const vendorId = await this.vendorId(u);
    const q = await this.prisma.quoteRequest.findFirst({ where: { id, organizationId: u.organizationId, vendorId } });
    if (!q) throw new NotFoundException('Quote request not found');
    if (q.status !== 'REQUESTED' && q.status !== 'QUOTED' && q.status !== 'DECLINED') throw new BadRequestException('This request is no longer open');
    const now = new Date();
    const data =
      'decline' in b
        ? { status: 'DECLINED' as const, cpi: null, feasibleCompletes: null, daysNeeded: null, vendorNote: b.note || null }
        : { status: 'QUOTED' as const, cpi: new Prisma.Decimal(b.cpi), feasibleCompletes: b.feasibleCompletes, daysNeeded: b.daysNeeded ?? null, vendorNote: b.note || null };
    // Guarded so an answer cannot land on a request staff just accepted or closed.
    const r = await this.prisma.quoteRequest.updateMany({ where: { id: q.id, status: { in: ['REQUESTED', 'QUOTED', 'DECLINED'] } }, data: { ...data, respondedAt: now, respondedById: u.id } });
    if (!r.count) throw new BadRequestException('This request is no longer open');
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'decline' in b ? 'quote.decline' : 'quote.answer', entityType: 'QuoteRequest', entityId: q.id, detail: 'decline' in b ? {} : { cpi: b.cpi, feasibleCompletes: b.feasibleCompletes } });
    return (await this.forVendor(u)).find((x) => x.id === q.id);
  }

  /** Emails the vendor's active portal users, when SMTP is set up. Never blocks the request. */
  private async emailVendor(vendorId: string, subject: string, text: string) {
    try {
      const users = await this.prisma.user.findMany({ where: { vendorId, role: 'VENDOR_USER', active: true }, select: { email: true } });
      if (!users.length) return;
      const v = await this.prisma.vendor.findUniqueOrThrow({ where: { id: vendorId }, select: { organizationId: true } });
      const brand = await this.branding.brand(v.organizationId);
      const link = `${brand.webBase}/portal/quotes`;
      await this.mail.send({ organizationId: v.organizationId, to: users.map((x) => x.email), subject: subject.slice(0, 200), text: `${text}\n\nOpen your portal: ${link}\n`, html: `<p>${esc(text)}</p><p><a href="${esc(link)}">Open your portal</a></p>`, fromName: brand.emailFromName, replyTo: brand.emailReplyTo });
    } catch (e) {
      if (!(e instanceof MailNotConfigured)) this.log.warn(`Quote email failed: ${(e as Error).message}`);
    }
  }
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

@Controller()
export class QuotesController {
  constructor(private readonly svc: QuotesService) {}

  @Get('projects/:projectId/countries/:countryId/quotes')
  list(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @Param('countryId') countryId: string) {
    return this.svc.forMarket(u, projectId, countryId);
  }

  @Post('projects/:projectId/countries/:countryId/quotes')
  @Roles(...EDITORS)
  ask(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @Param('countryId') countryId: string, @Body(new ZodPipe(askSchema)) b: z.infer<typeof askSchema>) {
    return this.svc.ask(u, projectId, countryId, b);
  }

  @Post('quotes/:id/accept')
  @Roles(...EDITORS)
  accept(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(acceptSchema)) b: z.infer<typeof acceptSchema>) {
    return this.svc.accept(u, id, b);
  }

  @Post('quotes/:id/close')
  @Roles(...EDITORS)
  close(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.close(u, id);
  }
}

@Controller('portal/vendor/quotes')
@Roles('VENDOR_USER')
export class VendorQuotesController {
  constructor(private readonly svc: QuotesService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    const s = (['REQUESTED', 'QUOTED', 'DECLINED', 'ACCEPTED', 'CLOSED'] as const).find((x) => x === status);
    return this.svc.forVendor(u, s);
  }

  @Post(':id')
  answer(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(answerSchema)) b: z.infer<typeof answerSchema>) {
    return this.svc.answer(u, id, b);
  }
}

@Module({ imports: [ProjectsModule], controllers: [QuotesController, VendorQuotesController], providers: [QuotesService] })
export class QuotesModule {}
