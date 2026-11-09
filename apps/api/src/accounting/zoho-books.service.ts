import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Logger, Post, Put } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Invoice, Prisma, VendorBill } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { config, ZohoBooksConfig } from '../common/config';
import { IntegrationsService } from '../integrations/integrations.service';
import { ZodPipe } from '../common/zod.pipe';
import { money } from '../finance/finance.service';
import { PayablesService } from '../finance/payables.service';
import { PrismaService } from '../prisma/prisma.service';
import { zonedTime } from '../schedules/schedule.rules';
import { AccountingService } from './accounting.service';
import { AccountingConfig, DocLine, fmtDate } from './formats';
import { BudgetSpent, Http, ZohoBooksClient, ZohoBooksError } from './zoho-books.client';

/**
 * Direct sync to Zoho Books (docs/ZOHO_BOOKS.md): sent and paid invoices, approved and paid vendor
 * bills, their payments, and voids. Every record that reaches Zoho Books is remembered in
 * ZohoBooksLink, and documents are looked up by number before they are created, so a sync can be
 * run any number of times without making duplicates.
 */

export const zohoSettingsSchema = z
  .object({
    /** Run by itself every hour. */
    hourly: z.boolean(),
    /** Only documents dated on or after this day. Older ones are probably in Zoho Books already. */
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-01').nullable(),
    invoices: z.boolean(),
    bills: z.boolean(),
    payments: z.boolean(),
  })
  .strict();
export type ZohoSettings = z.infer<typeof zohoSettingsSchema>;
const DEFAULT_SETTINGS: ZohoSettings = { hourly: false, since: null, invoices: true, bills: true, payments: true };
const settingsOf = (v: unknown): ZohoSettings => ({ ...DEFAULT_SETTINGS, ...((v ?? {}) as Partial<ZohoSettings>) });

export interface Counts { customers: number; vendors: number; invoices: number; bills: number; matched: number; paymentsReceived: number; paymentsMade: number; voided: number }
const zero = (): Counts => ({ customers: 0, vendors: 0, invoices: 0, bills: 0, matched: 0, paymentsReceived: 0, paymentsMade: 0, voided: 0 });
type RunError = { type: string; number: string | null; message: string };

/** A run that has not finished after this long is taken to have died with the server. */
const STALE_MS = 30 * 60_000;
const HOUR = 3_600_000;
const MAX_DOCS_PER_RUN = 500;

type Party = { id: string; name: string; code: string };
type Link = { id: string; entityType: string; entityId: string; zohoId: string; state: string | null };

@Injectable()
export class ZohoBooksService {
  private readonly log = new Logger('ZohoBooks');
  /** Swapped for a fake Zoho in tests. */
  http: Http = (url, init) => fetch(url, init);
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  /** Spacing between calls: Zoho Books allows 30 requests a minute. */
  gapMs = 2_100;
  /** Requests one run may make (Zoho's daily limit is 1,000 on the free plan, 2,000+ on paid plans). */
  budget = 600;
  /** The run in progress, so tests (and shutdown) can wait for it. */
  current: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly payables: PayablesService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** Zoho Books for this organisation: saved in Settings → Integrations, or the env one bound to it. */
  private async bound(org: string) {
    return (await this.integrations.zohoBooks(org)).config;
  }

  private async requireBound(org: string) {
    const z = await this.integrations.zohoBooks(org);
    if (!z.config) throw new BadRequestException(z.otherTenant ? 'Zoho Books is connected to another SampTrek organisation' : `Zoho Books is not set up yet. Add it in Settings → Integrations. Missing: ${z.missing.join(', ')}`);
    return z.config;
  }

  private client(c: ZohoBooksConfig) {
    return new ZohoBooksClient(c, this.http, { gapMs: this.gapMs, budget: this.budget, sleep: this.sleep });
  }

