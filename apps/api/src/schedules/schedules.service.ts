import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Logger, Module, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma, ReportSchedule } from '@prisma/client';
import { BrandingService } from '../branding/branding';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { config } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { MailNotConfigured, MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsModule } from '../reports/reports.controller';
import { GroupBy, ReportsService } from '../reports/reports.service';
import { renderReportPdf } from '../pdf/report-pdf';
import { renderEmail, toCsv } from './report-email';
import { describe, nextRunAt, Period, PERIODS, periodRange, REPORT_GROUP, ReportKind, REPORTS, scheduleSchema, ScheduleInput } from './schedule.rules';

const MAX_SCHEDULES = 50;
const GROUP = REPORT_GROUP;
type Filters = { clientId?: string; vendorId?: string; projectId?: string };

@Injectable()
export class SchedulesService {
  private readonly log = new Logger(SchedulesService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly branding: BrandingService,
  ) {}

  @Interval(60_000)
  async tick() {
    if (!config.reportSchedulerEnabled || this.running) return;
    this.running = true;
    try {
      await this.runDue();
    } catch (e) {
      this.log.error(`Report scheduler failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Sends every schedule that is due. Each one is claimed by moving its nextRunAt forward with a
   * guarded update, so two API instances never send the same email twice.
   */
  async runDue(now = new Date()): Promise<number> {
    const due = await this.prisma.reportSchedule.findMany({ where: { active: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: 'asc' }, take: 20 });
    let sent = 0;
    for (const s of due) {
      const claimed = await this.prisma.reportSchedule.updateMany({ where: { id: s.id, active: true, nextRunAt: s.nextRunAt }, data: { nextRunAt: nextRunAt(s, now), lastRunAt: now } });
      if (!claimed.count) continue;
      const r = await this.run(s, 'scheduled', now);
      if (r.status === 'SENT') sent++;
    }
    return sent;
  }

  /** Builds and emails one report, and records the run. Never throws for mail problems. */
  async run(s: ReportSchedule, trigger: 'scheduled' | 'manual', now = new Date()) {
    const { from, to } = periodRange(s.period as Period, s.timezone, now);
    let status = 'SENT';
    let error: string | null = null;
    let rows = 0;
    try {
      const built = await this.build(s, from, to);
      rows = built.rows;
      if (s.skipEmpty && built.clicks === 0) status = 'SKIPPED';
      else {
        const attachments: { filename: string; content: string | Buffer; contentType: string }[] = [{ filename: built.filename, content: built.csv, contentType: 'text/csv' }];
        if (s.attachPdf) attachments.push({ filename: built.filename.replace(/\.csv$/, '.pdf'), content: await built.pdf(), contentType: 'application/pdf' });
        await this.mail.send({ organizationId: s.organizationId, to: s.recipients, subject: built.subject, html: built.html, text: built.text, attachments, fromName: built.brand.emailFromName, replyTo: built.brand.emailReplyTo });
      }
    } catch (e) {
      status = 'FAILED';
      error = e instanceof MailNotConfigured ? e.message : `Could not send: ${(e as Error).message}`.slice(0, 500);
      this.log.warn(`Schedule ${s.id}: ${error}`);
    }
    return this.prisma.reportRun.create({ data: { scheduleId: s.id, status, trigger, from, to, rows, recipients: s.recipients, error } });
  }

  async build(s: Pick<ReportSchedule, 'organizationId' | 'name' | 'report' | 'filters' | 'frequency' | 'dayOfWeek' | 'dayOfMonth' | 'hour' | 'timezone'>, from: string, to: string) {
    const kind = s.report as ReportKind;
    const f = { ...(s.filters as Filters), from, to };
    const [rows, totals, org, labels, brand] = await Promise.all([
      this.reports.summary(s.organizationId, f, GROUP[kind].groupBy),
      this.reports.summary(s.organizationId, f, null),
      this.prisma.organization.findUniqueOrThrow({ where: { id: s.organizationId }, select: { name: true } }),
      this.filterLabels(s.organizationId, s.filters as Filters),
      this.branding.brand(s.organizationId),
    ]);
    const ordered = kind === 'overall' ? [...rows].sort((a, b) => b.completes - a.completes || b.clicks - a.clicks) : rows;
    const email = renderEmail({
      org: org.name, name: s.name, reportLabel: REPORTS[kind], from, to, filters: labels, totals: totals[0] ?? null, rows: ordered, rowLabel: GROUP[kind].rowLabel,
      appUrl: brand.webBase, appName: brand.appName, logoUrl: brand.logoUrl, schedule: describe(s),
    });
    const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'report';
    const pdf = () =>
      renderReportPdf({ org: org.name, title: s.name, reportLabel: REPORTS[kind], from, to, filters: labels, totals: totals[0] ?? null, rows: ordered, rowLabel: GROUP[kind].rowLabel, generated: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' });
    return { ...email, brand, pdf, csv: toCsv(ordered), filename: `${slug}-${from}${from === to ? '' : `-to-${to}`}.csv`, rows: ordered.length, clicks: totals[0]?.clicks ?? 0 };
  }

  private filterLabels(org: string, f: Filters) {
    return this.reports.labels(org, f);
  }

  /** Filters must point at this organization's own records. */
  async checkFilters(org: string, f: Filters) {
    const bad = (
      await Promise.all([
        f.clientId && !(await this.prisma.client.count({ where: { id: f.clientId, organizationId: org } })) && 'client',
        f.vendorId && !(await this.prisma.vendor.count({ where: { id: f.vendorId, organizationId: org } })) && 'vendor',
        f.projectId && !(await this.prisma.project.count({ where: { id: f.projectId, organizationId: org } })) && 'project',
      ])
    ).filter(Boolean);
    if (bad.length) throw new BadRequestException(`Unknown ${bad.join(', ')}`);
  }
}

const view = (s: ReportSchedule & { runs?: { status: string; error: string | null; createdAt: Date; from: string; to: string }[] }) => ({
  id: s.id, name: s.name, report: s.report, period: s.period, filters: s.filters, frequency: s.frequency, dayOfWeek: s.dayOfWeek, dayOfMonth: s.dayOfMonth,
  hour: s.hour, timezone: s.timezone, recipients: s.recipients, skipEmpty: s.skipEmpty, attachPdf: s.attachPdf, active: s.active, nextRunAt: s.active ? s.nextRunAt : null,
  lastRunAt: s.lastRunAt, schedule: describe(s), lastRun: s.runs?.[0] ?? null,
});
const patchSchema = z.object({ active: z.boolean() }).strict();

@Controller('report-schedules')
export class SchedulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedules: SchedulesService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly branding: BrandingService,
  ) {}

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.reportSchedule.findMany({
      where: { organizationId: u.organizationId },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, error: true, createdAt: true, from: true, to: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      schedules: rows.map(view),
      mail: await this.mail.status(u.organizationId),
      reports: Object.entries(REPORTS).map(([id, label]) => ({ id, label })),
      periods: Object.entries(PERIODS).map(([id, label]) => ({ id, label })),
    };
  }

  @Post()
  @Roles(...EDITORS)
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(scheduleSchema)) body: ScheduleInput) {
    if ((await this.prisma.reportSchedule.count({ where: { organizationId: u.organizationId } })) >= MAX_SCHEDULES) throw new BadRequestException(`Up to ${MAX_SCHEDULES} schedules`);
    await this.schedules.checkFilters(u.organizationId, body.filters);
    const s = await this.prisma.reportSchedule.create({ data: { ...this.data(body), organizationId: u.organizationId, createdById: u.id, nextRunAt: nextRunAt(body, new Date()) } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'report_schedule.create', entityType: 'ReportSchedule', entityId: s.id, detail: { name: s.name, recipients: s.recipients } });
    return view(s);
  }

  @Put(':id')
  @Roles(...EDITORS)
  async replace(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(scheduleSchema)) body: ScheduleInput) {
    await this.own(u, id);
    await this.schedules.checkFilters(u.organizationId, body.filters);
    const s = await this.prisma.reportSchedule.update({ where: { id }, data: { ...this.data(body), nextRunAt: nextRunAt(body, new Date()) } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'report_schedule.update', entityType: 'ReportSchedule', entityId: id, detail: { name: s.name, recipients: s.recipients } });
    return view(s);
  }

  /** Pause or resume. Resuming starts from the next send time after now (no catch-up burst). */
  @Patch(':id')
  @Roles(...EDITORS)
  async toggle(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(patchSchema)) body: z.infer<typeof patchSchema>) {
    const cur = await this.own(u, id);
    const s = await this.prisma.reportSchedule.update({ where: { id }, data: { active: body.active, ...(body.active ? { nextRunAt: nextRunAt(cur, new Date()) } : {}) } });
    return view(s);
  }

  @Delete(':id')
  @Roles(...EDITORS)
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const s = await this.own(u, id);
    await this.prisma.reportSchedule.delete({ where: { id } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'report_schedule.delete', entityType: 'ReportSchedule', entityId: id, detail: { name: s.name } });
    return { ok: true };
  }

  /** Send it now to the same recipients, for the period as of now. Does not move the schedule. */
  @Post(':id/send')
  @Roles(...EDITORS)
  @HttpCode(200)
  async send(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.schedules.run(await this.own(u, id), 'manual');
  }

  /** The email as it would look now, without sending. */
  @Get(':id/preview')
  async preview(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const s = await this.own(u, id);
    const { from, to } = periodRange(s.period as Period, s.timezone, new Date());
    const b = await this.schedules.build(s, from, to);
    return { subject: b.subject, html: b.html, filename: b.filename, rows: b.rows, from, to };
  }

  @Get(':id/runs')
  async runs(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.own(u, id);
    return this.prisma.reportRun.findMany({ where: { scheduleId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  /** Admins: check the Zoho Mail settings by sending a short email to yourself. */
  @Post('test-email')
  @Roles('ADMIN')
  @HttpCode(200)
  async testEmail(@CurrentUser() u: AuthUser) {
    try {
      const brand = await this.branding.brand(u.organizationId);
      await this.mail.send({
        organizationId: u.organizationId,
        to: [u.email],
        subject: `${brand.appName} test email`,
        text: `Your ${brand.appName} email settings work. Scheduled reports will be sent from this address.`,
        html: `<p>Your ${brand.appName} email settings work. Scheduled reports will be sent from this address.</p>`,
        fromName: brand.emailFromName,
        replyTo: brand.emailReplyTo,
      });
      return { ok: true, to: u.email };
    } catch (e) {
      throw new BadRequestException(e instanceof MailNotConfigured ? e.message : `Could not send: ${(e as Error).message}`);
    }
  }

  private data(b: ScheduleInput): Omit<Prisma.ReportScheduleUncheckedCreateInput, 'organizationId' | 'createdById' | 'nextRunAt'> {
    return {
      name: b.name, report: b.report, period: b.period, filters: b.filters as Prisma.InputJsonValue, frequency: b.frequency,
      dayOfWeek: b.frequency === 'weekly' ? b.dayOfWeek! : null, dayOfMonth: b.frequency === 'monthly' ? b.dayOfMonth! : null,
      hour: b.hour, timezone: b.timezone, recipients: [...new Set(b.recipients)], skipEmpty: b.skipEmpty, attachPdf: b.attachPdf, active: b.active,
    };
  }

  private async own(u: AuthUser, id: string) {
    const s = await this.prisma.reportSchedule.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!s) throw new NotFoundException('Schedule not found');
    return s;
  }
}

@Module({ imports: [ReportsModule], controllers: [SchedulesController], providers: [SchedulesService], exports: [SchedulesService] })
export class SchedulesModule {}
