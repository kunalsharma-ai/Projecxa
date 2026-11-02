import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, NotFoundException, Param, Post, Put, Res } from '@nestjs/common';
import { InvoiceStatus, Prisma, VendorBillStatus } from '@prisma/client';
import { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { money } from '../finance/finance.service';
import { PayablesService } from '../finance/payables.service';
import { PrismaService } from '../prisma/prisma.service';
import { zonedTime } from '../schedules/schedule.rules';
import { accountingConfigSchema, build, configOf, Doc, DocLine, Format, FORMAT_INFO, FORMATS, Kind, MissingRates, PAYMENT_KINDS } from './formats';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31');
export const exportSchema = z
  .object({
    format: z.enum(FORMATS),
    kind: z.enum(['invoices', 'bills', 'both', 'payments_received', 'payments_made']),
    from: day.nullable().optional(),
    to: day.nullable().optional(),
    invoiceStatuses: z.array(z.enum(['SENT', 'PAID'])).min(1).default(['SENT', 'PAID']),
    billStatuses: z.array(z.enum(['APPROVED', 'PAID'])).min(1).default(['APPROVED', 'PAID']),
    /** Leave out documents (or, for payments, payments) that went into an earlier export. */
    onlyNew: z.boolean().default(true),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (FORMAT_INFO[f.format].kinds.includes(f.kind)) return;
    const message = PAYMENT_KINDS.includes(f.kind) ? `${FORMAT_INFO[f.format].label} payments are not supported here. Use Zoho Books, Tally or the general journal.` : 'This format exports invoices and bills as separate files. Pick one.';
    ctx.addIssue({ code: 'custom', message, path: ['kind'] });
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, { message: 'The start date is after the end date', path: ['to'] });
export type ExportFilters = z.infer<typeof exportSchema>;

const MAX_DOCS = 5000;

@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payables: PayablesService,
    private readonly audit: AuditService,
  ) {}

  async config(org: string) {
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { accountingConfig: true } });
    return configOf(o.accountingConfig);
  }

  async saveConfig(u: AuthUser, body: z.infer<typeof accountingConfigSchema>) {
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { accountingConfig: body as Prisma.InputJsonValue } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'accounting.settings', entityType: 'Organization', entityId: u.organizationId, detail: body });
    return body;
  }

  /**
   * Invoices and bills matching the filters, oldest first, in one shape. For a payments export these are
   * the paid documents, filtered by payment date and by whether the payment was exported before.
   */
  async documents(org: string, f: ExportFilters, tz: string) {
    const payments = PAYMENT_KINDS.includes(f.kind);
    const range = (field: 'issuedAt' | 'approvedAt' | 'paidAt'): object => {
      const parse = (s: string) => s.split('-').map(Number) as [number, number, number];
      const gte = f.from ? zonedTime(...parse(f.from), 0, tz) : undefined;
      const lt = f.to ? new Date(zonedTime(...parse(f.to), 0, tz).getTime() + 86_400_000) : undefined;
      if (!gte && !lt) return {};
      const span = { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
      return { OR: [{ [field]: span }, { [field]: null, createdAt: span }] };
    };
    const common = {
      organizationId: org,
      ...(f.onlyNew ? (payments ? { paymentExportedAt: null } : { exportedAt: null }) : {}),
      ...(f.currency ? { currency: f.currency } : {}),
    };
    const wantInvoices = payments ? f.kind === 'payments_received' : f.kind !== 'bills';
    const wantBills = payments ? f.kind === 'payments_made' : f.kind !== 'invoices';
    const invWhere = payments ? { status: 'PAID' as InvoiceStatus, ...range('paidAt') } : { status: { in: f.invoiceStatuses as InvoiceStatus[] }, ...range('issuedAt') };
    const billWhere = payments ? { status: 'PAID' as VendorBillStatus, ...range('paidAt') } : { status: { in: f.billStatuses as VendorBillStatus[] }, ...range('approvedAt') };
    const [invoices, bills] = await Promise.all([
      wantInvoices ? this.prisma.invoice.findMany({ where: { ...common, ...invWhere }, include: { client: { select: { name: true, code: true } }, project: { select: { projectCode: true } } }, take: MAX_DOCS + 1 }) : [],
      wantBills ? this.prisma.vendorBill.findMany({ where: { ...common, ...billWhere }, include: { vendor: { select: { name: true, code: true } } }, take: MAX_DOCS + 1 }) : [],
    ]);
    if (invoices.length + bills.length > MAX_DOCS) throw new BadRequestException(`More than ${MAX_DOCS} documents. Pick a shorter date range.`);
    const lines = (v: Prisma.JsonValue): DocLine[] => (v as unknown as DocLine[]).map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), amount: Number(l.amount) }));
    const docs: (Doc & { id: string; exportedAt: Date | null })[] = [
      ...invoices.map((i) => ({
        id: i.id, type: 'invoice' as const, number: i.number, date: i.issuedAt ?? i.createdAt, dueAt: i.dueAt, status: i.status, exportedAt: payments ? i.paymentExportedAt : i.exportedAt,
        paidAt: i.paidAt, paymentReference: i.paymentReference,
        party: i.client, currency: i.currency, lines: lines(i.lines), subtotal: money(i.subtotal), taxName: i.taxName, taxPercent: Number(i.taxPercent), taxAmount: money(i.taxAmount), total: money(i.total),
        reference: i.project.projectCode, notes: i.notes,
      })),
      ...bills.map((b) => ({
        id: b.id, type: 'bill' as const, number: b.number, date: b.approvedAt ?? b.createdAt, dueAt: b.dueAt, status: b.status, exportedAt: payments ? b.paymentExportedAt : b.exportedAt,
        paidAt: b.paidAt, paymentReference: b.paymentReference,
        party: b.vendor, currency: b.currency, lines: lines(b.lines), subtotal: money(b.subtotal), taxName: b.taxName, taxPercent: Number(b.taxPercent), taxAmount: money(b.taxAmount), total: money(b.total),
        reference: b.vendorReference, notes: b.notes,
      })),
    ];
    const when = (d: (typeof docs)[number]) => (payments ? d.paidAt ?? d.date : d.date).getTime();
    return docs.sort((a, b) => when(a) - when(b) || a.number.localeCompare(b.number));
  }

  private async context(org: string) {
    const [config, settings] = await Promise.all([this.config(org), this.payables.settings(org)]);
    const rates = new Map(settings.rates.map((r) => [r.currency, r.rate]));
    return { config, baseCurrency: settings.baseCurrency, rate: (c: string) => (c === settings.baseCurrency ? 1 : rates.get(c) ?? null) };
  }

  private fileName(f: ExportFilters, ext: string) {
    const span = f.from || f.to ? `${f.from ?? 'start'}_to_${f.to ?? 'now'}` : new Date().toISOString().slice(0, 10);
    return `projexa-${f.format.replace('_', '-')}-${f.kind}-${span}.${ext}`;
  }

  /** What the export would contain, without making it. */
  async preview(org: string, f: ExportFilters) {
    const ctx = await this.context(org);
    const docs = await this.documents(org, f, ctx.config.timezone);
    const totals = new Map<string, { type: string; currency: string; count: number; total: number }>();
    for (const d of docs) {
      const k = `${d.type}:${d.currency}`;
      const t = totals.get(k) ?? { type: d.type, currency: d.currency, count: 0, total: 0 };
      t.count++;
      t.total = money(t.total + d.total);
      totals.set(k, t);
    }
    const warnings: string[] = [];
    if (f.format === 'tally' && docs.length) {
      const missing = [...new Set(docs.map((d) => d.currency).filter((c) => ctx.rate(c) == null))];
      if (missing.length) warnings.push(new MissingRates(missing).message);
    }
    if (!f.onlyNew && docs.some((d) => d.exportedAt)) warnings.push(`${docs.filter((d) => d.exportedAt).length} of these were exported before. Importing them again can create duplicates.`);
    return {
      invoiceCount: docs.filter((d) => d.type === 'invoice').length,
      billCount: docs.filter((d) => d.type === 'bill').length,
      totals: [...totals.values()],
      warnings,
      fileName: this.fileName(f, FORMAT_INFO[f.format].ext),
      documents: docs.slice(0, 200).map((d) => ({ id: d.id, type: d.type, number: d.number, date: PAYMENT_KINDS.includes(f.kind) ? d.paidAt ?? d.date : d.date, party: d.party.name, currency: d.currency, total: d.total, status: d.status, exportedAt: d.exportedAt, paymentReference: d.paymentReference ?? null })),
    };
  }

  async create(u: AuthUser, f: ExportFilters) {
    const ctx = await this.context(u.organizationId);
    const docs = await this.documents(u.organizationId, f, ctx.config.timezone);
    if (!docs.length) throw new BadRequestException('Nothing to export for these filters');
    let built;
    try {
      built = build(f.format as Format, f.kind as Kind, docs, ctx);
    } catch (e) {
      if (e instanceof MissingRates) throw new BadRequestException(e.message);
      throw e;
    }
    const inv = docs.filter((d) => d.type === 'invoice').map((d) => d.id);
    const bills = docs.filter((d) => d.type === 'bill').map((d) => d.id);
    const now = new Date();
    const field = PAYMENT_KINDS.includes(f.kind) ? 'paymentExportedAt' : 'exportedAt';
    const exp = await this.prisma.$transaction(async (tx) => {
      // Two people exporting "only new" at once: the second one must not get the same documents.
      const guard = f.onlyNew ? { [field]: null } : {};
      const a = inv.length ? await tx.invoice.updateMany({ where: { id: { in: inv }, ...guard }, data: { [field]: now } }) : { count: 0 };
      const b = bills.length ? await tx.vendorBill.updateMany({ where: { id: { in: bills }, ...guard }, data: { [field]: now } }) : { count: 0 };
      if (f.onlyNew && (a.count !== inv.length || b.count !== bills.length)) throw new BadRequestException('Someone else just exported some of these. Check the preview again.');
      const row = await tx.accountingExport.create({
        data: {
          organizationId: u.organizationId, format: f.format, kind: f.kind, filters: f as Prisma.InputJsonValue,
          invoiceCount: inv.length, billCount: bills.length, fileName: this.fileName(f, built.ext), contentType: built.contentType, content: built.content, createdById: u.id,
        },
      });
      await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'accounting.export', entityType: 'AccountingExport', entityId: row.id, detail: { format: f.format, kind: f.kind, invoices: inv.length, bills: bills.length } }, tx);
      return row;
    });
    return this.shape(exp);
  }

  private shape(e: { id: string; format: string; kind: string; filters: Prisma.JsonValue; invoiceCount: number; billCount: number; fileName: string; createdAt: Date; createdById: string | null }, by?: string | null) {
    return { id: e.id, format: e.format, formatLabel: FORMAT_INFO[e.format as Format]?.label ?? e.format, kind: e.kind, filters: e.filters, invoiceCount: e.invoiceCount, billCount: e.billCount, fileName: e.fileName, createdAt: e.createdAt, createdBy: by ?? null };
  }

  async list(org: string) {
    const rows = await this.prisma.accountingExport.findMany({ where: { organizationId: org }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, format: true, kind: true, filters: true, invoiceCount: true, billCount: true, fileName: true, createdAt: true, createdById: true } });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.createdById!).filter(Boolean) } }, select: { id: true, name: true } });
    const name = new Map(users.map((x) => [x.id, x.name]));
    return rows.map((r) => this.shape(r, r.createdById ? name.get(r.createdById) : null));
  }

  async file(org: string, id: string) {
    const e = await this.prisma.accountingExport.findFirst({ where: { id, organizationId: org } });
    if (!e) throw new NotFoundException();
    return e;
  }
}

