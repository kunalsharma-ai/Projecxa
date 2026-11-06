/**
 * Subscription payments (docs/SUBSCRIPTION_PAYMENTS.md): organisations pay the server owner for their plan,
 * online (Razorpay or Stripe, keys set up in Settings → Integrations of the server owner) or offline
 * (bank transfer, UPI, cheque, cash; the Super Admin confirms). A paid invoice renews the subscription.
 */
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BillingInterval, BillingInvoice, BillingInvoiceStatus, Plan, Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { webBaseOf } from '../branding/branding';
import { configuredIn, IntegrationsService } from '../integrations/integrations.service';
import { MailService } from '../mail/mail.service';
import { renderInvoicePdf } from '../pdf/invoice-pdf';
import { amount as fmtAmount } from '../pdf/pdf';
import { PrismaService } from '../prisma/prisma.service';
import { esc, SuperAdminService } from '../super-admin/super-admin.service';

export const OFFLINE_METHODS = ['bank_transfer', 'upi', 'cheque', 'cash', 'other'] as const;
export type OfflineMethod = (typeof OFFLINE_METHODS)[number];
export type Provider = 'razorpay' | 'stripe';
export const METHOD_LABEL: Record<string, string> = {
  razorpay: 'Razorpay', stripe: 'Stripe (card)', bank_transfer: 'Bank transfer', upi: 'UPI', cheque: 'Cheque', cash: 'Cash', other: 'Other',
};
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const PROOF_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const ZERO_DECIMAL = ['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'PYG', 'RWF'];

/** Saved in the server owner organisation (platformSettings.billing). */
export interface BillingSettings {
  /** Show "Pay online" when Razorpay or Stripe is set up. */
  onlineEnabled: boolean;
  /** Let organisations tell you they paid offline. */
  offlineEnabled: boolean;
  offlineMethods: OfflineMethod[];
  bankDetails: string | null;
  upiId: string | null;
  offlineInstructions: string | null;
  taxName: string | null;
  taxPercent: number;
  sellerName: string | null;
  sellerAddress: string | null;
  sellerTaxId: string | null;
  sellerEmail: string | null;
  invoiceFooter: string | null;
}
export const DEFAULT_BILLING: BillingSettings = {
  onlineEnabled: true, offlineEnabled: true, offlineMethods: ['bank_transfer', 'upi', 'cheque'], bankDetails: null, upiId: null, offlineInstructions: null,
  taxName: null, taxPercent: 0, sellerName: null, sellerAddress: null, sellerTaxId: null, sellerEmail: null, invoiceFooter: null,
};

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? null : Number(d));
const round2 = (n: number) => Math.round(n * 100) / 100;
export const minor = (total: number, currency: string) => (ZERO_DECIMAL.includes(currency.toUpperCase()) ? Math.round(total) : Math.round(total * 100));
export const money = (currency: string, n: number) => `${currency} ${fmtAmount(n)}`;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Adds months, keeping the day of the month where possible (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  const want = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(want, last));
  return r;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const hmac = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

/** Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]; signed payload is `${t}.${raw}`. */
export function stripeSignatureOk(header: string, raw: Buffer, secret: string, now = Date.now(), toleranceSec = 300): boolean {
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const want = hmac(secret, `${t}.${raw.toString('utf8')}`);
  return sigs.some((s) => safeEqual(s, want));
}

type InvoiceWithPlan = BillingInvoice & { plan: Plan; organization?: { id: string; name: string } };