  async settings(org: string) {
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { zohoBooksConfig: true } });
    return settingsOf(o.zohoBooksConfig);
  }

  async saveSettings(u: AuthUser, body: ZohoSettings) {
    if (body.hourly && !body.since) throw new BadRequestException('Pick the date to sync from before turning on the hourly sync');
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { zohoBooksConfig: body as Prisma.InputJsonValue } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'zoho_books.settings', entityType: 'Organization', entityId: u.organizationId, detail: body });
    return body;
  }

  async status(org: string) {
    const z = await this.integrations.zohoBooks(org);
    const c = z.config;
    const [settings, runs, links] = await Promise.all([
      this.settings(org),
      this.runs(org),
      this.prisma.zohoBooksLink.groupBy({ by: ['entityType'], where: { organizationId: org }, _count: true }),
    ]);
    return {
      configured: !!c || z.otherTenant,
      source: z.source,
      missing: z.missing,
      boundHere: !!c,
      otherTenant: z.otherTenant,
      dataCentre: c?.dc ?? null,
      apiHost: c ? new URL(c.apiUrl).host : null,
      zohoOrganizationId: c?.organizationId ?? null,
      settings,
      linked: Object.fromEntries(links.map((l) => [l.entityType, l._count])),
      running: runs.some((r) => r.status === 'running'),
      runs,
    };
  }

  async runs(org: string) {
    const rows = await this.prisma.zohoBooksSync.findMany({ where: { organizationId: org }, orderBy: { startedAt: 'desc' }, take: 20 });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.createdById!).filter(Boolean) } }, select: { id: true, name: true } });
    const name = new Map(users.map((x) => [x.id, x.name]));
    return rows.map((r) => ({ id: r.id, trigger: r.trigger, status: r.status, counts: (r.counts as Counts | null) ?? zero(), errors: (r.errors as RunError[] | null) ?? [], startedAt: r.startedAt, finishedAt: r.finishedAt, by: r.createdById ? name.get(r.createdById) ?? null : null }));
  }

  /** Checks the connection and that the account names in the accounting settings exist in Zoho Books. */
  async test(org: string) {
    const c = await this.requireBound(org);
    const api = this.client(c);
    const cfg = await this.accounting.config(org);
    const checks: { label: string; ok: boolean; detail: string }[] = [];
    let organization: { name: string; currency: string } | null = null;
    try {
      const o = await api.call<{ organization: { name: string; currency_code: string } }>('GET', `/organizations/${encodeURIComponent(c.organizationId)}`);
      organization = { name: o.organization.name, currency: o.organization.currency_code };
      checks.push({ label: 'Connection', ok: true, detail: `Signed in to ${o.organization.name} (${o.organization.currency_code})` });
    } catch (e) {
      checks.push({ label: 'Connection', ok: false, detail: (e as Error).message });
      return { ok: false, organization, checks };
    }
    const base = (await this.payables.settings(org)).baseCurrency;
    if (base && base !== organization.currency) checks.push({ label: 'Currency', ok: true, detail: `Zoho Books uses ${organization.currency} and SampTrek reports in ${base}. Exchange rates are left to Zoho Books.` });
    try {
      const accounts = await this.accounts(api);
      for (const [label, n] of [['Bank account', cfg.bankAccount], ['Expense account', cfg.expenseAccount]] as const) {
        const a = accounts.get(n.toLowerCase());
        checks.push({ label, ok: !!a, detail: a ? `"${n}" found` : `No account named "${n}" in the Zoho Books chart of accounts. Change it under Account names.` });
      }
      const taxes = await this.taxList(api);
      const used = await this.prisma.invoice.findMany({ where: { organizationId: org, taxPercent: { gt: 0 } }, select: { taxPercent: true }, distinct: ['taxPercent'] });
      const usedBills = await this.prisma.vendorBill.findMany({ where: { organizationId: org, taxPercent: { gt: 0 } }, select: { taxPercent: true }, distinct: ['taxPercent'] });
      const pct = [...new Set([...used, ...usedBills].map((x) => Number(x.taxPercent)))];
      const missing = pct.filter((p) => !taxes.some((t) => Math.abs(t.percentage - p) < 0.001));
      checks.push({ label: 'Taxes', ok: !missing.length, detail: missing.length ? `Add a tax of ${missing.map((p) => `${p}%`).join(', ')} in Zoho Books under Settings → Taxes` : pct.length ? `Every tax rate used here exists (${pct.map((p) => `${p}%`).join(', ')})` : 'No taxed documents yet' });
    } catch (e) {
      checks.push({ label: 'Chart of accounts', ok: false, detail: (e as Error).message });
    }
    return { ok: checks.every((x) => x.ok), organization, checks };
  }

  /** Starts a run in the background. Only one runs at a time per organisation. */
  async start(org: string, trigger: 'manual' | 'schedule', userId: string | null) {
    const c = await this.requireBound(org);
    const s = await this.settings(org);
    if (!s.since) throw new BadRequestException('Pick the date to sync from first (Zoho Books settings)');
    if (!s.invoices && !s.bills) throw new BadRequestException('Turn on invoices or bills to sync');
    await this.prisma.zohoBooksSync.updateMany({ where: { organizationId: org, status: 'running', startedAt: { lt: new Date(Date.now() - STALE_MS) } }, data: { status: 'failed', finishedAt: new Date(), errors: [{ type: 'run', number: null, message: 'The server stopped during this run' }] } });
    const run = await this.prisma.$transaction(async (tx) => {
      if (await tx.zohoBooksSync.count({ where: { organizationId: org, status: 'running' } })) throw new ConflictException('A sync is already running');
      return tx.zohoBooksSync.create({ data: { organizationId: org, trigger, status: 'running', createdById: userId } });
    }).catch((e) => {
      if (e instanceof ConflictException) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') throw new ConflictException('A sync is already running');
      throw e;
    });
    this.current = this.run(org, run.id, c, s, userId).catch((e) => this.log.error(`Zoho Books run ${run.id} crashed: ${(e as Error).message}`));
    return (await this.runs(org)).find((r) => r.id === run.id)!;
  }

  @Interval(5 * 60_000)
  async tick() {
    if (!config.zohoBooksSchedulerEnabled) return;
    for (const id of await this.integrations.zohoBooksOrgs()) {
      if (!(await this.bound(id))) continue;
      const o = await this.prisma.organization.findUnique({ where: { id }, select: { id: true, zohoBooksConfig: true } });
      if (!o) continue;
      const s = settingsOf(o.zohoBooksConfig);
      if (!s.hourly || !s.since) continue;
      const last = await this.prisma.zohoBooksSync.findFirst({ where: { organizationId: o.id }, orderBy: { startedAt: 'desc' } });
      if (last && (last.status === 'running' || last.startedAt.getTime() > Date.now() - HOUR)) continue;
      await this.start(o.id, 'schedule', null).catch((e) => this.log.warn(`Scheduled Zoho Books sync not started: ${(e as Error).message}`));
      // One run at a time per server.
      if (this.current) await this.current;
    }
  }

  // ───────────── The run ─────────────

  private async run(org: string, runId: string, c: ZohoBooksConfig, s: ZohoSettings, userId: string | null) {
    const counts = zero();
    const errors: RunError[] = [];
    let stopped = false;
    try {
      const api = this.client(c);
      const cfg = await this.accounting.config(org);
      const [y, m, d] = s.since!.split('-').map(Number);
      const since = zonedTime(y, m, d, 0, cfg.timezone);
      const ctx = new RunContext(api, c.organizationId, cfg, this.prisma, org, (await this.payables.settings(org)).baseCurrency, counts);
      await ctx.load();

      const work: (() => Promise<void>)[] = [];
      if (s.invoices) {
        const invoices = await this.prisma.invoice.findMany({
          where: { organizationId: org, OR: [{ status: { in: ['SENT', 'PAID'] }, issuedAt: { gte: since } }, { status: 'VOID', id: { in: ctx.linkedIds('invoice') } }] },
          include: { client: { select: { id: true, name: true, code: true } }, project: { select: { projectCode: true } } },
          orderBy: [{ issuedAt: 'asc' }, { number: 'asc' }],
        });
        for (const i of invoices) if (ctx.invoiceNeedsWork(i, s)) work.push(() => ctx.invoice(i, s).catch((e) => fail(e, 'invoice', i.number)));
      }
      if (s.bills) {
        const bills = await this.prisma.vendorBill.findMany({
          where: { organizationId: org, OR: [{ status: { in: ['APPROVED', 'PAID'] }, approvedAt: { gte: since } }, { status: 'VOID', id: { in: ctx.linkedIds('bill') } }] },
          include: { vendor: { select: { id: true, name: true, code: true } } },
          orderBy: [{ approvedAt: 'asc' }, { number: 'asc' }],
        });
        for (const b of bills) if (ctx.billNeedsWork(b, s)) work.push(() => ctx.bill(b, s).catch((e) => fail(e, 'bill', b.number)));
      }
      function fail(e: unknown, type: string, number: string) {
        if (e instanceof BudgetSpent) throw e;
        errors.push({ type, number, message: (e as Error).message.slice(0, 500) });
      }
      if (work.length > MAX_DOCS_PER_RUN) stopped = true;
      for (const w of work.slice(0, MAX_DOCS_PER_RUN)) await w();
    } catch (e) {
      if (e instanceof BudgetSpent) stopped = true;
      else errors.push({ type: 'run', number: null, message: (e as Error).message.slice(0, 500) });
    }
    if (stopped) errors.push({ type: 'run', number: null, message: 'Stopped at the limit for one run. The next run carries on.' });
    const did = Object.values(counts).some(Boolean);
    const status = !errors.length ? 'ok' : errors.every((e) => e.type === 'run' && e.message.startsWith('Stopped')) || did ? 'partial' : 'failed';
    await this.prisma.zohoBooksSync.update({ where: { id: runId }, data: { status, counts: counts as unknown as Prisma.InputJsonValue, errors: errors.slice(0, 200) as Prisma.InputJsonValue, finishedAt: new Date() } });
    await this.audit.record({ organizationId: org, actorId: userId, action: 'zoho_books.sync', entityType: 'ZohoBooksSync', entityId: runId, detail: { status, counts, errors: errors.length } });
  }

  private async accounts(api: ZohoBooksClient) {
    const r = await api.call<{ chartofaccounts: { account_id: string; account_name: string; account_type?: string }[] }>('GET', '/chartofaccounts', { query: { per_page: '200' } });
    return new Map(r.chartofaccounts.map((a) => [a.account_name.toLowerCase(), a]));
  }

  private async taxList(api: ZohoBooksClient) {
    const r = await api.call<{ taxes: { tax_id: string; tax_name: string; tax_percentage: number }[] }>('GET', '/settings/taxes');
    return r.taxes.map((t) => ({ id: t.tax_id, name: t.tax_name, percentage: Number(t.tax_percentage) }));
  }
}

