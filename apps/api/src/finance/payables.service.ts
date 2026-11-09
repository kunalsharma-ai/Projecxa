/**
 * Vendor payables and finance settings.
 *
 * A vendor bill collects a vendor's approved completes that are not on a bill yet, across
 * projects, one bill per vendor and currency, with a line per project, market and price.
 * Draft → approved (with the vendor's invoice number and payment terms) → paid, or void,
 * which releases the completes. Rejected completes are never paid.
 *
 * Exchange rates are entered by hand (no paid FX feed). They only convert totals for the
 * dashboards into the reporting currency; documents always stay in their own currency.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VendorBillStatus } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { WebhooksService } from '../webhooks/webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { money, taxSchema, withTax } from './finance.service';
import { currencyOf, sessionGroups } from '../prisma/session-totals';

const currency = z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code such as USD');

export const createBillsSchema = z
  .object({
    vendorId: z.string().max(64).optional(),
    /** Only completes with an outcome on or before this day (YYYY-MM-DD, UTC). */
    upTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export const billListSchema = z.object({ status: z.nativeEnum(VendorBillStatus).optional(), vendorId: z.string().max(64).optional() });
export const updateBillSchema = z
  .object({
    status: z.enum(['APPROVED', 'PAID', 'VOID']).optional(),
    dueDays: z.number().int().min(0).max(180).optional(),
    vendorReference: z.string().trim().max(80).nullable().optional(),
    paymentReference: z.string().trim().max(120).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .merge(taxSchema)
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to change' });

const taxDefault = z.object({ name: z.string().trim().max(40).nullable(), percent: z.number().min(0).max(100) });
export const financeSettingsSchema = z
  .object({
    baseCurrency: currency.optional(),
    invoiceTax: taxDefault.optional(),
    billTax: taxDefault.optional(),
    /** Replaces every rate. 1 unit of `currency` = `rate` units of the base currency. */
    rates: z.array(z.object({ currency, rate: z.number().positive().max(1_000_000) })).max(100).optional(),
  })
  .strict();

const NEXT: Record<VendorBillStatus, VendorBillStatus[]> = { DRAFT: ['APPROVED', 'VOID'], APPROVED: ['PAID', 'VOID'], PAID: [], VOID: [] };

export type BillLine = { projectId: string; projectCode: string; countryCode: string; description: string; quantity: number; unitPrice: number; amount: number };
type Amount = { currency: string; amount: number };

@Injectable()
export class PayablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhooksService,
  ) {}

  // ───────────── Finance settings and conversion ─────────────

  async settings(org: string) {
    const [o, rates, used] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { baseCurrency: true, invoiceTaxName: true, invoiceTaxPercent: true, billTaxName: true, billTaxPercent: true } }),
      this.prisma.exchangeRate.findMany({ where: { organizationId: org }, orderBy: { currency: 'asc' } }),
      this.prisma.projectCountry.findMany({ where: { project: { organizationId: org } }, distinct: ['currency'], select: { currency: true } }),
    ]);
    const currencies = [...new Set(used.map((c) => c.currency))].sort();
    const have = new Set([o.baseCurrency, ...rates.map((r) => r.currency)]);
    return {
      baseCurrency: o.baseCurrency,
      invoiceTax: { name: o.invoiceTaxName, percent: Number(o.invoiceTaxPercent) },
      billTax: { name: o.billTaxName, percent: Number(o.billTaxPercent) },
      rates: rates.map((r) => ({ currency: r.currency, rate: Number(r.rate), updatedAt: r.updatedAt })),
      currencies,
      missing: currencies.filter((c) => !have.has(c)),
    };
  }

  async saveSettings(u: AuthUser, body: z.infer<typeof financeSettingsSchema>) {
    const base = body.baseCurrency;
    if (body.rates && base && body.rates.some((r) => r.currency === base)) throw new BadRequestException('The reporting currency does not need a rate');
    if (body.rates && new Set(body.rates.map((r) => r.currency)).size !== body.rates.length) throw new BadRequestException('Each currency can have one rate');
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: u.organizationId },
        data: {
          ...(base ? { baseCurrency: base } : {}),
          ...(body.invoiceTax ? { invoiceTaxName: body.invoiceTax.percent > 0 ? body.invoiceTax.name || 'Tax' : null, invoiceTaxPercent: body.invoiceTax.percent } : {}),
          ...(body.billTax ? { billTaxName: body.billTax.percent > 0 ? body.billTax.name || 'Tax' : null, billTaxPercent: body.billTax.percent } : {}),
        },
      });
      if (body.rates) {
        await tx.exchangeRate.deleteMany({ where: { organizationId: u.organizationId } });
        if (body.rates.length) await tx.exchangeRate.createMany({ data: body.rates.map((r) => ({ organizationId: u.organizationId, currency: r.currency, rate: r.rate })) });
      }
      // A rate for the (new) base currency would be meaningless.
      if (base) await tx.exchangeRate.deleteMany({ where: { organizationId: u.organizationId, currency: base } });
      await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'finance.settings', entityType: 'Organization', entityId: u.organizationId, detail: body }, tx);
    });
    return this.settings(u.organizationId);
  }

  /** Converter into the reporting currency. Amounts in a currency without a rate are left out and listed. */
  async converter(org: string) {
    const [o, rates] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { baseCurrency: true } }),
      this.prisma.exchangeRate.findMany({ where: { organizationId: org } }),
    ]);
    const map = new Map(rates.map((r) => [r.currency, Number(r.rate)]));
    map.set(o.baseCurrency, 1);
    return (amounts: Amount[]) => {
      const missing = [...new Set(amounts.filter((a) => a.amount && !map.has(a.currency)).map((a) => a.currency))];
      const amount = money(amounts.reduce((t, a) => t + (map.has(a.currency) ? a.amount * map.get(a.currency)! : 0), 0));
      return { currency: o.baseCurrency, amount, missing };
    };
  }

  // ───────────── Payables ─────────────

  /** What each vendor is owed, per currency: approved but not billed, waiting for approval, on approved bills, paid. */
  async summary(org: string) {
    const groups = await sessionGroups(this.prisma, { organizationId: org, isTest: false, status: 'COMPLETE' }, ['approval', 'vendorBillId', 'vendorAllocationId', 'projectCountryId']);
    const cur = await currencyOf(this.prisma, groups.map((g) => g.projectCountryId));
    const allocIds = [...new Set(groups.map((g) => g.vendorAllocationId).filter((x): x is string => !!x))];
    const vendorOf = new Map(
      allocIds.length ? (await this.prisma.vendorAllocation.findMany({ where: { id: { in: allocIds } }, select: { id: true, vendorId: true } })).map((a) => [a.id, a.vendorId]) : [],
    );
    const billIds = [...new Set(groups.map((g) => g.vendorBillId).filter((x): x is string => !!x))];
    const billStatus = new Map(
      billIds.length ? (await this.prisma.vendorBill.findMany({ where: { id: { in: billIds } }, select: { id: true, status: true } })).map((b) => [b.id, b.status as string]) : [],
    );
    const merged = new Map<string, { vendorId: string; currency: string; bucket: string; n: number; amount: number }>();
    for (const g of groups) {
      const vendorId = g.vendorAllocationId ? vendorOf.get(g.vendorAllocationId) : undefined;
      const currency = g.projectCountryId ? cur.get(g.projectCountryId) : undefined;
      if (!vendorId || !currency) continue;
      const bill = g.vendorBillId ? billStatus.get(g.vendorBillId) : undefined;
      const bucket = g.approval === 'PENDING' ? 'pending' : g.approval !== 'APPROVED' ? 'rejected' : !bill ? 'unbilled' : bill === 'DRAFT' ? 'draft' : bill === 'APPROVED' ? 'due' : 'paid';
      const k = `${vendorId}|${currency}|${bucket}`;
      const m = merged.get(k) ?? { vendorId, currency, bucket, n: 0, amount: 0 };
      m.n += g.n;
      m.amount += g.payout;
      merged.set(k, m);
    }
    const rows = [...merged.values()];
    const vendors = await this.prisma.vendor.findMany({ where: { organizationId: org, id: { in: [...new Set(rows.map((r) => r.vendorId))] } }, select: { id: true, name: true, code: true } });
    const empty = () => ({ completes: 0, amount: 0 });
    const out = new Map<string, { vendor: (typeof vendors)[number]; currency: string; pending: ReturnType<typeof empty>; unbilled: ReturnType<typeof empty>; draft: ReturnType<typeof empty>; due: ReturnType<typeof empty>; paid: ReturnType<typeof empty> }>();
    for (const r of rows) {
      if (r.bucket === 'rejected') continue;
      const key = `${r.vendorId}:${r.currency}`;
      const v = out.get(key) ?? { vendor: vendors.find((x) => x.id === r.vendorId)!, currency: r.currency, pending: empty(), unbilled: empty(), draft: empty(), due: empty(), paid: empty() };
      const b = v[r.bucket as 'pending' | 'unbilled' | 'draft' | 'due' | 'paid'];
      b.completes += r.n;
      b.amount = money(b.amount + r.amount);
      out.set(key, v);
    }
    const list = [...out.values()].sort((a, b) => a.vendor.name.localeCompare(b.vendor.name) || a.currency.localeCompare(b.currency));
    const toBase = await this.converter(org);
    const total = (k: 'pending' | 'unbilled' | 'draft' | 'due' | 'paid') => {
      const by = new Map<string, number>();
      let completes = 0;
      for (const x of list) {
        completes += x[k].completes;
        if (x[k].amount) by.set(x.currency, money((by.get(x.currency) ?? 0) + x[k].amount));
      }
      const byCurrency = [...by].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount);
      return { completes, byCurrency, base: toBase(byCurrency) };
    };
    return { vendors: list, totals: { unbilled: total('unbilled'), draft: total('draft'), due: total('due'), paid: total('paid'), pending: total('pending') } };
  }

  async createBills(u: AuthUser, body: z.infer<typeof createBillsSchema>) {
    if (body.vendorId && !(await this.prisma.vendor.count({ where: { id: body.vendorId, organizationId: u.organizationId } }))) throw new NotFoundException('Vendor not found');
    const upTo = body.upTo ? new Date(`${body.upTo}T23:59:59.999Z`) : null;
    return this.prisma.$transaction(async (tx) => {
      const sessions = await tx.respondentSession.findMany({
        where: {
          organizationId: u.organizationId,
          isTest: false,
          status: 'COMPLETE',
          approval: 'APPROVED',
          vendorBillId: null,
          ...(body.vendorId ? { vendorAllocation: { vendorId: body.vendorId } } : {}),
          ...(upTo ? { outcomeAt: { lte: upTo } } : {}),
        },
        select: {
          id: true,
          payout: true,
          vendorAllocation: { select: { vendorId: true } },
          projectCountry: { select: { countryCode: true, currency: true } },
          project: { select: { id: true, projectCode: true, name: true } },
        },
      });
      if (!sessions.length) throw new BadRequestException('There are no approved completes waiting to be billed');

      const groups = new Map<string, typeof sessions>();
      for (const s of sessions) {
        const k = `${s.vendorAllocation.vendorId}:${s.projectCountry.currency}`;
        groups.set(k, [...(groups.get(k) ?? []), s]);
      }
      const created = [];
      for (const [key, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        const [vendorId, cur] = key.split(':');
        const lines = new Map<string, BillLine>();
        for (const s of list) {
          const price = money(s.payout);
          const k = `${s.project.id}:${s.projectCountry.countryCode}:${price}`;
          const l = lines.get(k) ?? { projectId: s.project.id, projectCode: s.project.projectCode, countryCode: s.projectCountry.countryCode, description: `${s.project.projectCode} ${s.project.name}: completes, ${s.projectCountry.countryCode}`, quantity: 0, unitPrice: price, amount: 0 };
          l.quantity++;
          l.amount = money(l.quantity * l.unitPrice);
          lines.set(k, l);
        }
        const sorted = [...lines.values()].sort((a, b) => a.projectCode.localeCompare(b.projectCode) || a.countryCode.localeCompare(b.countryCode) || b.unitPrice - a.unitPrice);
        const org = await tx.organization.update({ where: { id: u.organizationId }, data: { billSeq: { increment: 1 } }, select: { billSeq: true, billTaxName: true, billTaxPercent: true } });
        const tax = withTax(sorted.reduce((a, l) => a + l.amount, 0), Number(org.billTaxPercent));
        const bill = await tx.vendorBill.create({
          data: {
            organizationId: u.organizationId,
            vendorId,
            number: `BILL-${new Date().getUTCFullYear()}-${String(org.billSeq).padStart(5, '0')}`,
            currency: cur,
            periodTo: upTo,
            lines: sorted,
            completes: list.length,
            ...tax,
            taxName: tax.taxPercent > 0 ? org.billTaxName || 'Tax' : null,
            notes: body.notes,
            createdById: u.id,
          },
        });
        const ids = list.map((s) => s.id);
        let linked = 0;
        for (let i = 0; i < ids.length; i += 5000) {
          linked += (await tx.respondentSession.updateMany({ where: { id: { in: ids.slice(i, i + 5000) }, vendorBillId: null, approval: 'APPROVED' }, data: { vendorBillId: bill.id } })).count;
        }
        if (linked !== ids.length) throw new ConflictException('These completes were just billed by someone else. Reload and try again.');
        created.push(bill);
      }
      await this.audit.record(
        { organizationId: u.organizationId, actorId: u.id, action: 'bill.create', entityType: 'Organization', entityId: u.organizationId, detail: { bills: created.map((b) => ({ id: b.id, number: b.number, vendorId: b.vendorId, currency: b.currency, total: Number(b.total) })), upTo: body.upTo } },
        tx,
      );
      return { bills: created.map(shape) };
    });
  }

  async list(org: string, q: z.infer<typeof billListSchema> & { vendorView?: boolean }) {
    const rows = await this.prisma.vendorBill.findMany({
      where: { organizationId: org, ...(q.status ? { status: q.status } : q.vendorView ? { status: { in: ['APPROVED', 'PAID'] as VendorBillStatus[] } } : {}), ...(q.vendorId ? { vendorId: q.vendorId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { vendor: { select: { id: true, name: true, code: true } } },
    });
    const now = Date.now();
    return rows.map((r) => ({ ...shape(r), vendor: r.vendor, overdue: r.status === 'APPROVED' && !!r.dueAt && r.dueAt.getTime() < now }));
  }

  async get(org: string, id: string, vendorId?: string) {
    const r = await this.prisma.vendorBill.findFirst({
      where: { id, organizationId: org, ...(vendorId ? { vendorId, status: { in: ['APPROVED', 'PAID'] as VendorBillStatus[] } } : {}) },
      include: { vendor: { select: { id: true, name: true, code: true } }, organization: { select: { name: true } } },
    });
    if (!r) throw new NotFoundException('Bill not found');
    return { ...shape(r), vendor: r.vendor, payer: r.organization.name, overdue: r.status === 'APPROVED' && !!r.dueAt && r.dueAt.getTime() < Date.now() };
  }

  async update(u: AuthUser, id: string, body: z.infer<typeof updateBillSchema>) {
    const bill = await this.prisma.vendorBill.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!bill) throw new NotFoundException('Bill not found');
    const draftOnly = body.notes !== undefined || body.taxName !== undefined || body.taxPercent !== undefined;
    if (draftOnly && bill.status !== 'DRAFT') throw new BadRequestException('Notes and tax can only be changed on a draft');
    if (body.status && !NEXT[bill.status].includes(body.status)) throw new BadRequestException(`A ${bill.status.toLowerCase()} bill cannot be marked ${body.status.toLowerCase()}`);
    if (body.vendorReference !== undefined && !['DRAFT', 'APPROVED'].includes(bill.status) && body.status !== 'APPROVED') throw new BadRequestException('The vendor invoice number is set before payment');
    if (body.paymentReference !== undefined && body.status !== 'PAID') throw new BadRequestException('A payment reference is recorded when the bill is paid');
    const tax = body.taxName !== undefined || body.taxPercent !== undefined
      ? { ...withTax(Number(bill.subtotal), body.taxPercent ?? Number(bill.taxPercent)), taxName: body.taxName !== undefined ? body.taxName || null : bill.taxName }
      : null;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.vendorBill.updateMany({
        where: { id, status: bill.status },
        data: {
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(tax ?? {}),
          ...(body.vendorReference !== undefined ? { vendorReference: body.vendorReference || null } : {}),
          ...(body.paymentReference !== undefined ? { paymentReference: body.paymentReference || null } : {}),
          ...(body.status ? { status: body.status } : {}),
          ...(body.status === 'APPROVED' ? { approvedAt: now, dueAt: new Date(now.getTime() + (body.dueDays ?? 30) * 86_400_000) } : {}),
          ...(body.status === 'PAID' ? { paidAt: now } : {}),
          ...(body.status === 'VOID' ? { voidedAt: now } : {}),
        },
      });
      if (r.count !== 1) throw new ConflictException('This bill was just changed by someone else. Reload and try again.');
      if (body.status === 'VOID') await tx.respondentSession.updateMany({ where: { vendorBillId: id }, data: { vendorBillId: null } });
      if (body.status) {
        await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: `bill.${body.status.toLowerCase()}`, entityType: 'VendorBill', entityId: id, detail: { number: bill.number, total: Number(bill.total), currency: bill.currency } }, tx);
      }
    });
    const out = await this.get(u.organizationId, id);
    if (body.status) {
      await this.webhooks.emit(u.organizationId, 'bill.status_changed', { bill: { id, number: bill.number, currency: out.currency, total: out.total, dueAt: out.dueAt, vendorReference: out.vendorReference, paymentReference: out.paymentReference, vendor: out.vendor }, from: bill.status, to: body.status });
    }
    return out;
  }
}

type BillRow = Prisma.VendorBillGetPayload<object>;
export function shape(r: BillRow) {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    vendorId: r.vendorId,
    currency: r.currency,
    periodTo: r.periodTo,
    lines: r.lines as BillLine[],
    completes: r.completes,
    subtotal: Number(r.subtotal),
    taxName: r.taxName,
    taxPercent: Number(r.taxPercent),
    taxAmount: Number(r.taxAmount),
    total: Number(r.total),
    vendorReference: r.vendorReference,
    paymentReference: r.paymentReference,
    notes: r.notes,
    approvedAt: r.approvedAt,
    dueAt: r.dueAt,
    paidAt: r.paidAt,
    voidedAt: r.voidedAt,
    createdAt: r.createdAt,
  };
}
