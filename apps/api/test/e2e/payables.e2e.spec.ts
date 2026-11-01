import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { api, createApp, login, makeOrg, PASSWORD, resetDb } from './helpers';

describe('Vendor payables, tax and exchange rates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let projectId: string;
  let vendorA: string;
  let vendorB: string;
  let codes: Record<string, string>;
  let n = 0;
  const http = () => request(app.getHttpServer());

  async function complete(link: string) {
    const res = await http().get(`/s/${codes[link]}?uid=U${++n}`).set('X-Forwarded-For', `203.0.113.${n % 250}`).expect(302);
    const token = new URL(res.headers.location).searchParams.get('rid')!;
    await http().get(`/r/complete?token=${token}`).expect(302);
    return token;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'pay');
    const b = await makeOrg(prisma, 'pay-other');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    admin = api(app, await login(app, a.users.ADMIN.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Acme', code: 'ACME' }).expect(201)).body.id;
    vendorA = (await pm.post('/vendors', { name: 'Panel A', code: 'PA' }).expect(201)).body.id;
    vendorB = (await pm.post('/vendors', { name: 'Panel B', code: 'PB' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'Payables study',
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 10, targetCompletes: 50, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US', currency: 'USD' }, { countryCode: 'DE', language: 'de', cpi: 14, currency: 'EUR' }],
        })
        .expect(201)
    ).body;
    projectId = p.id;
    codes = {};
    for (const c of p.countries) {
      await pm.post(`/projects/${projectId}/countries/${c.id}/allocations`, { vendorId: vendorA, cpi: 4, targetCompletes: 50 }).expect(201);
      if (c.countryCode === 'US') await pm.post(`/projects/${projectId}/countries/${c.id}/allocations`, { vendorId: vendorB, cpi: 3.5, targetCompletes: 50 }).expect(201);
      await pm.patch(`/projects/${projectId}/countries/${c.id}`, { status: 'LIVE' }).expect(200);
    }
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);
    const detail = (await pm.get(`/projects/${projectId}`).expect(200)).body;
    for (const c of detail.countries) for (const al of c.allocations) codes[`${c.countryCode}:${al.vendor.code}`] = al.entryCode;

    // 3 US + 2 DE completes from Panel A, 2 US from Panel B. Approve all but one Panel B complete.
    const tokens = [await complete('US:PA'), await complete('US:PA'), await complete('US:PA'), await complete('DE:PA'), await complete('DE:PA'), await complete('US:PB')];
    await complete('US:PB');
    await pm.post(`/projects/${projectId}/reconciliation`, { ids: tokens, mode: 'approve_listed' }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('finance settings: admins set the reporting currency, default taxes and rates', async () => {
    const s0 = (await viewer.get('/organization/finance-settings').expect(200)).body;
    expect(s0).toMatchObject({ baseCurrency: 'USD', currencies: ['EUR', 'USD'], missing: ['EUR'], rates: [] });
    await pm.put('/organization/finance-settings', { baseCurrency: 'EUR' }).expect(403);
    await admin.put('/organization/finance-settings', { rates: [{ currency: 'usd', rate: 1 }] }).expect(400);
    await admin.put('/organization/finance-settings', { baseCurrency: 'USD', rates: [{ currency: 'USD', rate: 1 }] }).expect(400);
    const s1 = (await admin.put('/organization/finance-settings', { billTax: { name: 'GST', percent: 18 }, invoiceTax: { name: 'VAT', percent: 20 }, rates: [{ currency: 'EUR', rate: 1.1 }] }).expect(200)).body;
    expect(s1).toMatchObject({ billTax: { name: 'GST', percent: 18 }, invoiceTax: { name: 'VAT', percent: 20 }, missing: [], rates: [{ currency: 'EUR', rate: 1.1 }] });
  });

  it('summarises what each vendor is owed, with totals in the reporting currency', async () => {
    const s = (await viewer.get('/payables/summary').expect(200)).body;
    const row = (code: string, cur: string) => s.vendors.find((v: { vendor: { code: string }; currency: string }) => v.vendor.code === code && v.currency === cur);
    expect(row('PA', 'USD').unbilled).toEqual({ completes: 3, amount: 12 });
    expect(row('PA', 'EUR').unbilled).toEqual({ completes: 2, amount: 8 });
    expect(row('PB', 'USD')).toMatchObject({ unbilled: { completes: 1, amount: 3.5 }, pending: { completes: 1, amount: 3.5 } });
    // 12 + 3.5 USD + 8 EUR × 1.1
    expect(s.totals.unbilled.base).toEqual({ currency: 'USD', amount: 24.3, missing: [] });
    expect((await other.get('/payables/summary').expect(200)).body.vendors).toEqual([]);
  });

  it('creates one draft bill per vendor and currency with the default tax, and never bills twice', async () => {
    await viewer.post('/payables/bills', {}).expect(403);
    await other.post('/payables/bills', { vendorId: vendorA }).expect(404);
    const r = (await pm.post('/payables/bills', { vendorId: vendorA, notes: 'October' }).expect(201)).body;
    expect(r.bills.map((b: { currency: string }) => b.currency)).toEqual(['EUR', 'USD']);
    const usd = r.bills.find((b: { currency: string }) => b.currency === 'USD');
    expect(usd).toMatchObject({ status: 'DRAFT', completes: 3, subtotal: 12, taxName: 'GST', taxPercent: 18, taxAmount: 2.16, total: 14.16, number: expect.stringMatching(/^BILL-\d{4}-\d{5}$/) });
    expect(usd.lines).toEqual([expect.objectContaining({ countryCode: 'US', quantity: 3, unitPrice: 4, amount: 12 })]);
    await pm.post('/payables/bills', { vendorId: vendorA }).expect(400);
    const s = (await pm.get('/payables/summary').expect(200)).body;
    expect(s.vendors.find((v: { vendor: { code: string }; currency: string }) => v.vendor.code === 'PA' && v.currency === 'USD')).toMatchObject({ unbilled: { completes: 0 }, draft: { completes: 3, amount: 12 } });
    expect(await prisma.respondentSession.count({ where: { vendorBillId: usd.id } })).toBe(3);
  });

  it('a draft can change tax; approve records the vendor invoice and due date; paid records the payment', async () => {
    const [bill] = (await pm.get(`/payables/bills?vendorId=${vendorA}&status=DRAFT`).expect(200)).body.filter((b: { currency: string }) => b.currency === 'USD');
    expect((await pm.patch(`/payables/bills/${bill.id}`, { taxPercent: 0 }).expect(200)).body).toMatchObject({ taxAmount: 0, total: 12 });
    await pm.patch(`/payables/bills/${bill.id}`, { status: 'PAID' }).expect(400);
    await pm.patch(`/payables/bills/${bill.id}`, { paymentReference: 'X' }).expect(400);
    await viewer.patch(`/payables/bills/${bill.id}`, { status: 'APPROVED' }).expect(403);
    const approved = (await pm.patch(`/payables/bills/${bill.id}`, { status: 'APPROVED', vendorReference: 'PA-INV-77', dueDays: 15 }).expect(200)).body;
    expect(approved).toMatchObject({ status: 'APPROVED', vendorReference: 'PA-INV-77' });
    expect(new Date(approved.dueAt).getTime() - new Date(approved.approvedAt).getTime()).toBe(15 * 86_400_000);
    await pm.patch(`/payables/bills/${bill.id}`, { taxPercent: 5 }).expect(400);
    const paid = (await pm.patch(`/payables/bills/${bill.id}`, { status: 'PAID', paymentReference: 'WIRE-123' }).expect(200)).body;
    expect(paid).toMatchObject({ status: 'PAID', paymentReference: 'WIRE-123' });
    await pm.patch(`/payables/bills/${bill.id}`, { status: 'VOID' }).expect(400);
    await other.get(`/payables/bills/${bill.id}`).expect(404);
    const audit = await prisma.auditEvent.findMany({ where: { entityId: bill.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((x) => x.action)).toEqual(['bill.approved', 'bill.paid']);
  });

  it('voiding releases the completes to be billed again', async () => {
    const [eur] = (await pm.get(`/payables/bills?vendorId=${vendorA}&status=DRAFT`).expect(200)).body;
    await pm.patch(`/payables/bills/${eur.id}`, { status: 'VOID' }).expect(200);
    expect(await prisma.respondentSession.count({ where: { vendorBillId: eur.id } })).toBe(0);
    const again = (await pm.post('/payables/bills', { vendorId: vendorA }).expect(201)).body.bills;
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ currency: 'EUR', completes: 2 });
  });

  it('upTo leaves later completes for the next bill', async () => {
    await pm.post('/payables/bills', { vendorId: vendorB, upTo: '2000-01-01' }).expect(400);
    const b = (await pm.post('/payables/bills', { vendorId: vendorB, upTo: new Date().toISOString().slice(0, 10) }).expect(201)).body.bills;
    expect(b).toMatchObject([{ currency: 'USD', completes: 1, subtotal: 3.5 }]);
  });

  it('vendors see their own approved and paid bills in the portal, never drafts or voided ones', async () => {
    await admin.post('/portal-users', { kind: 'vendor', partyId: vendorA, name: 'Panel A billing', email: 'billing@panel-a.test', password: PASSWORD }).expect(201);
    const portal = api(app, await login(app, 'billing@panel-a.test'));
    const bills = (await portal.get('/portal/vendor/bills').expect(200)).body;
    expect(bills.map((x: { status: string; currency: string }) => `${x.status}:${x.currency}`)).toEqual(['PAID:USD']);
    const draft = await prisma.vendorBill.findFirstOrThrow({ where: { vendorId: vendorA, status: 'DRAFT' } });
    await portal.get(`/portal/vendor/bills/${draft.id}`).expect(404);
    await portal.get(`/portal/vendor/bills/${bills[0].id}`).expect(200);
    const billB = await prisma.vendorBill.findFirstOrThrow({ where: { vendorId: vendorB } });
    await prisma.vendorBill.update({ where: { id: billB.id }, data: { status: 'APPROVED' } });
    await portal.get(`/portal/vendor/bills/${billB.id}`).expect(404);
    await portal.get('/payables/summary').expect(403);
  });

  it('client invoices carry the default tax, and the dashboard shows totals in the reporting currency', async () => {
    const inv = (await pm.post(`/projects/${projectId}/invoices`, {}).expect(201)).body.invoices;
    const usd = inv.find((i: { currency: string }) => i.currency === 'USD');
    expect(usd).toMatchObject({ subtotal: 40, taxName: 'VAT', taxPercent: 20, taxAmount: 8, total: 48 });
    expect((await pm.patch(`/invoices/${usd.id}`, { taxName: 'IGST', taxPercent: 18 }).expect(200)).body).toMatchObject({ taxName: 'IGST', taxAmount: 7.2, total: 47.2 });
    await pm.patch(`/invoices/${usd.id}`, { status: 'SENT' }).expect(200);
    await pm.patch(`/invoices/${usd.id}`, { taxPercent: 0 }).expect(400);

    const d = (await pm.get('/dashboard').expect(200)).body;
    // Invoiced: USD 40 (sent); invoice pending: EUR 28 × 1.1 (draft).
    expect(d.finance.invoiced.base).toEqual({ currency: 'USD', amount: 40, missing: [] });
    expect(d.finance.invoicePending.base).toEqual({ currency: 'USD', amount: 30.8, missing: [] });
    expect(d.payables.paid.base.amount).toBe(12);
    expect(d.payables.due.base.amount).toBe(3.5);

    await admin.put('/organization/finance-settings', { rates: [] }).expect(200);
    expect((await pm.get('/dashboard').expect(200)).body.finance.invoicePending.base).toEqual({ currency: 'USD', amount: 0, missing: ['EUR'] });
  });
});
