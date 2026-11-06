import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Module, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { BrandingService } from '../branding/branding';
import { fileSlug } from '../pdf/pdf';
import { renderReportPdf } from '../pdf/report-pdf';
import { PrismaService } from '../prisma/prisma.service';
import { REPORT_GROUP, ReportKind, REPORTS } from '../schedules/schedule.rules';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { CURRENCY_NOTE, filterSchema, GROUPS, listSchema, ReportFilter, ReportsService } from './reports.service';

const groupSchema = z.object({ groupBy: z.enum(GROUPS).default('client') });
const pdfSchema = z.object({
  report: z.enum(Object.keys(REPORTS) as [ReportKind, ...ReportKind[]]).default('overall'),
  title: z.string().trim().max(120).optional(),
  /** The browser's time zone, for the "generated" line. */
  tz: z.string().max(64).optional(),
  money: z.enum(['market', 'reporting']).default('market'),
});
type List = z.infer<typeof listSchema>;

/** Staff-only (the global guard's default). Portal users get their own scoped views in the portal module. */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
    private readonly branding: BrandingService,
  ) {}

  @Get('options')
  options(@CurrentUser() u: AuthUser) {
    return this.reports.options(u.organizationId);
  }

  @Get('overall')
  overall(@CurrentUser() u: AuthUser, @Query(new ZodPipe(filterSchema)) f: ReportFilter) {
    return this.reports.overall(u.organizationId, f);
  }

  /** Grouped report. The client report is groupBy=client, the vendor report groupBy=vendor or vendor_country. */
  @Get('summary')
  async summary(@CurrentUser() u: AuthUser, @Query(new ZodPipe(filterSchema)) f: ReportFilter, @Query(new ZodPipe(groupSchema)) g: z.infer<typeof groupSchema>) {
    const [rows, totals, fx] = await Promise.all([this.reports.summary(u.organizationId, f, g.groupBy), this.reports.summary(u.organizationId, f, null), this.reports.fxInfo(u.organizationId)]);
    return { groupBy: g.groupBy, rows, totals: totals[0] ?? null, currencyNote: CURRENCY_NOTE, fx };
  }

  @Get('conversion')
  conversion(@CurrentUser() u: AuthUser, @Query(new ZodPipe(filterSchema)) f: ReportFilter, @Query(new ZodPipe(listSchema)) l: List) {
    return this.reports.conversion(u.organizationId, f, l);
  }

  /** The grouped report as a landscape PDF (same numbers as the screen and the CSV). */
  @Get('pdf')
  async pdf(@CurrentUser() u: AuthUser, @Query(new ZodPipe(filterSchema)) f: ReportFilter, @Query(new ZodPipe(pdfSchema)) p: z.infer<typeof pdfSchema>, @Res() res: Response) {
    const g = REPORT_GROUP[p.report];
    const [rows, totals, org, labels, fx] = await Promise.all([
      this.reports.summary(u.organizationId, f, g.groupBy),
      this.reports.summary(u.organizationId, f, null),
      this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { name: true } }),
      this.reports.labels(u.organizationId, f),
      this.reports.fxInfo(u.organizationId),
    ]);
    const brand = await this.branding.brand(u.organizationId);
    const ordered = p.report === 'overall' ? [...rows].sort((a, b) => b.completes - a.completes || b.clicks - a.clicks) : rows;
    let generated: string;
    try {
      generated = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: p.tz || 'UTC', timeZoneName: 'short' }).format(new Date());
    } catch {
      generated = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    }
    const title = p.title || `${REPORTS[p.report]} report`;
    const buf = await renderReportPdf({ org: org.name, appName: brand.appName, custom: brand.custom, title, reportLabel: REPORTS[p.report], from: f.from ?? null, to: f.to ?? null, filters: labels, totals: totals[0] ?? null, rows: ordered, rowLabel: g.rowLabel, generated, moneyMode: p.money, fx });
    const name = `${fileSlug(title)}${f.from ? `-${f.from}` : ''}${f.to && f.to !== f.from ? `-to-${f.to}` : ''}.pdf`;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
    res.send(buf);
  }

  @Get('clicks')
  clicks(@CurrentUser() u: AuthUser, @Query(new ZodPipe(filterSchema)) f: ReportFilter, @Query(new ZodPipe(listSchema)) l: List) {
    return this.reports.clicks(u.organizationId, f, l);
  }
}