type InvoiceRow = Invoice & { client: Party; project: { projectCode: string } };
type BillRow = VendorBill & { vendor: Party };

/** Lookups and links for one run, loaded once. */
class RunContext {
  private links = new Map<string, Link>();
  private zohoBase = '';
  private currencies = new Map<string, string>();
  private accountIds = new Map<string, string>();
  private taxes: { id: string; name: string; percentage: number }[] | null = null;
  private itemId: string | null | undefined;

  constructor(
    private readonly api: ZohoBooksClient,
    private readonly zohoOrg: string,
    private readonly cfg: AccountingConfig,
    private readonly prisma: PrismaService,
    private readonly org: string,
    private readonly projexaBase: string | null,
    private readonly counts: Counts,
  ) {}

  async load() {
    const [links, o, cur] = await Promise.all([
      this.prisma.zohoBooksLink.findMany({ where: { organizationId: this.org } }),
      this.api.call<{ organization: { currency_code: string } }>('GET', `/organizations/${encodeURIComponent(this.zohoOrg)}`),
      this.api.call<{ currencies: { currency_id: string; currency_code: string }[] }>('GET', '/settings/currencies'),
    ]);
    for (const l of links) this.links.set(`${l.entityType}:${l.entityId}`, l);
    this.zohoBase = o.organization.currency_code;
    for (const c of cur.currencies) this.currencies.set(c.currency_code, c.currency_id);
  }

