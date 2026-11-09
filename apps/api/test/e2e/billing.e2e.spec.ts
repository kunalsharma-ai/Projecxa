import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import { createHmac } from 'crypto';
import request from 'supertest';
import { addMonths, stripeSignatureOk } from '../../src/billing/billing.service';
import { Mail, MailService } from '../../src/mail/mail.service';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const RZP = { RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'rzp-secret', RAZORPAY_WEBHOOK_SECRET: 'rzp-hook' };
const STRIPE = { STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: 'whsec_456' };
const hmac = (k: string, d: string) => createHmac('sha256', k).update(d).digest('hex');

describe('Subscription payments: online (Razorpay, Stripe) and offline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let owner: Awaited<ReturnType<typeof makeOrg>>;
  let tenant: Awaited<ReturnType<typeof makeOrg>>;
  let sa: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let adminToken: string;
  const sent: Mail[] = [];
  const realFetch = global.fetch;
  /** Fake Razorpay and Stripe: records calls, answers like the real APIs. */
  const calls: { url: string; init?: RequestInit }[] = [];
  const stripeSessions = new Map<string, { payment_status: string; amount_total: number; currency: string; payment_intent: string }>();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    await prisma.automationRule.deleteMany();
    await prisma.plan.deleteMany();
    owner = await makeOrg(prisma, 'bill-owner');
    tenant = await makeOrg(prisma, 'bill-tenant');
    await prisma.organization.update({ where: { id: owner.org.id }, data: { platformOwner: true } });
    await prisma.user.update({ where: { id: owner.users.ADMIN.id }, data: { superAdmin: true } });
    app.get(MailService).transport = async (_from, m) => { sent.push(m); return { messageId: 'x' }; };
    process.env.RAZORPAY_API_URL = 'http://razorpay.fake';
    process.env.STRIPE_API_URL = 'http://stripe.fake';
    global.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('http://razorpay.fake') && !url.startsWith('http://stripe.fake')) return realFetch(input, init);
      calls.push({ url, init });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.endsWith('/v1/orders')) {
        const b = JSON.parse(String(init!.body)) as { amount: number; currency: string };
        return json({ id: `order_${calls.length}`, amount: b.amount, currency: b.currency, status: 'created' });
      }
      if (url.endsWith('/v1/payments?count=1') || url.endsWith('/v1/balance')) return json({ items: [] });
      if (url.endsWith('/v1/checkout/sessions')) {
        const f = new URLSearchParams(String(init!.body));
        const id = `cs_test_${calls.length}`;
        stripeSessions.set(id, { payment_status: 'unpaid', amount_total: Number(f.get('line_items[0][price_data][unit_amount]')), currency: f.get('line_items[0][price_data][currency]')!, payment_intent: `pi_${calls.length}` });
        return json({ id, url: `https://checkout.stripe.test/${id}` });
      }
      const m = /\/v1\/checkout\/sessions\/(.+)$/.exec(url);
      if (m) return stripeSessions.has(m[1]) ? json({ id: m[1], ...stripeSessions.get(m[1]) }) : json({ error: { message: 'No such session' } }, 404);
      return json({ error: { message: 'not found' } }, 404);
    }) as typeof fetch;

    sa = api(app, await login(app, owner.users.ADMIN.email));
    adminToken = await login(app, tenant.users.ADMIN.email);
    admin = api(app, adminToken);
    pm = api(app, await login(app, tenant.users.PROJECT_MANAGER.email));

    // Plans with prices; the tenant is on a trial of Starter.
    await sa.get('/super-admin/plans').expect(200);
    const plans = (await sa.get('/super-admin/plans').expect(200)).body as { id: string; code: string }[];
    const starter = plans.find((p) => p.code === 'starter')!;
    const pro = plans.find((p) => p.code === 'professional')!;
    await sa.patch(`/super-admin/plans/${starter.id}`, { priceMonthly: 1000, priceYearly: 10000, currency: 'INR' }).expect(200);
    await sa.patch(`/super-admin/plans/${pro.id}`, { priceMonthly: 2500, currency: 'INR' }).expect(200);
    await sa.put(`/super-admin/organizations/${tenant.org.id}/subscription`, { planCode: 'starter', status: 'TRIAL', trialEndsAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }).expect(200);
    await sa.put('/super-admin/billing/settings', { taxName: 'GST', taxPercent: 18, sellerName: 'Sampledge Pvt Ltd', bankDetails: 'HDFC 1234 IFSC HDFC0001', upiId: 'sampledge@hdfc', offlineMethods: ['bank_transfer', 'upi', 'cheque'] }).expect(200);
  });

  afterAll(async () => {
    global.fetch = realFetch;
    delete process.env.RAZORPAY_API_URL;
    delete process.env.STRIPE_API_URL;
    await app.close();
  });

  it('adds months keeping the day where it can', () => {
    expect(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonths(new Date('2026-03-15T00:00:00Z'), 12).toISOString()).toBe('2027-03-15T00:00:00.000Z');
  });

  it('shows plans with prices and tax only to the organisation’s admins', async () => {
    await pm.get('/billing').expect(403);
    const b = (await admin.get('/billing').expect(200)).body;
    expect(b.subscription.status).toBe('TRIAL');
    expect(b.plans.map((p: { code: string }) => p.code)).toEqual(['starter', 'professional']);
    expect(b.plans[0]).toMatchObject({ priceMonthly: 1000, priceYearly: 10000, currency: 'INR' });
    expect(b.tax).toEqual({ name: 'GST', percent: 18 });
    expect(b.online.providers).toEqual([]);
    expect(b.offline).toMatchObject({ bankDetails: 'HDFC 1234 IFSC HDFC0001', upiId: 'sampledge@hdfc' });
    // Gateways are set up by the server owner only; tenants never see them in their integrations.
    const kinds = (await admin.get('/integrations/settings').expect(200)).body.integrations.map((i: { kind: string }) => i.kind);
    expect(kinds).not.toContain('razorpay');
    await admin.post('/billing/checkout', { planCode: 'starter', interval: 'MONTHLY', provider: 'razorpay' }).expect(400);
  });

  it('pays online with Razorpay: order, signature check, renewal, receipt, webhook is idempotent', async () => {
    await sa.put('/integrations/settings/razorpay', { values: RZP }).expect(200);
    expect((await sa.post('/integrations/settings/razorpay/test').expect(200)).body.ok).toBe(true);
    expect((await admin.get('/billing').expect(200)).body.online).toEqual({ providers: ['razorpay'], razorpayKeyId: 'rzp_test_abc' });

    const c = (await admin.post('/billing/checkout', { planCode: 'starter', interval: 'MONTHLY', provider: 'razorpay' }).expect(200)).body;
    expect(c).toMatchObject({ provider: 'razorpay', keyId: 'rzp_test_abc', amount: 118000, currency: 'INR' });
    expect(c.number).toMatch(/^SUB-\d{4}-\d{5}$/);
    // A forged signature is refused.
    await admin.post('/billing/razorpay/verify', { invoiceId: c.invoiceId, orderId: c.orderId, paymentId: 'pay_1', signature: 'nope' }).expect(400);
    sent.length = 0;
    const paid = (await admin.post('/billing/razorpay/verify', { invoiceId: c.invoiceId, orderId: c.orderId, paymentId: 'pay_1', signature: hmac(RZP.RAZORPAY_KEY_SECRET, `${c.orderId}|pay_1`) }).expect(200)).body;
    expect(paid).toMatchObject({ status: 'PAID', method: 'razorpay', reference: 'pay_1', total: 1180, taxAmount: 180 });
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: tenant.org.id } });
    expect(sub.status).toBe('ACTIVE');
    expect(sub.trialEndsAt).toBeNull();
    expect(sub.billingInterval).toBe('MONTHLY');
    expect(Math.round((sub.endsAt!.getTime() - Date.now()) / 86_400_000)).toBeGreaterThanOrEqual(28);
    expect(sent.find((m) => m.subject.startsWith('Payment received'))?.attachments?.[0].contentType).toBe('application/pdf');

    // The webhook for the same payment changes nothing (no double renewal).
    const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: c.orderId, amount: 118000, currency: 'INR', status: 'captured' } } } });
    await http().post('/api/v1/public/billing/razorpay/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', 'bad').send(raw).expect(403);
    await http().post('/api/v1/public/billing/razorpay/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', hmac(RZP.RAZORPAY_WEBHOOK_SECRET, raw)).send(raw).expect(200);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: tenant.org.id } })).endsAt).toEqual(sub.endsAt);

    const pdf = await admin.get(`/billing/invoices/${c.invoiceId}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('confirms a Razorpay payment from the webhook alone (page closed) and checks the amount', async () => {
    const before = (await prisma.subscription.findUniqueOrThrow({ where: { organizationId: tenant.org.id } })).endsAt!;
    const c = (await admin.post('/billing/checkout', { planCode: 'starter', interval: 'YEARLY', provider: 'razorpay' }).expect(200)).body;
    const send = (amount: number) => {
      const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_2', order_id: c.orderId, amount, currency: 'INR', status: 'captured' } } } });
      return http().post('/api/v1/public/billing/razorpay/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', hmac(RZP.RAZORPAY_WEBHOOK_SECRET, raw)).send(raw).expect(200);
    };
    await send(100); // wrong amount: ignored
    expect((await prisma.billingInvoice.findUniqueOrThrow({ where: { id: c.invoiceId } })).status).toBe('OPEN');
    await send(1180000);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: tenant.org.id } });
    // Renewed from the end of the period already paid, by a year.
    expect(sub.endsAt!.toISOString()).toBe(addMonths(before, 12).toISOString());
    expect(sub.billingInterval).toBe('YEARLY');
  });

  it('pays with Stripe Checkout: redirect, confirm on return, signed webhook', async () => {
    await sa.put('/integrations/settings/stripe', { values: STRIPE }).expect(200);
    const c = (await admin.post('/billing/checkout', { planCode: 'professional', interval: 'MONTHLY', provider: 'stripe' }).expect(200)).body;
    expect(c.url).toMatch(/^https:\/\/checkout\.stripe\.test\/cs_test_/);
    const sessionId = c.url.split('/').pop();
    const body = new URLSearchParams(String(calls.find((x) => x.url.endsWith('/v1/checkout/sessions'))!.init!.body));
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('295000');
    expect(body.get('success_url')).toContain('/settings/subscription?invoice=');

    // Back from Stripe before paying: still open.
    expect((await admin.post('/billing/stripe/confirm', { invoiceId: c.invoiceId }).expect(200)).body.status).toBe('OPEN');
    stripeSessions.get(sessionId)!.payment_status = 'paid';
    const t = Math.floor(Date.now() / 1000);
    const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: sessionId, payment_status: 'paid', client_reference_id: c.invoiceId } } });
    expect(stripeSignatureOk(`t=${t},v1=${hmac(STRIPE.STRIPE_WEBHOOK_SECRET, `${t}.${raw}`)}`, Buffer.from(raw), STRIPE.STRIPE_WEBHOOK_SECRET)).toBe(true);
    expect(stripeSignatureOk(`t=${t - 3600},v1=${hmac(STRIPE.STRIPE_WEBHOOK_SECRET, `${t - 3600}.${raw}`)}`, Buffer.from(raw), STRIPE.STRIPE_WEBHOOK_SECRET)).toBe(false);
    await http().post('/api/v1/public/billing/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', `t=${t},v1=deadbeef`).send(raw).expect(403);
    await http().post('/api/v1/public/billing/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', `t=${t},v1=${hmac(STRIPE.STRIPE_WEBHOOK_SECRET, `${t}.${raw}`)}`).send(raw).expect(200);
    const inv = await prisma.billingInvoice.findUniqueOrThrow({ where: { id: c.invoiceId } });
    expect(inv).toMatchObject({ status: 'PAID', method: 'stripe', providerPaymentId: stripeSessions.get(sessionId)!.payment_intent });
    // Upgraded to Professional at once.
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: tenant.org.id }, include: { plan: true } })).plan.code).toBe('professional');
    expect((await admin.post('/billing/stripe/confirm', { invoiceId: c.invoiceId }).expect(200)).body.status).toBe('PAID');
  });

  it('accepts an offline payment with proof; the Super Admin checks, turns down or confirms it', async () => {
    await prisma.automationRule.deleteMany();
    await sa.post('/super-admin/automations/recipes/payment-review').expect(201);
    const before = (await prisma.subscription.findUniqueOrThrow({ where: { organizationId: tenant.org.id } })).endsAt!;
    sent.length = 0;
    const form = () => http().post('/api/v1/billing/offline').set('Authorization', `Bearer ${adminToken}`);
    const submit = () => form()
      .field('planCode', 'professional').field('interval', 'MONTHLY').field('method', 'upi').field('reference', 'UTR123456').field('paidOn', '2026-11-04')
      .attach('proof', Buffer.from('%PDF-1.4 fake'), { filename: 'receipt.pdf', contentType: 'application/pdf' });
    await form().field('planCode', 'professional').field('interval', 'MONTHLY').field('method', 'cash').field('reference', 'R1').field('paidOn', '2026-11-04').expect(400); // cash not accepted
    const a = (await submit().expect(201)).body;
    expect(a).toMatchObject({ status: 'PENDING_REVIEW', method: 'upi', reference: 'UTR123456', hasProof: true, total: 2950 });
    // The automation recipe told the Super Admins and added a task.
    expect(sent.find((m) => m.subject.includes('paid INR 2,950.00 offline'))).toBeTruthy();
    expect(await prisma.task.count({ where: { organizationId: owner.org.id, title: { contains: 'offline payment' } } })).toBe(1);

    const list = (await sa.get('/super-admin/billing').expect(200)).body;
    expect(list.summary.pending).toBe(1);
    expect(list.pending[0]).toMatchObject({ id: a.id, organization: { name: tenant.org.name } });
    const proof = await sa.get(`/super-admin/billing/invoices/${a.id}/proof`).expect(200);
    expect(proof.headers['content-type']).toBe('application/pdf');
    await admin.get(`/super-admin/billing/invoices/${a.id}/proof`).expect(403);

    sent.length = 0;
    await sa.post(`/super-admin/billing/invoices/${a.id}/reject`, { note: 'No UPI payment with that UTR' }).expect(200);
    expect(sent.find((m) => m.subject.includes('could not find your payment'))?.text).toContain('No UPI payment with that UTR');
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: tenant.org.id } })).endsAt).toEqual(before);

    const b = (await submit().expect(201)).body;
    const ok = (await sa.post(`/super-admin/billing/invoices/${b.id}/confirm`, { note: 'Seen in bank statement' }).expect(200)).body;
    expect(ok.status).toBe('PAID');
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: tenant.org.id } })).endsAt!.toISOString()).toBe(addMonths(before, 1).toISOString());
    await sa.post(`/super-admin/billing/invoices/${b.id}/confirm`, {}).expect(400);
  });

  it('lets an admin renew after the subscription ended, while everything else stays blocked', async () => {
    await prisma.subscription.update({ where: { organizationId: tenant.org.id }, data: { status: 'EXPIRED' } });
    expect((await admin.get('/projects').expect(403)).body.code).toBe('SUBSCRIPTION_INACTIVE');
    await pm.get('/billing').expect(403);
    expect((await admin.get('/billing').expect(200)).body.subscription.status).toBe('EXPIRED');
    // The Super Admin records a cheque received by post.
    const r = (await sa.post('/super-admin/billing/payments', { organizationId: tenant.org.id, planCode: 'starter', interval: 'YEARLY', method: 'cheque', reference: 'CHQ 000981', amount: 9000 }).expect(201)).body;
    expect(r).toMatchObject({ status: 'PAID', amount: 9000, taxAmount: 1620, total: 10620 });
    await admin.get('/projects').expect(200);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: tenant.org.id } });
    expect(sub.status).toBe('ACTIVE');
    expect(Math.round((sub.endsAt!.getTime() - Date.now()) / 86_400_000)).toBeGreaterThanOrEqual(364);
    const sum = (await sa.get('/super-admin/billing').expect(200)).body.summary;
    expect(sum.year[0].currency).toBe('INR');
    expect(sum.payments).toBe(5);
    await admin.get('/super-admin/billing').expect(403);
  });
});
