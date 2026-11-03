import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { clearZohoTokens, Http } from '../../src/accounting/zoho-books.client';
import { ZohoBooksService } from '../../src/accounting/zoho-books.service';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

/** An in-memory Zoho Books that answers the calls the sync makes. */
function fakeZoho() {
  const calls: { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> | null }[] = [];
  const state = {
    tokens: 0,
    rejectToken: false,
    contacts: [{ contact_id: 'c-existing', contact_name: 'Panel A', contact_type: 'vendor', currency_code: 'USD' }] as { contact_id: string; contact_name: string; contact_type: string; currency_code: string }[],
    invoices: [] as { invoice_id: string; invoice_number: string; status: string; customer_id: string; total: number; balance: number; body?: Record<string, unknown> }[],
    bills: [] as { bill_id: string; bill_number: string; status: string; vendor_id: string; balance: number; body?: Record<string, unknown> }[],
    payments: [] as Record<string, unknown>[],
    vendorPayments: [] as Record<string, unknown>[],
    taxes: [{ tax_id: 't-18', tax_name: 'GST', tax_percentage: 18 }],
    rateLimitOnce: false,
  };
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;
  const ok = (o: object) => ({ status: 200, headers: { get: () => null }, json: async () => ({ code: 0, message: 'success', ...o }) });
  const err = (status: number, code: number, message: string) => ({ status, headers: { get: () => null }, json: async () => ({ code, message }) });
  const http: Http = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/oauth/v2/token') {
      state.tokens++;
      const form = new URLSearchParams(init.body);
      if (state.rejectToken || form.get('grant_type') !== 'refresh_token' || form.get('refresh_token') !== 'refresh-abc') return { status: 400, json: async () => ({ error: 'invalid_code' }) };
      return { status: 200, json: async () => ({ access_token: `tok-${state.tokens}`, expires_in: 3600 }) };
    }
    const path = u.pathname.replace('/books/v3', '');
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method: init.method, path, query: u.searchParams, body });
    if (!init.headers.Authorization?.startsWith('Zoho-oauthtoken tok-')) return err(401, 57, 'You are not authorized');
    if (u.searchParams.get('organization_id') !== '600000123') return err(400, 6041, 'Invalid organization');
    if (state.rateLimitOnce) {
      state.rateLimitOnce = false;
      return { status: 429, headers: { get: (h: string) => (h === 'retry-after' ? '1' : null) }, json: async () => ({ code: 45, message: 'Too many requests' }) };
    }
    const m = `${init.method} ${path}`;
    if (m === 'GET /organizations/600000123') return ok({ organization: { name: 'Frequent Research (test)', currency_code: 'USD' } });
    if (m === 'GET /settings/currencies') return ok({ currencies: [{ currency_id: 'cur-usd', currency_code: 'USD' }, { currency_id: 'cur-eur', currency_code: 'EUR' }] });
    if (m === 'GET /settings/taxes') return ok({ taxes: state.taxes });
    if (m === 'GET /chartofaccounts') return ok({ chartofaccounts: [{ account_id: 'acc-bank', account_name: 'Bank', account_type: 'bank' }, { account_id: 'acc-cogs', account_name: 'Cost of Goods Sold', account_type: 'cost_of_goods_sold' }] });
    if (m === 'GET /items') return ok({ items: [{ item_id: 'item-1', name: 'Survey completes' }] });
    if (m === 'GET /contacts') return ok({ contacts: state.contacts.filter((c) => c.contact_name.toLowerCase() === (u.searchParams.get('contact_name') ?? '').toLowerCase()) });
    if (m === 'POST /contacts') {
      const c = { contact_id: id('c'), contact_name: String(body!.contact_name), contact_type: String(body!.contact_type), currency_code: body!.currency_id === 'cur-eur' ? 'EUR' : 'USD' };
      state.contacts.push(c);
      return ok({ contact: c });
    }
    if (m === 'GET /invoices') return ok({ invoices: state.invoices.filter((i) => i.invoice_number === u.searchParams.get('invoice_number')) });
    if (m === 'POST /invoices') {
      if (u.searchParams.get('ignore_auto_number_generation') !== 'true') return err(400, 1, 'Invoice number is auto generated');
      const lines = body!.line_items as { rate: number; quantity: number; tax_id?: string }[];
      const sub = lines.reduce((t, l) => t + l.rate * l.quantity, 0);
      const total = Math.round(sub * (lines[0]?.tax_id ? 1.18 : 1) * 100) / 100;
      const i = { invoice_id: id('inv'), invoice_number: String(body!.invoice_number), status: 'draft', customer_id: String(body!.customer_id), total, balance: total, body: body! };
      state.invoices.push(i);
      return ok({ invoice: i });
    }
    let r = path.match(/^\/invoices\/([\w-]+)\/status\/(sent|void)$/);
    if (init.method === 'POST' && r) {
      const i = state.invoices.find((x) => x.invoice_id === r![1]);
      if (!i) return err(404, 5, 'Invoice does not exist');
      i.status = r[2] === 'sent' ? 'sent' : 'void';
      return ok({});
    }
    r = path.match(/^\/invoices\/([\w-]+)$/);
    if (init.method === 'GET' && r) return ok({ invoice: state.invoices.find((x) => x.invoice_id === r![1]) });
    if (m === 'POST /customerpayments') {
      const inv = (body!.invoices as { invoice_id: string; amount_applied: number }[])[0];
      const i = state.invoices.find((x) => x.invoice_id === inv.invoice_id)!;
      if (inv.amount_applied > i.balance) return err(400, 24016, 'Amount applied is more than the balance');
      i.balance = Math.round((i.balance - inv.amount_applied) * 100) / 100;
      i.status = i.balance ? 'partially_paid' : 'paid';
      state.payments.push(body!);
      return ok({ payment: { payment_id: id('pay') } });
    }
    if (m === 'GET /bills') return ok({ bills: state.bills.filter((b) => b.bill_number === u.searchParams.get('bill_number')) });
    if (m === 'POST /bills') {
      const lines = body!.line_items as { rate: number; quantity: number; tax_id?: string; account_id?: string }[];
      if (lines.some((l) => !l.account_id)) return err(400, 2, 'Account is required');
      const total = Math.round(lines.reduce((t, l) => t + l.rate * l.quantity, 0) * (lines[0]?.tax_id ? 1.18 : 1) * 100) / 100;
      const b = { bill_id: id('bill'), bill_number: String(body!.bill_number), status: 'draft', vendor_id: String(body!.vendor_id), balance: total, body: body! };
      state.bills.push(b);
      return ok({ bill: b });
    }
    r = path.match(/^\/bills\/([\w-]+)\/status\/(open|void)$/);
    if (init.method === 'POST' && r) {
      state.bills.find((x) => x.bill_id === r![1])!.status = r[2];
      return ok({});
    }
    r = path.match(/^\/bills\/([\w-]+)$/);
    if (init.method === 'GET' && r) return ok({ bill: state.bills.find((x) => x.bill_id === r![1]) });
    if (m === 'POST /vendorpayments') {
      const app = (body!.bills as { bill_id: string; amount_applied: number }[])[0];
      const b = state.bills.find((x) => x.bill_id === app.bill_id)!;
      b.balance = Math.round((b.balance - app.amount_applied) * 100) / 100;
      b.status = 'paid';
      state.vendorPayments.push(body!);
      return ok({ vendorpayment: { payment_id: id('vpay') } });
    }
    return err(404, 404, `Fake Zoho has no ${m}`);
  };
  return { http, calls, state };
}