  linkedIds(type: 'invoice' | 'bill') {
    return [...this.links.values()].filter((l) => l.entityType === type && l.state !== 'void').map((l) => l.entityId);
  }
  private link(type: string, id: string) {
    return this.links.get(`${type}:${id}`);
  }
  private async save(type: string, id: string, zohoId: string, state: string | null) {
    const l = await this.prisma.zohoBooksLink.upsert({
      where: { organizationId_entityType_entityId: { organizationId: this.org, entityType: type, entityId: id } },
      create: { organizationId: this.org, entityType: type, entityId: id, zohoId, state },
      update: { zohoId, state, syncedAt: new Date() },
    });
    this.links.set(`${type}:${id}`, l);
  }

  invoiceNeedsWork(i: InvoiceRow, s: ZohoSettings) {
    const l = this.link('invoice', i.id);
    if (!l) return i.status !== 'VOID';
    if (i.status === 'VOID') return l.state !== 'void';
    return i.status === 'PAID' && s.payments && !this.link('invoice_payment', i.id);
  }
  billNeedsWork(b: BillRow, s: ZohoSettings) {
    const l = this.link('bill', b.id);
    if (!l) return b.status !== 'VOID';
    if (b.status === 'VOID') return l.state !== 'void';
    return b.status === 'PAID' && s.payments && !this.link('bill_payment', b.id);
  }