@Controller('accounting')
export class AccountingController {
  constructor(private readonly svc: AccountingService) {}

  @Get('formats')
  formats() {
    return FORMATS.map((id) => ({ id, ...FORMAT_INFO[id] }));
  }

  @Get('settings')
  settings(@CurrentUser() u: AuthUser) {
    return this.svc.config(u.organizationId);
  }

  @Put('settings')
  @Roles('ADMIN')
  save(@CurrentUser() u: AuthUser, @Body(new ZodPipe(accountingConfigSchema)) body: z.infer<typeof accountingConfigSchema>) {
    return this.svc.saveConfig(u, body);
  }

  @Post('exports/preview')
  @HttpCode(200)
  @Roles(...EDITORS)
  preview(@CurrentUser() u: AuthUser, @Body(new ZodPipe(exportSchema)) body: ExportFilters) {
    return this.svc.preview(u.organizationId, body);
  }

  @Post('exports')
  @Roles(...EDITORS)
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(exportSchema)) body: ExportFilters) {
    return this.svc.create(u, body);
  }

  @Get('exports')
  @Roles(...EDITORS)
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.organizationId);
  }

  @Get('exports/:id/download')
  @Roles(...EDITORS)
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const e = await this.svc.file(u.organizationId, id);
    res.setHeader('Content-Type', e.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${e.fileName.replace(/[^\w.-]/g, '_')}"`);
    res.setHeader('Cache-Control', 'no-store');
    // A byte-order mark helps Excel read UTF-8 CSV (accents in client names).
    res.send(e.contentType.startsWith('text/csv') ? `﻿${e.content}` : e.content);
  }
}