describe('Payment exports and Zoho Books sync (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let svc: ZohoBooksService;
  let pm: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let org: string;
  let zoho: ReturnType<typeof fakeZoho>;
  const ids: Record<string, string> = {};
  const env = { ...process.env };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    svc = app.get(ZohoBooksService);
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'zb');
    const b = await makeOrg(prisma, 'zb-other');
    org = a.org.id;
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    admin = api(app, await login(app, a.users.ADMIN.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.ADMIN.email));
    const clientId = (await pm.post('/clients', { name: 'Acme Insights', code: 'ACME' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Panel A', code: 'PA' }).expect(201)).body.id;
    const project = (
      await pm.post('/projects', { name: 'Brand study', category: 'B2C', clientId, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 10, targetCompletes: 50, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' }, countries: [{ countryCode: 'US', currency: 'USD' }] }).expect(201)
    ).body;
    const lines = [{ countryCode: 'US', description: 'Completes US', quantity: 10, unitPrice: 12.5, amount: 125 }];
    const inv = (number: string, status: 'SENT' | 'PAID', currency: string, tax: number, issuedAt: string, paidAt?: string) =>
      prisma.invoice.create({ data: { organizationId: org, projectId: project.id, clientId, number, status, currency, lines, completes: 10, subtotal: 125, taxName: tax ? 'GST' : null, taxPercent: tax, taxAmount: (125 * tax) / 100, total: 125 + (125 * tax) / 100, issuedAt: new Date(issuedAt), dueAt: new Date(new Date(issuedAt).getTime() + 30 * 86400000), paidAt: paidAt ? new Date(paidAt) : null, paymentReference: paidAt ? 'UTR-991' : null } });
    ids.i1 = (await inv('INV-2026-00101', 'SENT', 'USD', 18, '2026-10-05T10:00:00Z')).id;
    ids.i2 = (await inv('INV-2026-00102', 'PAID', 'EUR', 0, '2026-10-06T10:00:00Z', '2026-10-25T10:00:00Z')).id;
    ids.old = (await inv('INV-2026-00050', 'SENT', 'USD', 0, '2026-08-01T10:00:00Z')).id;
    ids.b1 = (
      await prisma.vendorBill.create({ data: { organizationId: org, vendorId, number: 'BILL-2026-00101', status: 'PAID', currency: 'USD', lines: [{ projectId: project.id, projectCode: project.projectCode, countryCode: 'US', description: 'Brand study US', quantity: 10, unitPrice: 4, amount: 40 }], completes: 10, subtotal: 40, total: 40, vendorReference: 'PA-77', paymentReference: 'NEFT-12', approvedAt: new Date('2026-10-10T08:00:00Z'), paidAt: new Date('2026-10-28T08:00:00Z') } })
    ).id;
  });
  afterAll(async () => {
    process.env = env;
    await app.close();
  });

  const copyOld = async () => {
    const { id: _id, createdAt: _c, updatedAt: _u, lines, ...rest } = await prisma.invoice.findUniqueOrThrow({ where: { id: ids.old } });
    return { ...rest, lines: lines as Prisma.InputJsonValue };
  };
  const connect = () => {
    Object.assign(process.env, { ZOHO_BOOKS_CLIENT_ID: '1000.ABC', ZOHO_BOOKS_CLIENT_SECRET: 'secret', ZOHO_BOOKS_REFRESH_TOKEN: 'refresh-abc', ZOHO_BOOKS_ORGANIZATION_ID: '600000123', ZOHO_BOOKS_TENANT: 'zb', ZOHO_BOOKS_DC: 'in' });
    zoho = fakeZoho();
    clearZohoTokens();
    svc.http = zoho.http;
    svc.gapMs = 0;
    svc.sleep = async () => undefined;
  };
  const sync = async (as = pm) => {
    const run = (await as.post('/accounting/zoho-books/sync', {}).expect(201)).body;
    expect(run.status).toBe('running');
    await svc.current;
    return (await as.get('/accounting/zoho-books').expect(200)).body.runs.find((r: { id: string }) => r.id === run.id);
  };

  it('records a payment reference when an invoice is marked paid, and only then', async () => {
    await pm.patch(`/invoices/${ids.i1}`, { paymentReference: 'X' }).expect(400);
    const sent = await prisma.invoice.create({ data: { ...(await copyOld()), number: 'INV-2026-00999', lines: [], issuedAt: new Date('2026-07-01T00:00:00Z') } });
    const r = (await pm.patch(`/invoices/${sent.id}`, { status: 'PAID', paymentReference: ' UTR-1 ' }).expect(200)).body;
    expect(r.paymentReference).toBe('UTR-1');
    await prisma.invoice.delete({ where: { id: sent.id } });
  });

  it('exports payments received and made, by payment date, separately from the invoice export', async () => {
    const f = (o: object) => ({ format: 'zoho_books', kind: 'payments_received', from: '2026-10-01', to: '2026-10-31', ...o });
    const p = (await pm.post('/accounting/exports/preview', f({})).expect(200)).body;
    expect(p.documents.map((d: { number: string }) => d.number)).toEqual(['INV-2026-00102']);
    expect(p.documents[0].paymentReference).toBe('UTR-991');
    const none = (await pm.post('/accounting/exports/preview', f({ from: '2026-10-01', to: '2026-10-20' })).expect(200)).body;
    expect(none.invoiceCount).toBe(0); // paid on the 25th: the payment date counts, not the invoice date
    const e = (await pm.post('/accounting/exports', f({})).expect(201)).body;
    const csv = (await pm.get(`/accounting/exports/${e.id}/download`).expect(200)).text;
    expect(csv).toContain('Customer Name,Payment Mode,Deposit To,Amount,Reference Number,Invoice Number');
    expect(csv).toContain('2026-10-25,Acme Insights,Bank Transfer,Bank,125.00,UTR-991,INV-2026-00102,125.00,EUR');
    // The payment is marked exported; the invoice itself is still new for an invoices export.
    expect((await pm.post('/accounting/exports/preview', f({})).expect(200)).body.invoiceCount).toBe(0);
    expect((await pm.post('/accounting/exports/preview', f({ kind: 'invoices', format: 'zoho_books' })).expect(200)).body.invoiceCount).toBe(2);
    const j = (await pm.post('/accounting/exports', { format: 'journal', kind: 'payments_made', from: '2026-10-01', to: '2026-10-31' }).expect(201)).body;
    const jc = (await pm.get(`/accounting/exports/${j.id}/download`).expect(200)).text;
    expect(jc).toMatch(/Accounts Payable.*40\.00/);
    expect(jc).toMatch(/Bank.*40\.00/);
    const t = await pm.post('/accounting/exports/preview', { format: 'quickbooks', kind: 'payments_received' }).expect(400);
    expect(JSON.stringify(t.body)).toMatch(/payments are not supported/);
    await pm.post('/accounting/exports', { format: 'tally', kind: 'payments_made', onlyNew: false }).expect(201);
    // Undo the marks so the sync below starts clean.
    await prisma.invoice.updateMany({ data: { paymentExportedAt: null } });
    await prisma.vendorBill.updateMany({ data: { paymentExportedAt: null } });
  });

  it('shows what is missing when Zoho Books is not set up, and refuses to sync', async () => {
    for (const k of ['ZOHO_BOOKS_CLIENT_ID', 'ZOHO_BOOKS_CLIENT_SECRET', 'ZOHO_BOOKS_REFRESH_TOKEN', 'ZOHO_BOOKS_ORGANIZATION_ID', 'ZOHO_BOOKS_TENANT']) delete process.env[k];
    const s = (await pm.get('/accounting/zoho-books').expect(200)).body;
    expect(s).toMatchObject({ configured: false, boundHere: false, runs: [] });
    expect(s.missing).toContain('ZOHO_BOOKS_REFRESH_TOKEN');
    const r = await pm.post('/accounting/zoho-books/sync', {}).expect(400);
    expect(r.body.message).toMatch(/not set up/);
    await viewer.get('/accounting/zoho-books').expect(403);
  });

  it('tests the connection and the account names, admins only', async () => {
    connect();
    await pm.post('/accounting/zoho-books/test', {}).expect(403);
    const t = (await admin.post('/accounting/zoho-books/test', {}).expect(200)).body;
    expect(t.organization).toEqual({ name: 'Frequent Research (test)', currency: 'USD' });
    expect(t.checks.map((c: { label: string; ok: boolean }) => [c.label, c.ok])).toEqual([['Connection', true], ['Bank account', true], ['Expense account', true], ['Taxes', true]]);
    const s = (await pm.get('/accounting/zoho-books').expect(200)).body;
    expect(s).toMatchObject({ configured: true, boundHere: true, dataCentre: 'in', apiHost: 'www.zohoapis.in' });
    expect(JSON.stringify(s)).not.toContain('refresh-abc');
    // Another Projexa organisation cannot use this Zoho Books connection.
    expect((await other.get('/accounting/zoho-books').expect(200)).body).toMatchObject({ configured: true, boundHere: false, otherTenant: true });
    expect((await other.post('/accounting/zoho-books/sync', {}).expect(400)).body.message).toMatch(/another Projexa organisation/);
  });

  it('needs a start date before syncing', async () => {
    expect((await pm.post('/accounting/zoho-books/sync', {}).expect(400)).body.message).toMatch(/date to sync from/);
    await pm.put('/accounting/zoho-books/settings', { hourly: false, since: '2026-10-01', invoices: true, bills: true, payments: true }).expect(403);
    await admin.put('/accounting/zoho-books/settings', { hourly: true, since: null, invoices: true, bills: true, payments: true }).expect(400);
    await admin.put('/accounting/zoho-books/settings', { hourly: false, since: '2026-10-01', invoices: true, bills: true, payments: true }).expect(200);
  });

  it('creates contacts, invoices, bills and payments, and never twice', async () => {
    zoho.state.rateLimitOnce = true;
    const run = await sync();
    expect(run.errors).toEqual([]);
    expect(run).toMatchObject({ status: 'ok', trigger: 'manual', counts: { customers: 2, vendors: 0, invoices: 2, bills: 1, matched: 0, paymentsReceived: 1, paymentsMade: 1, voided: 0 } });
    // The client is billed in USD and EUR: one Zoho contact per currency. The vendor already existed.
    expect(zoho.state.contacts.map((c) => [c.contact_name, c.contact_type, c.currency_code])).toEqual([['Panel A', 'vendor', 'USD'], ['Acme Insights', 'customer', 'USD'], ['Acme Insights (EUR)', 'customer', 'EUR']]);
    const i1 = zoho.state.invoices.find((i) => i.invoice_number === 'INV-2026-00101')!;
    expect(i1.status).toBe('sent');
    expect(i1.body).toMatchObject({ date: '2026-10-05', due_date: '2026-11-04', currency_id: 'cur-usd', line_items: [{ item_id: 'item-1', name: 'Survey completes', description: 'Completes US', quantity: 10, rate: 12.5, tax_id: 't-18' }] });
    expect(zoho.state.invoices.find((i) => i.invoice_number === 'INV-2026-00102')!.status).toBe('paid');
    expect(zoho.state.invoices.some((i) => i.invoice_number === 'INV-2026-00050')).toBe(false); // before the start date
    expect(zoho.state.payments[0]).toMatchObject({ payment_mode: 'Bank Transfer', amount: 125, date: '2026-10-25', reference_number: 'UTR-991', account_id: 'acc-bank' });
    expect(zoho.state.bills[0]).toMatchObject({ bill_number: 'BILL-2026-00101', status: 'paid', vendor_id: 'c-existing' });
    expect(zoho.state.bills[0].body).toMatchObject({ reference_number: 'PA-77', line_items: [{ account_id: 'acc-cogs', quantity: 10, rate: 4 }] });
    expect(zoho.state.vendorPayments[0]).toMatchObject({ paid_through_account_id: 'acc-bank', amount: 40, reference_number: 'NEFT-12' });
    // Synced documents count as exported, so a CSV export does not send them again.
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: ids.i1 } })).exportedAt).not.toBeNull();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: ids.i2 } })).paymentExportedAt).not.toBeNull();
    expect(zoho.state.tokens).toBe(1);

    const before = zoho.calls.filter((c) => c.method === 'POST').length;
    const again = await sync();
    expect(again).toMatchObject({ status: 'ok', counts: { invoices: 0, bills: 0, paymentsReceived: 0, customers: 0 } });
    expect(zoho.calls.filter((c) => c.method === 'POST').length).toBe(before);
  });

  it('pays an invoice and voids another on a later run', async () => {
    await pm.patch(`/invoices/${ids.i1}`, { status: 'PAID', paymentReference: 'UTR-2' }).expect(200);
    const i3 = await prisma.invoice.create({ data: { ...(await copyOld()), number: 'INV-2026-00103', issuedAt: new Date('2026-10-30T10:00:00Z'), exportedAt: null } });
    const r1 = await sync();
    expect(r1.counts).toMatchObject({ invoices: 1, paymentsReceived: 1 });
    expect(zoho.state.payments[1]).toMatchObject({ amount: 147.5, reference_number: 'UTR-2' });
    await pm.patch(`/invoices/${i3.id}`, { status: 'VOID' }).expect(200);
    const r2 = await sync();
    expect(r2.counts.voided).toBe(1);
    expect(zoho.state.invoices.find((i) => i.invoice_number === 'INV-2026-00103')!.status).toBe('void');
    expect((await sync()).counts.voided).toBe(0);
  });

  it('links a document that is already in Zoho Books instead of creating it, and reports per-document problems', async () => {
    const base = await copyOld();
    await prisma.invoice.create({ data: { ...base, number: 'INV-2026-00104', issuedAt: new Date('2026-10-31T10:00:00Z') } });
    await prisma.invoice.create({ data: { ...base, number: 'INV-2026-00105', issuedAt: new Date('2026-10-31T11:00:00Z'), taxName: 'VAT', taxPercent: 5, taxAmount: 6.25, total: 131.25 } });
    const customer = zoho.state.contacts.find((c) => c.contact_name === 'Acme Insights')!.contact_id;
    zoho.state.invoices.push({ invoice_id: 'inv-manual', invoice_number: 'INV-2026-00104', status: 'sent', customer_id: customer, total: 125, balance: 125 });
    const run = await sync();
    expect(run.status).toBe('partial');
    expect(run.counts).toMatchObject({ matched: 1, invoices: 0 });
    expect(run.errors).toEqual([{ type: 'invoice', number: 'INV-2026-00105', message: 'No tax of 5% in Zoho Books. Add it under Settings → Taxes.' }]);
    expect(zoho.state.invoices.filter((i) => i.invoice_number === 'INV-2026-00104')).toHaveLength(1);
    // Once the tax exists the next run picks it up.
    zoho.state.taxes.push({ tax_id: 't-5', tax_name: 'VAT', tax_percentage: 5 });
    expect((await sync()).counts.invoices).toBe(1);
  });

  it('fails the run clearly when Zoho refuses the refresh token, and runs one at a time', async () => {
    clearZohoTokens();
    zoho.state.rejectToken = true;
    const run = await sync();
    expect(run.status).toBe('failed');
    expect(run.errors[0].message).toMatch(/did not accept the refresh token/);
    zoho.state.rejectToken = false;
    await prisma.zohoBooksSync.create({ data: { organizationId: org, trigger: 'manual', status: 'running' } });
    await pm.post('/accounting/zoho-books/sync', {}).expect(409);
    await prisma.zohoBooksSync.updateMany({ where: { status: 'running' }, data: { startedAt: new Date(Date.now() - 31 * 60_000) } });
    await sync(); // the stale one is closed and a new run starts
    expect((await pm.get('/accounting/zoho-books').expect(200)).body.runs.filter((r: { status: string }) => r.status === 'running')).toHaveLength(0);
  });

  it('the hourly schedule starts a run only when turned on and an hour has passed', async () => {
    await prisma.zohoBooksSync.deleteMany({});
    process.env.ZOHO_BOOKS_SCHEDULER_ENABLED = 'true';
    await svc.tick();
    expect(await prisma.zohoBooksSync.count()).toBe(0);
    await admin.put('/accounting/zoho-books/settings', { hourly: true, since: '2026-10-01', invoices: true, bills: true, payments: true }).expect(200);
    await svc.tick();
    await svc.current;
    expect(await prisma.zohoBooksSync.findMany({ select: { trigger: true, status: true } })).toEqual([{ trigger: 'schedule', status: 'ok' }]);
    await svc.tick();
    expect(await prisma.zohoBooksSync.count()).toBe(1);
  });
});