  private day(d: Date | null) {
    return fmtDate(d, { ...this.cfg, dateFormat: 'yyyy-mm-dd' });
  }
  private currencyId(code: string) {
    const id = this.currencies.get(code);
    if (!id) throw new ZohoBooksError(`${code} is not a currency in Zoho Books. Add it under Settings → Currencies.`);
    return id;
  }
  /** Our manual rate, only when both systems use the same base currency. Otherwise Zoho Books applies its own. */
  private async exchangeRate(currency: string): Promise<{ exchange_rate?: number }> {
    if (currency === this.zohoBase || this.projexaBase !== this.zohoBase) return {};
    const r = await this.prisma.exchangeRate.findFirst({ where: { organizationId: this.org, currency } });
    return r ? { exchange_rate: Number(r.rate) } : {};
  }
  private async accountId(name: string) {
    if (!this.accountIds.size) {
      const r = await this.api.call<{ chartofaccounts: { account_id: string; account_name: string }[] }>('GET', '/chartofaccounts', { query: { per_page: '200' } });
      for (const a of r.chartofaccounts) this.accountIds.set(a.account_name.toLowerCase(), a.account_id);
    }
    const id = this.accountIds.get(name.toLowerCase());
    if (!id) throw new ZohoBooksError(`No account named "${name}" in the Zoho Books chart of accounts. Change it under Account names.`);
    return id;
  }
  private async taxId(percent: number, name: string | null) {
    if (!(percent > 0)) return {};
    if (!this.taxes) {
      const r = await this.api.call<{ taxes: { tax_id: string; tax_name: string; tax_percentage: number }[] }>('GET', '/settings/taxes');
      this.taxes = r.taxes.map((t) => ({ id: t.tax_id, name: t.tax_name, percentage: Number(t.tax_percentage) }));
    }
    const same = this.taxes.filter((t) => Math.abs(t.percentage - percent) < 0.001);
    const t = same.find((x) => name && x.name.toLowerCase() === name.toLowerCase()) ?? same[0];
    if (!t) throw new ZohoBooksError(`No tax of ${percent}% in Zoho Books. Add it under Settings → Taxes.`);
    return { tax_id: t.id };
  }
  /** The Zoho Books item for invoice lines, when one has the item name from the accounting settings. */
  private async item(): Promise<{ item_id?: string }> {
    if (this.itemId === undefined) {
      const r = await this.api.call<{ items: { item_id: string; name: string }[] }>('GET', '/items', { query: { name: this.cfg.itemName } });
      this.itemId = r.items.find((x) => x.name.toLowerCase() === this.cfg.itemName.toLowerCase())?.item_id ?? null;
    }
    return this.itemId ? { item_id: this.itemId } : {};
  }

  /** The customer or vendor in Zoho Books for this client or vendor and currency, found by name or created. */
  private async contact(kind: 'customer' | 'vendor', p: Party, currency: string) {
    const key = `${p.id}:${currency}`;
    const l = this.link(kind, key);
    if (l) return l.zohoId;
    const base = this.cfg.partyName === 'code' ? p.code : p.name;
    // A Zoho Books contact has one currency: a client billed in two currencies needs two contacts.
    const name = currency === this.zohoBase ? base : `${base} (${currency})`;
    const r = await this.api.call<{ contacts: { contact_id: string; contact_name: string; contact_type?: string; currency_code?: string }[] }>('GET', '/contacts', { query: { contact_name: name } });
    const found = r.contacts.find((x) => x.contact_name.toLowerCase() === name.toLowerCase() && (!x.contact_type || x.contact_type === kind));
    let id: string;
    if (found) {
      if (found.currency_code && found.currency_code !== currency) throw new ZohoBooksError(`"${name}" is in Zoho Books with currency ${found.currency_code}, not ${currency}`);
      id = found.contact_id;
    } else {
      const created = await this.api.call<{ contact: { contact_id: string } }>('POST', '/contacts', { body: { contact_name: name, contact_type: kind, currency_id: this.currencyId(currency) } });
      id = created.contact.contact_id;
      this.counts[kind === 'customer' ? 'customers' : 'vendors']++;
    }
    await this.save(kind, key, id, null);
    return id;
  }