const VIEW_TABS = ['Overall', 'Conversion', 'Clients', 'Vendors', 'Clicks'] as const;
const VIEW_PERIODS = ['today', '7', '30', '90', 'month', 'all', 'custom'] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const viewFilters = z
  .object({ from: day.optional(), to: day.optional(), clientId: z.string().max(64).optional(), vendorId: z.string().max(64).optional(), projectId: z.string().max(64).optional(), countryCode: z.string().regex(/^[A-Z]{2}$/).optional() })
  .strict();
const viewSchema = z
  .object({ name: z.string().trim().min(1, 'Give the view a name').max(80), tab: z.enum(VIEW_TABS), period: z.enum(VIEW_PERIODS), filters: viewFilters.default({}), shared: z.boolean().default(false) })
  .strict()
  .superRefine((v, ctx) => {
    if (v.period === 'custom' && (!v.filters.from || !v.filters.to)) ctx.addIssue({ code: 'custom', message: 'A custom period needs both dates', path: ['filters'] });
  });
const viewPatch = z.object({ name: z.string().trim().min(1).max(80).optional(), shared: z.boolean().optional() }).strict();
const MAX_VIEWS = 50;

/**
 * Saved report views (docs/REPORT_VIEWS.md): a name, a tab, a relative period ("last 30 days" stays
 * current) and filters. Private by default; shared views are listed for every staff member, and only
 * their owner or an admin changes them.
 */
@Controller('reports/views')
export class ReportViewsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private shape(v: Prisma.SavedReportViewGetPayload<{ include: { owner: { select: { id: true; name: true } } } }>, u: AuthUser) {
    return { id: v.id, name: v.name, tab: v.tab, period: v.period, filters: v.filters, shared: v.shared, owner: v.owner.name, mine: v.ownerId === u.id, canEdit: v.ownerId === u.id || u.role === 'ADMIN', updatedAt: v.updatedAt };
  }

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.savedReportView.findMany({
      where: { organizationId: u.organizationId, OR: [{ ownerId: u.id }, { shared: true }] },
      include: { owner: { select: { id: true, name: true } } },
      orderBy: [{ name: 'asc' }],
    });
    return rows.map((v) => this.shape(v, u)).sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));
  }

  /** Filters must point at this organisation's own records. */
  private async check(u: AuthUser, f: z.infer<typeof viewFilters>) {
    const org = u.organizationId;
    const [c, v, p] = await Promise.all([
      f.clientId ? this.prisma.client.count({ where: { id: f.clientId, organizationId: org } }) : 1,
      f.vendorId ? this.prisma.vendor.count({ where: { id: f.vendorId, organizationId: org } }) : 1,
      f.projectId ? this.prisma.project.count({ where: { id: f.projectId, organizationId: org } }) : 1,
    ]);
    if (!c || !v || !p) throw new BadRequestException('A filter points at a record that does not exist');
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(viewSchema)) b: z.infer<typeof viewSchema>) {
    await this.check(u, b.filters);
    if ((await this.prisma.savedReportView.count({ where: { organizationId: u.organizationId, ownerId: u.id } })) >= MAX_VIEWS) throw new BadRequestException(`Up to ${MAX_VIEWS} views each`);
    // Relative periods keep no dates: "last 30 days" moves with the calendar.
    const filters = b.period === 'custom' ? b.filters : { ...b.filters, from: undefined, to: undefined };
    const v = await this.prisma.savedReportView.create({
      data: { organizationId: u.organizationId, ownerId: u.id, name: b.name, tab: b.tab, period: b.period, filters: JSON.parse(JSON.stringify(filters)), shared: b.shared },
      include: { owner: { select: { id: true, name: true } } },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'report_view.create', entityType: 'SavedReportView', entityId: v.id, detail: { name: v.name, shared: v.shared } });
    return this.shape(v, u);
  }

  private async editable(u: AuthUser, id: string) {
    const v = await this.prisma.savedReportView.findFirst({ where: { id, organizationId: u.organizationId, OR: [{ ownerId: u.id }, { shared: true }] } });
    if (!v) throw new NotFoundException('View not found');
    if (v.ownerId !== u.id && u.role !== 'ADMIN') throw new ForbiddenException('Only the person who saved this view, or an admin, can change it');
    return v;
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(viewPatch)) b: z.infer<typeof viewPatch>) {
    await this.editable(u, id);
    const v = await this.prisma.savedReportView.update({ where: { id }, data: b, include: { owner: { select: { id: true, name: true } } } });
    return this.shape(v, u);
  }

  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const v = await this.editable(u, id);
    await this.prisma.savedReportView.delete({ where: { id } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'report_view.delete', entityType: 'SavedReportView', entityId: id, detail: { name: v.name } });
    return { ok: true };
  }
}

@Module({ controllers: [ReportViewsController, ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}