@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly superAdmin: SuperAdminService,
  ) {}

  // ───────────── Settings ─────────────

  async settings(): Promise<BillingSettings> {
    const s = (await this.superAdmin.settings()) as unknown as { billing?: Partial<BillingSettings> };
    return { ...DEFAULT_BILLING, ...(s.billing ?? {}) };
  }

  async saveSettings(u: AuthUser, body: Partial<BillingSettings>) {
    const next = { ...(await this.settings()), ...body };
    const owner = await this.superAdmin.ownerId();
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: owner }, select: { platformSettings: true } });
    const ps = { ...((o.platformSettings ?? {}) as object), billing: next };
    await this.prisma.organization.update({ where: { id: owner }, data: { platformSettings: ps as Prisma.InputJsonValue } });
    await this.audit.record({ organizationId: owner, actorId: u.id, action: 'superadmin.billing_settings', entityType: 'Platform', entityId: 'billing', detail: { changed: Object.keys(body), bySuperAdmin: u.name } });
    return next;
  }

  /** Which gateways are set up (in the server owner's Settings → Integrations, or the environment). */
  async providers(): Promise<Provider[]> {
    const out: Provider[] = [];
    for (const p of ['razorpay', 'stripe'] as const) {
      const r = await this.integrations.resolve(null, p);
      if (r.source && configuredIn(p, r.env)) out.push(p);
    }
    return out;
  }

  private async keys(p: Provider) {
    const r = await this.integrations.resolve(null, p);
    if (!r.source || !configuredIn(p, r.env)) throw new BadRequestException(`${p === 'razorpay' ? 'Razorpay' : 'Stripe'} is not set up. Ask your SampTrek provider.`);
    return r.env as Record<string, string | undefined>;
  }

  // ───────────── What the organisation sees ─────────────

  private priceOf(plan: Plan, interval: BillingInterval) {
    return num(interval === 'YEARLY' ? plan.priceYearly : plan.priceMonthly);
  }

  private async org(orgId: string) {
    const o = await this.prisma.organization.findUnique({ where: { id: orgId }, include: { subscription: { include: { plan: true } } } });
    if (!o) throw new NotFoundException('Organisation not found');
    return o;
  }

  async overview(u: AuthUser) {
    const o = await this.org(u.organizationId);
    if (o.platformOwner) return { owner: true };
    const s = await this.settings();
    const providers = s.onlineEnabled ? await this.providers() : [];
    const plans = (await this.prisma.plan.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }))
      .filter((p) => p.priceMonthly != null || p.priceYearly != null || p.id === o.subscription?.planId)
      .map((p) => ({ id: p.id, code: p.code, name: p.name, description: p.description, priceLabel: p.priceLabel, currency: p.currency, priceMonthly: num(p.priceMonthly), priceYearly: num(p.priceYearly), maxUsers: p.maxUsers, maxProjects: p.maxProjects, mobileEnabled: p.mobileEnabled, features: p.features.length }));
    const invoices = await this.prisma.billingInvoice.findMany({ where: { organizationId: o.id }, orderBy: { createdAt: 'desc' }, take: 50, include: { plan: true } });
    const sub = o.subscription;
    return {
      owner: false,
      organization: o.name,
      subscription: sub ? { plan: { code: sub.plan.code, name: sub.plan.name }, status: sub.status, startsAt: sub.startsAt, endsAt: sub.endsAt, trialEndsAt: sub.trialEndsAt, billingInterval: sub.billingInterval } : null,
      plans,
      tax: { name: s.taxName, percent: s.taxPercent },
      online: { providers, razorpayKeyId: providers.includes('razorpay') ? (await this.keys('razorpay')).RAZORPAY_KEY_ID?.trim() : null },
      offline: s.offlineEnabled ? { methods: s.offlineMethods, bankDetails: s.bankDetails, upiId: s.upiId, instructions: s.offlineInstructions } : null,
      seller: s.sellerName,
      invoices: invoices.map((i) => this.view(i)),
    };
  }

  view(i: InvoiceWithPlan) {
    return {
      id: i.id, number: i.number, status: i.status, plan: { code: i.plan.code, name: i.plan.name }, interval: i.interval, currency: i.currency,
      amount: num(i.amount), taxName: i.taxName, taxPercent: num(i.taxPercent), taxAmount: num(i.taxAmount), total: num(i.total),
      method: i.method, reference: i.reference, paidOn: i.paidOn, paidAt: i.paidAt, note: i.note, reviewNote: i.reviewNote,
      hasProof: !!i.proofName, proofName: i.proofName, periodStart: i.periodStart, periodEnd: i.periodEnd, createdAt: i.createdAt,
      ...(i.organization ? { organization: i.organization } : {}),
    };
  }

  // ───────────── Invoices ─────────────

  private async nextNumber() {
    const [r] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('billing_invoice_seq') AS n`;
    return `SUB-${new Date().getUTCFullYear()}-${String(r.n).padStart(5, '0')}`;
  }

  private async create(orgId: string, planCode: string, interval: BillingInterval, by: AuthUser | null, opts: { amount?: number | null; anyPlan?: boolean; data?: Partial<Prisma.BillingInvoiceUncheckedCreateInput> } = {}) {
    const o = await this.org(orgId);
    if (o.platformOwner) throw new BadRequestException('The organisation that runs the server does not pay for a plan');
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan || (!opts.anyPlan && !plan.active && plan.id !== o.subscription?.planId)) throw new BadRequestException('That plan is not offered');
    const price = opts.amount ?? this.priceOf(plan, interval);
    if (price == null) throw new BadRequestException(`The ${plan.name} plan has no ${interval === 'YEARLY' ? 'yearly' : 'monthly'} price`);
    const s = await this.settings();
    const taxAmount = round2((price * (s.taxPercent || 0)) / 100);
    return this.prisma.billingInvoice.create({
      data: {
        number: await this.nextNumber(), organizationId: o.id, planId: plan.id, interval, currency: plan.currency,
        amount: price, taxName: s.taxPercent ? s.taxName || 'Tax' : null, taxPercent: s.taxPercent || 0, taxAmount, total: round2(price + taxAmount),
        createdById: by?.id ?? null, ...opts.data,
      },
      include: { plan: true },
    });
  }

  private async mine(u: AuthUser, id: string) {
    const i = await this.prisma.billingInvoice.findFirst({ where: { id, organizationId: u.organizationId }, include: { plan: true } });
    if (!i) throw new NotFoundException('Invoice not found');
    return i;
  }

  // ───────────── Online ─────────────

  private gateway(p: Provider) {
    return p === 'razorpay' ? process.env.RAZORPAY_API_URL ?? 'https://api.razorpay.com' : process.env.STRIPE_API_URL ?? 'https://api.stripe.com';
  }

  async checkout(u: AuthUser, b: { planCode: string; interval: BillingInterval; provider: Provider }) {
    const s = await this.settings();
    if (!s.onlineEnabled || !(await this.providers()).includes(b.provider)) throw new BadRequestException('Online payment is not available. Pay offline or ask your SampTrek provider.');
    // Earlier unfinished checkouts are cancelled (a late payment for one is still honoured).
    await this.prisma.billingInvoice.updateMany({ where: { organizationId: u.organizationId, status: 'OPEN', method: { in: ['razorpay', 'stripe'] } }, data: { status: 'CANCELLED' } });
    const inv = await this.create(u.organizationId, b.planCode, b.interval, u, { data: { method: b.provider } });
    const env = await this.keys(b.provider);
    const total = num(inv.total)!;
    const label = `SampTrek ${inv.plan.name}, ${inv.interval === 'YEARLY' ? '1 year' : '1 month'}`;
    const o = await this.org(u.organizationId);
    try {
      if (b.provider === 'razorpay') {
        const auth = Buffer.from(`${env.RAZORPAY_KEY_ID!.trim()}:${env.RAZORPAY_KEY_SECRET!.trim()}`).toString('base64');
        const r = await fetch(`${this.gateway('razorpay')}/v1/orders`, {
          method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: minor(total, inv.currency), currency: inv.currency, receipt: inv.number, notes: { invoiceId: inv.id, organization: o.name } }),
        });
        const j = (await r.json().catch(() => ({}))) as { id?: string; error?: { description?: string } };
        if (!r.ok || !j.id) throw new Error(j.error?.description ?? `Razorpay answered ${r.status}`);
        await this.prisma.billingInvoice.update({ where: { id: inv.id }, data: { providerOrderId: j.id } });
        return { provider: 'razorpay', invoiceId: inv.id, number: inv.number, keyId: env.RAZORPAY_KEY_ID!.trim(), orderId: j.id, amount: minor(total, inv.currency), currency: inv.currency, name: s.sellerName || 'SampTrek', description: label, prefill: { name: u.name, email: u.email } };
      }
      const web = webBaseOf(o);
      const form = new URLSearchParams({
        mode: 'payment', client_reference_id: inv.id, 'metadata[invoiceId]': inv.id, 'metadata[number]': inv.number, customer_email: u.email,
        success_url: `${web}/settings/subscription?invoice=${inv.id}&paid=stripe`, cancel_url: `${web}/settings/subscription?invoice=${inv.id}&cancelled=1`,
        'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': inv.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(minor(total, inv.currency)), 'line_items[0][price_data][product_data][name]': label,
      });
      const r = await fetch(`${this.gateway('stripe')}/v1/checkout/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY!.trim()}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      const j = (await r.json().catch(() => ({}))) as { id?: string; url?: string; error?: { message?: string } };
      if (!r.ok || !j.id || !j.url) throw new Error(j.error?.message ?? `Stripe answered ${r.status}`);
      await this.prisma.billingInvoice.update({ where: { id: inv.id }, data: { providerOrderId: j.id } });
      return { provider: 'stripe', invoiceId: inv.id, number: inv.number, url: j.url };
    } catch (e) {
      await this.prisma.billingInvoice.update({ where: { id: inv.id }, data: { status: 'CANCELLED', reviewNote: (e as Error).message.slice(0, 500) } });
      this.log.warn(`Checkout with ${b.provider} failed: ${(e as Error).message}`);
      throw new BadRequestException(`The payment could not be started: ${(e as Error).message}`);
    }
  }

  /** Razorpay Checkout returns order id, payment id and signature = HMAC(order_id|payment_id, key secret). */
  async razorpayVerify(u: AuthUser, b: { invoiceId: string; orderId: string; paymentId: string; signature: string }) {
    const inv = await this.mine(u, b.invoiceId);
    if (inv.providerOrderId !== b.orderId) throw new BadRequestException('That payment is for another invoice');
    const env = await this.keys('razorpay');
    if (!safeEqual(hmac(env.RAZORPAY_KEY_SECRET!.trim(), `${b.orderId}|${b.paymentId}`), b.signature)) throw new BadRequestException('The payment could not be verified');
    return this.view(await this.markPaid(inv.id, { method: 'razorpay', providerPaymentId: b.paymentId, reference: b.paymentId, by: null, gateway: true }));
  }

  /** Back from Stripe Checkout: asks Stripe whether the session was paid. */
  async stripeConfirm(u: AuthUser, invoiceId: string) {
    const inv = await this.mine(u, invoiceId);
    if (inv.status === 'PAID') return this.view(inv);
    if (inv.method !== 'stripe' || !inv.providerOrderId) throw new BadRequestException('That invoice was not paid with Stripe');
    const paid = await this.stripeSessionPaid(inv.providerOrderId, inv);
    if (!paid) return this.view(inv);
    return this.view(await this.markPaid(inv.id, { method: 'stripe', providerPaymentId: paid, reference: paid, by: null, gateway: true }));
  }

  private async stripeSessionPaid(sessionId: string, inv: BillingInvoice): Promise<string | null> {
    const env = await this.keys('stripe');
    const r = await fetch(`${this.gateway('stripe')}/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY!.trim()}` } });
    const j = (await r.json().catch(() => ({}))) as { payment_status?: string; amount_total?: number; currency?: string; payment_intent?: string | { id: string } };
    if (!r.ok || j.payment_status !== 'paid') return null;
    if (j.amount_total !== minor(num(inv.total)!, inv.currency) || j.currency?.toUpperCase() !== inv.currency) {
      this.log.error(`Stripe session ${sessionId} paid ${j.amount_total} ${j.currency}, invoice ${inv.number} is ${inv.total} ${inv.currency}`);
      return null;
    }
    return (typeof j.payment_intent === 'string' ? j.payment_intent : j.payment_intent?.id) ?? sessionId;
  }

  /** POST /public/billing/razorpay/webhook, X-Razorpay-Signature = HMAC(raw body, webhook secret). */
  async razorpayWebhook(raw: Buffer | undefined, signature: string | undefined) {
    const env = await this.keys('razorpay');
    const secret = env.RAZORPAY_WEBHOOK_SECRET?.trim();
    if (!secret || !raw || !signature || !safeEqual(hmac(secret, raw), signature)) throw new ForbiddenException('Bad signature');
    const e = JSON.parse(raw.toString('utf8')) as { event?: string; payload?: { payment?: { entity?: { id: string; order_id: string; amount: number; currency: string; status: string } } } };
    const p = e.payload?.payment?.entity;
    if (!['payment.captured', 'order.paid'].includes(e.event ?? '') || !p?.order_id) return { ok: true, ignored: true };
    const inv = await this.prisma.billingInvoice.findUnique({ where: { providerOrderId: p.order_id } });
    if (!inv) return { ok: true, ignored: true };
    if (p.amount !== minor(num(inv.total)!, inv.currency) || p.currency !== inv.currency) {
      this.log.error(`Razorpay order ${p.order_id} paid ${p.amount} ${p.currency}, invoice ${inv.number} is ${inv.total} ${inv.currency}`);
      return { ok: true, ignored: true };
    }
    await this.markPaid(inv.id, { method: 'razorpay', providerPaymentId: p.id, reference: p.id, by: null, gateway: true });
    return { ok: true };
  }

  /** POST /public/billing/stripe/webhook, checked with the Stripe-Signature header. */
  async stripeWebhook(raw: Buffer | undefined, signature: string | undefined) {
    const env = await this.keys('stripe');
    const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret || !raw || !signature || !stripeSignatureOk(signature, raw, secret)) throw new ForbiddenException('Bad signature');
    const e = JSON.parse(raw.toString('utf8')) as { type?: string; data?: { object?: { id: string; payment_status?: string; client_reference_id?: string; metadata?: { invoiceId?: string } } } };
    const s = e.data?.object;
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(e.type ?? '') || !s?.id) return { ok: true, ignored: true };
    const inv = await this.prisma.billingInvoice.findUnique({ where: { providerOrderId: s.id } });
    if (!inv || inv.status === 'PAID') return { ok: true, ignored: true };
    // Confirm with Stripe itself rather than trusting the event body alone.
    const paid = await this.stripeSessionPaid(s.id, inv);
    if (paid) await this.markPaid(inv.id, { method: 'stripe', providerPaymentId: paid, reference: paid, by: null, gateway: true });
    return { ok: true };
  }

  // ───────────── Offline ─────────────

  async submitOffline(u: AuthUser, b: { planCode: string; interval: BillingInterval; method: OfflineMethod; reference: string; paidOn: Date; note?: string | null }, file?: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    const s = await this.settings();
    if (!s.offlineEnabled) throw new BadRequestException('Offline payment is not available. Ask your SampTrek provider.');
    if (!s.offlineMethods.includes(b.method)) throw new BadRequestException('That payment method is not accepted');
    if (b.paidOn.getTime() > Date.now() + 86_400_000) throw new BadRequestException('The payment date is in the future');
    if (file) {
      if (file.size > MAX_PROOF_BYTES) throw new BadRequestException('The proof file is larger than 5 MB');
      if (!PROOF_TYPES.includes(file.mimetype)) throw new BadRequestException('Attach a PDF, PNG, JPG or WebP file');
    }
    const pending = await this.prisma.billingInvoice.count({ where: { organizationId: u.organizationId, status: 'PENDING_REVIEW' } });
    if (pending >= 3) throw new BadRequestException('You already have payments waiting to be checked. Please wait for them first.');
    const inv = await this.create(u.organizationId, b.planCode, b.interval, u, {
      data: {
        status: 'PENDING_REVIEW', method: b.method, reference: b.reference, paidOn: b.paidOn, note: b.note ?? null,
        ...(file ? { proofName: file.originalname.slice(0, 200), proofType: file.mimetype, proofData: new Uint8Array(file.buffer) } : {}),
      },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'billing.offline_submitted', entityType: 'BillingInvoice', entityId: inv.id, detail: { number: inv.number, method: b.method, reference: b.reference, total: num(inv.total) } });
    const o = await this.org(u.organizationId);
    await this.superAdmin.onEvent('payment.submitted', o.id, { amount: money(inv.currency, num(inv.total)!), detail: `${METHOD_LABEL[b.method]}, reference ${b.reference}`, date: day(b.paidOn)! }, `submitted:${inv.id}`).catch((e) => this.log.warn(`Automation: ${(e as Error).message}`));
    return this.view(inv);
  }

  async cancel(u: AuthUser, id: string) {
    const inv = await this.mine(u, id);
    if (!['OPEN', 'PENDING_REVIEW'].includes(inv.status)) throw new BadRequestException('Only unpaid invoices can be cancelled');
    return this.view(await this.prisma.billingInvoice.update({ where: { id }, data: { status: 'CANCELLED' }, include: { plan: true } }));
  }

  // ───────────── Paying an invoice ─────────────

  /**
   * Marks the invoice paid and renews the subscription on its plan: from the current end date while it is
   * still running, otherwise from now. Idempotent (webhook and browser can both arrive).
   */
  async markPaid(id: string, p: { method: string; providerPaymentId?: string | null; reference?: string | null; paidOn?: Date | null; by: AuthUser | null; note?: string | null; gateway?: boolean }) {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.billingInvoice.findUnique({ where: { id }, include: { plan: true } });
      if (!inv) throw new NotFoundException('Invoice not found');
      if (inv.status === 'PAID') return { inv, fresh: false };
      // Money that reached a gateway is honoured even for an invoice cancelled meanwhile.
      if (!p.gateway && inv.status === 'CANCELLED') throw new BadRequestException('That invoice was cancelled');
      const claimed = await tx.billingInvoice.updateMany({ where: { id, status: { not: 'PAID' } }, data: { status: 'PAID' } });
      if (!claimed.count) return { inv: (await tx.billingInvoice.findUniqueOrThrow({ where: { id }, include: { plan: true } })), fresh: false };
      const sub = await tx.subscription.findUnique({ where: { organizationId: inv.organizationId } });
      const running = sub && (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') && sub.endsAt && sub.endsAt > now;
      const start = running ? sub.endsAt! : now;
      const end = addMonths(start, inv.interval === 'YEARLY' ? 12 : 1);
      const data = { planId: inv.planId, status: 'ACTIVE' as const, endsAt: end, trialEndsAt: null, billingInterval: inv.interval, updatedById: p.by?.id ?? null };
      if (sub) await tx.subscription.update({ where: { id: sub.id }, data });
      else await tx.subscription.create({ data: { organizationId: inv.organizationId, startsAt: now, ...data } });
      const updated = await tx.billingInvoice.update({
        where: { id },
        data: {
          paidAt: now, method: p.method, providerPaymentId: p.providerPaymentId ?? inv.providerPaymentId, reference: p.reference ?? inv.reference,
          paidOn: p.paidOn ?? inv.paidOn ?? now, periodStart: start, periodEnd: end, reviewedById: p.by?.id ?? null, reviewNote: p.note ?? inv.reviewNote,
        },
        include: { plan: true },
      });
      return { inv: updated, fresh: true };
    });
    const inv = result.inv;
    if (result.fresh) {
      await this.audit.record({
        organizationId: inv.organizationId, actorId: p.by?.id ?? null, action: 'billing.paid', entityType: 'BillingInvoice', entityId: inv.id,
        detail: { number: inv.number, plan: inv.plan.code, method: inv.method, total: num(inv.total), currency: inv.currency, until: day(inv.periodEnd), ...(p.by ? { bySuperAdmin: p.by.name } : {}) },
      });
      await this.receipt(inv).catch((e) => this.log.warn(`Receipt email for ${inv.number} not sent: ${(e as Error).message}`));
      await this.superAdmin.onEvent('payment.received', inv.organizationId, { amount: money(inv.currency, num(inv.total)!), detail: `${METHOD_LABEL[inv.method ?? 'other'] ?? inv.method}, ${inv.number}`, date: day(inv.periodEnd)! }, `paid:${inv.id}`).catch((e) => this.log.warn(`Automation: ${(e as Error).message}`));
    }
    return inv;
  }

  private async admins(orgId: string) {
    return (await this.prisma.user.findMany({ where: { organizationId: orgId, role: 'ADMIN', active: true }, select: { email: true } })).map((u) => u.email);
  }

  private async sendToOrg(orgId: string, subject: string, lines: string[], attachments?: { filename: string; content: Buffer; contentType: string }[]) {
    const to = await this.admins(orgId);
    if (!to.length) return;
    await this.mail.send({
      organizationId: await this.superAdmin.ownerId(), to, subject, text: lines.join('\n\n'),
      html: lines.map((l) => `<p>${esc(l).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join(''), attachments,
    });
  }

  private async receipt(inv: InvoiceWithPlan) {
    const o = await this.org(inv.organizationId);
    const pdf = await this.pdfOf(inv);
    await this.sendToOrg(inv.organizationId, `Payment received: ${inv.number}`, [
      `Thank you. We received ${money(inv.currency, num(inv.total)!)} for the ${inv.plan.name} plan (${inv.interval === 'YEARLY' ? 'yearly' : 'monthly'}).`,
      `Your subscription is active until ${day(inv.periodEnd)}.`,
      `Your invoices: ${webBaseOf(o)}/settings/subscription`,
    ], [{ filename: `${inv.number}.pdf`, content: pdf, contentType: 'application/pdf' }]);
  }

  async pdfOf(inv: InvoiceWithPlan): Promise<Buffer> {
    const s = await this.settings();
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: inv.organizationId }, select: { name: true, slug: true, invoiceProfile: true } });
    const ownerId = await this.superAdmin.ownerId();
    const owner = await this.prisma.organization.findUniqueOrThrow({ where: { id: ownerId }, select: { name: true } });
    const buyer = (o.invoiceProfile ?? {}) as { legalName?: string | null; address?: string | null; taxId?: string | null };
    const period = inv.periodStart && inv.periodEnd ? `${day(inv.periodStart)} to ${day(inv.periodEnd)}` : inv.interval === 'YEARLY' ? '1 year' : '1 month';
    const paid = inv.status === 'PAID';
    return renderInvoicePdf({
      org: owner.name,
      profile: { legalName: s.sellerName, address: s.sellerAddress, taxId: s.sellerTaxId, email: s.sellerEmail, phone: null, bankDetails: paid ? null : [s.bankDetails, s.upiId && `UPI: ${s.upiId}`].filter(Boolean).join('\n') || null, footer: s.invoiceFooter },
      number: inv.number, status: inv.status === 'PENDING_REVIEW' ? 'OPEN' : inv.status, currency: inv.currency,
      issuedAt: day(inv.createdAt), dueAt: null, paidAt: paid ? day(inv.paidAt) : null,
      paymentReference: paid ? [METHOD_LABEL[inv.method ?? ''] ?? inv.method, inv.reference].filter(Boolean).join(' ') : null,
      client: { name: buyer.legalName || o.name, code: o.slug, billingAddress: buyer.address ?? null, taxId: buyer.taxId ?? null },
      project: { code: inv.plan.code, name: `${inv.plan.name} plan, ${inv.interval === 'YEARLY' ? 'yearly' : 'monthly'}`, workOrderNo: null },
      lines: [{ description: `SampTrek ${inv.plan.name} subscription (${period})`, countryCode: null, quantity: 1, unitPrice: num(inv.amount)!, amount: num(inv.amount)! }],
      subtotal: num(inv.amount)!, taxName: inv.taxName, taxPercent: num(inv.taxPercent)!, taxAmount: num(inv.taxAmount)!, total: num(inv.total)!,
      notes: inv.note,
    });
  }

  async myPdf(u: AuthUser, id: string) {
    const inv = await this.mine(u, id);
    return { name: `${inv.number}.pdf`, pdf: await this.pdfOf(inv) };
  }

  // ───────────── Super Admin ─────────────

  async adminList(q: { status?: BillingInvoiceStatus; organizationId?: string }) {
    const where: Prisma.BillingInvoiceWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.organizationId ? { organizationId: q.organizationId } : {}) };
    const rows = await this.prisma.billingInvoice.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300, include: { plan: true, organization: { select: { id: true, name: true } } } });
    const pending = await this.prisma.billingInvoice.findMany({ where: { status: 'PENDING_REVIEW' }, orderBy: { createdAt: 'asc' }, include: { plan: true, organization: { select: { id: true, name: true } } } });
    const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const paid = await this.prisma.billingInvoice.findMany({ where: { status: 'PAID', paidAt: { gte: yearStart } }, select: { total: true, currency: true, paidAt: true, method: true } });
    const sum = (rows: typeof paid) => Object.entries(rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.currency]: round2((a[r.currency] ?? 0) + Number(r.total)) }), {})).map(([currency, total]) => ({ currency, total }));
    const providers = await this.providers();
    return {
      summary: {
        month: sum(paid.filter((r) => r.paidAt! >= monthStart)), year: sum(paid), payments: paid.length,
        online: paid.filter((r) => r.method === 'razorpay' || r.method === 'stripe').length, pending: pending.length,
      },
      providers,
      pending: pending.map((i) => this.view(i)),
      invoices: rows.map((i) => this.view(i)),
    };
  }

  private async any(id: string) {
    const i = await this.prisma.billingInvoice.findUnique({ where: { id }, include: { plan: true, organization: { select: { id: true, name: true } } } });
    if (!i) throw new NotFoundException('Invoice not found');
    return i;
  }

  async confirm(u: AuthUser, id: string, note?: string | null) {
    const i = await this.any(id);
    if (!['PENDING_REVIEW', 'OPEN', 'REJECTED'].includes(i.status)) throw new BadRequestException('Only unpaid invoices can be confirmed');
    return this.view(await this.markPaid(id, { method: i.method ?? 'other', by: u, note }));
  }

  async reject(u: AuthUser, id: string, note: string) {
    const i = await this.any(id);
    if (i.status !== 'PENDING_REVIEW') throw new BadRequestException('Only payments waiting to be checked can be turned down');
    const r = await this.prisma.billingInvoice.update({ where: { id }, data: { status: 'REJECTED', reviewNote: note, reviewedById: u.id }, include: { plan: true } });
    await this.audit.record({ organizationId: i.organizationId, actorId: u.id, action: 'billing.offline_rejected', entityType: 'BillingInvoice', entityId: id, detail: { number: i.number, note, bySuperAdmin: u.name } });
    const o = await this.org(i.organizationId);
    await this.sendToOrg(i.organizationId, `We could not find your payment ${i.number}`, [
      `We could not match your ${METHOD_LABEL[i.method ?? ''] ?? ''} payment of ${money(i.currency, num(i.total)!)} (reference ${i.reference ?? '–'}).`,
      `Reason: ${note}`,
      `Check the details and send them again, or pay online: ${webBaseOf(o)}/settings/subscription`,
    ]).catch((e) => this.log.warn(`Email not sent: ${(e as Error).message}`));
    return this.view(r);
  }

  async adminCancel(u: AuthUser, id: string) {
    const i = await this.any(id);
    if (i.status === 'PAID' || i.status === 'CANCELLED') throw new BadRequestException('That invoice cannot be cancelled');
    await this.audit.record({ organizationId: i.organizationId, actorId: u.id, action: 'billing.cancelled', entityType: 'BillingInvoice', entityId: id, detail: { number: i.number, bySuperAdmin: u.name } });
    return this.view(await this.prisma.billingInvoice.update({ where: { id }, data: { status: 'CANCELLED', reviewedById: u.id }, include: { plan: true } }));
  }

  /** The Super Admin records a payment received outside SampTrek (renews at once). */
  async record(u: AuthUser, b: { organizationId: string; planCode: string; interval: BillingInterval; amount?: number | null; method: string; reference?: string | null; paidOn?: Date | null; note?: string | null }) {
    const inv = await this.create(b.organizationId, b.planCode, b.interval, u, { amount: b.amount, anyPlan: true, data: { method: b.method, reference: b.reference ?? null, paidOn: b.paidOn ?? new Date(), note: b.note ?? null } });
    return this.view(await this.markPaid(inv.id, { method: b.method, reference: b.reference, paidOn: b.paidOn, by: u }));
  }

  async proof(id: string) {
    const i = await this.any(id);
    if (!i.proofData) throw new NotFoundException('No proof was attached');
    return { name: i.proofName ?? 'proof', type: i.proofType ?? 'application/octet-stream', data: Buffer.from(i.proofData) };
  }

  async adminPdf(id: string) {
    const i = await this.any(id);
    return { name: `${i.number}.pdf`, pdf: await this.pdfOf(i) };
  }
}