  private lines(v: Prisma.JsonValue) {
    return (v as unknown as DocLine[]).map((l) => ({ description: String(l.description).slice(0, 2000), quantity: Number(l.quantity), rate: Number(l.unitPrice) }));
  }

  async invoice(i: InvoiceRow, s: ZohoSettings) {
    let l = this.link('invoice', i.id);
    if (!l) {
      const customer = await this.contact('customer', i.client, i.currency);
      const existing = await this.api.call<{ invoices: { invoice_id: string; invoice_number: string; status: string }[] }>('GET', '/invoices', { query: { invoice_number: i.number } });
      const hit = existing.invoices.find((x) => x.invoice_number === i.number);
      if (hit) {
        await this.save('invoice', i.id, hit.invoice_id, hit.status);
        this.counts.matched++;
      } else {
        const tax = await this.taxId(Number(i.taxPercent), i.taxName);
        const item = await this.item();
        const created = await this.api.call<{ invoice: { invoice_id: string; status: string } }>('POST', '/invoices', {
          query: { ignore_auto_number_generation: 'true' },
          body: {
            customer_id: customer,
            currency_id: this.currencyId(i.currency),
            invoice_number: i.number,
            date: this.day(i.issuedAt ?? i.createdAt),
            ...(i.dueAt ? { due_date: this.day(i.dueAt) } : {}),
            reference_number: i.project.projectCode,
            ...(i.notes ? { notes: i.notes.slice(0, 5000) } : {}),
            ...(await this.exchangeRate(i.currency)),
            line_items: this.lines(i.lines).map((x) => ({ ...item, name: this.cfg.itemName, ...x, ...tax })),
          },
        });
        await this.api.call('POST', `/invoices/${created.invoice.invoice_id}/status/sent`);
        await this.save('invoice', i.id, created.invoice.invoice_id, 'sent');
        this.counts.invoices++;
      }
      await this.prisma.invoice.updateMany({ where: { id: i.id, exportedAt: null }, data: { exportedAt: new Date() } });
      l = this.link('invoice', i.id)!;
    }
    if (i.status === 'VOID' && l.state !== 'void') {
      await this.api.call('POST', `/invoices/${l.zohoId}/status/void`);
      await this.save('invoice', i.id, l.zohoId, 'void');
      this.counts.voided++;
      return;
    }
    if (i.status === 'PAID' && s.payments && !this.link('invoice_payment', i.id)) {
      const zi = await this.api.call<{ invoice: { balance: number; customer_id: string } }>('GET', `/invoices/${l.zohoId}`);
      const balance = money(Number(zi.invoice.balance));
      let paymentId = 'already-paid';
      if (balance > 0) {
        const p = await this.api.call<{ payment: { payment_id: string } }>('POST', '/customerpayments', {
          body: {
            customer_id: zi.invoice.customer_id,
            payment_mode: this.cfg.paymentMode,
            amount: balance,
            date: this.day(i.paidAt ?? new Date()),
            reference_number: i.paymentReference ?? '',
            account_id: await this.accountId(this.cfg.bankAccount),
            ...(await this.exchangeRate(i.currency)),
            invoices: [{ invoice_id: l.zohoId, amount_applied: balance }],
          },
        });
        paymentId = p.payment.payment_id;
        this.counts.paymentsReceived++;
      }
      await this.save('invoice_payment', i.id, paymentId, 'paid');
      await this.save('invoice', i.id, l.zohoId, 'paid');
      await this.prisma.invoice.updateMany({ where: { id: i.id, paymentExportedAt: null }, data: { paymentExportedAt: new Date() } });
    }
  }

  async bill(b: BillRow, s: ZohoSettings) {
    let l = this.link('bill', b.id);
    if (!l) {
      const vendor = await this.contact('vendor', b.vendor, b.currency);
      const existing = await this.api.call<{ bills: { bill_id: string; bill_number: string; status: string; vendor_id?: string }[] }>('GET', '/bills', { query: { bill_number: b.number } });
      const hit = existing.bills.find((x) => x.bill_number === b.number && (!x.vendor_id || x.vendor_id === vendor));
      if (hit) {
        await this.save('bill', b.id, hit.bill_id, hit.status);
        this.counts.matched++;
      } else {
        const tax = await this.taxId(Number(b.taxPercent), b.taxName);
        const account = await this.accountId(this.cfg.expenseAccount);
        const created = await this.api.call<{ bill: { bill_id: string; status: string } }>('POST', '/bills', {
          body: {
            vendor_id: vendor,
            currency_id: this.currencyId(b.currency),
            bill_number: b.number,
            date: this.day(b.approvedAt ?? b.createdAt),
            ...(b.dueAt ? { due_date: this.day(b.dueAt) } : {}),
            ...(b.vendorReference ? { reference_number: b.vendorReference } : {}),
            ...(b.notes ? { notes: b.notes.slice(0, 5000) } : {}),
            ...(await this.exchangeRate(b.currency)),
            line_items: this.lines(b.lines).map((x) => ({ account_id: account, ...x, ...tax })),
          },
        });
        if (created.bill.status === 'draft') await this.api.call('POST', `/bills/${created.bill.bill_id}/status/open`);
        await this.save('bill', b.id, created.bill.bill_id, 'open');
        this.counts.bills++;
      }
      await this.prisma.vendorBill.updateMany({ where: { id: b.id, exportedAt: null }, data: { exportedAt: new Date() } });
      l = this.link('bill', b.id)!;
    }
    if (b.status === 'VOID' && l.state !== 'void') {
      await this.api.call('POST', `/bills/${l.zohoId}/status/void`);
      await this.save('bill', b.id, l.zohoId, 'void');
      this.counts.voided++;
      return;
    }
    if (b.status === 'PAID' && s.payments && !this.link('bill_payment', b.id)) {
      const zb = await this.api.call<{ bill: { balance: number; vendor_id: string } }>('GET', `/bills/${l.zohoId}`);
      const balance = money(Number(zb.bill.balance));
      let paymentId = 'already-paid';
      if (balance > 0) {
        const p = await this.api.call<{ vendorpayment: { payment_id: string } }>('POST', '/vendorpayments', {
          body: {
            vendor_id: zb.bill.vendor_id,
            payment_mode: this.cfg.paymentMode,
            amount: balance,
            date: this.day(b.paidAt ?? new Date()),
            reference_number: b.paymentReference ?? '',
            paid_through_account_id: await this.accountId(this.cfg.bankAccount),
            ...(await this.exchangeRate(b.currency)),
            bills: [{ bill_id: l.zohoId, amount_applied: balance }],
          },
        });
        paymentId = p.vendorpayment.payment_id;
        this.counts.paymentsMade++;
      }
      await this.save('bill_payment', b.id, paymentId, 'paid');
      await this.save('bill', b.id, l.zohoId, 'paid');
      await this.prisma.vendorBill.updateMany({ where: { id: b.id, paymentExportedAt: null }, data: { paymentExportedAt: new Date() } });
    }
  }
}

@Controller('accounting/zoho-books')
export class ZohoBooksController {
  constructor(private readonly svc: ZohoBooksService) {}

  @Get()
  @Roles(...EDITORS)
  status(@CurrentUser() u: AuthUser) {
    return this.svc.status(u.organizationId);
  }

  @Put('settings')
  @Roles('ADMIN')
  save(@CurrentUser() u: AuthUser, @Body(new ZodPipe(zohoSettingsSchema)) body: ZohoSettings) {
    return this.svc.saveSettings(u, body);
  }

  @Post('test')
  @HttpCode(200)
  @Roles('ADMIN')
  test(@CurrentUser() u: AuthUser) {
    return this.svc.test(u.organizationId);
  }

  @Post('sync')
  @Roles(...EDITORS)
  sync(@CurrentUser() u: AuthUser) {
    return this.svc.start(u.organizationId, 'manual', u.id);
  }
}
