import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import request from 'supertest';
import { Http, HttpResponse } from '../../src/accounting/ledger/client';
import { LedgerService } from '../../src/accounting/ledger/ledger.service';
import { parseTallyResponse } from '../../src/accounting/ledger/tally';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const res = (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse => ({
  status,
  headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/** Token endpoint shared by the fakes: rotating refresh tokens, like Xero and Intuit. */
function fakeTokens(prefix: string) {
  const s = { issued: 0, refresh: '', rejectRefresh: false, lastAuth: '', ttl: 1800 };
  const handle = (init: { body?: string; headers: Record<string, string> }) => {
    s.lastAuth = init.headers.Authorization ?? '';
    const f = new URLSearchParams(init.body);
    if (f.get('grant_type') === 'authorization_code' && f.get('code') !== 'good-code') return res(400, { error: 'invalid_grant' });
    if (f.get('grant_type') === 'refresh_token' && (s.rejectRefresh || f.get('refresh_token') !== s.refresh)) return res(400, { error: 'invalid_grant' });
    s.issued++;
    s.refresh = `${prefix}-refresh-${s.issued}`;
    return res(200, { access_token: `${prefix}-access-${s.issued}`, refresh_token: s.refresh, expires_in: s.ttl, token_type: 'Bearer' });
  };
  return { s, handle };
}

function fakeXero() {
  const tok = fakeTokens('x');
  const st = {
    contacts: [] as { ContactID: string; Name: string }[],
    invoices: [] as { InvoiceID: string; InvoiceNumber: string; Type: string; Status: string; Total: number; AmountDue: number; Contact: { ContactID: string }; body: Record<string, unknown> }[],
    payments: [] as Record<string, unknown>[],
    keys: [] as string[],
    calls: [] as string[],
  };
  let n = 0;
  const http: Http = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/connect/token') return tok.handle(init);
    if (u.pathname === '/connect/revocation') return res(200, '');
    if (init.headers.Authorization !== `Bearer x-access-${tok.s.issued}`) return res(401, { Title: 'Unauthorized' });
    if (u.pathname === '/connections') return res(200, [{ tenantId: 'tenant-1', tenantName: 'Demo Research Ltd', tenantType: 'ORGANISATION' }]);
    if (init.headers['xero-tenant-id'] !== 'tenant-1') return res(403, { Title: 'Forbidden' });
    const path = u.pathname.replace('/api.xro/2.0', '');
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown[]>) : null;
    st.calls.push(`${init.method} ${path}`);
    if (init.headers['Idempotency-Key']) st.keys.push(init.headers['Idempotency-Key']);
    const m = `${init.method} ${path}`;
    if (m === 'GET /Organisation') return res(200, { Organisations: [{ Name: 'Demo Research Ltd', BaseCurrency: 'USD' }] });
    if (m === 'GET /Currencies') return res(200, { Currencies: [{ Code: 'USD' }, { Code: 'EUR' }] });
    if (m === 'GET /Accounts') return res(200, { Accounts: [{ AccountID: 'a-200', Code: '200', Name: 'Sales', Type: 'REVENUE' }, { AccountID: 'a-310', Code: '310', Name: 'Cost of Goods Sold', Type: 'DIRECTCOSTS' }, { AccountID: 'a-090', Code: '090', Name: 'Bank', Type: 'BANK' }] });
    if (m === 'GET /TaxRates') return res(200, { TaxRates: [{ Name: 'GST on Income', TaxType: 'OUTPUT', EffectiveRate: 18, CanApplyToRevenue: true, CanApplyToExpenses: false }, { Name: 'Tax Exempt', TaxType: 'EXEMPTOUTPUT', EffectiveRate: 0, CanApplyToRevenue: true, CanApplyToExpenses: true }] });
    if (m === 'GET /Contacts') {
      const name = /Name=="(.*)"/.exec(u.searchParams.get('where') ?? '')?.[1] ?? '';
      return res(200, { Contacts: st.contacts.filter((c) => c.Name === name) });
    }
    if (m === 'POST /Contacts') {
      const c = { ContactID: `con-${++n}`, Name: String((body!.Contacts[0] as { Name: string }).Name) };
      st.contacts.push(c);
      return res(200, { Contacts: [c] });
    }
    if (m === 'GET /Invoices') return res(200, { Invoices: st.invoices.filter((i) => i.InvoiceNumber === u.searchParams.get('InvoiceNumbers')) });
    if (m === 'POST /Invoices') {
      const b = body!.Invoices[0] as { Type: string; InvoiceNumber: string; Contact: { ContactID: string }; LineItems: { Quantity: number; UnitAmount: number; TaxType?: string; AccountCode: string }[]; Status: string };
      if (b.LineItems.some((l) => !l.AccountCode)) return res(400, { Elements: [{ ValidationErrors: [{ Message: 'Account code required' }] }] });
      const sub = b.LineItems.reduce((t, l) => t + l.Quantity * l.UnitAmount, 0);
      const total = Math.round(sub * (b.LineItems[0].TaxType === 'OUTPUT' ? 1.18 : 1) * 100) / 100;
      const i = { InvoiceID: `xi-${++n}`, InvoiceNumber: b.InvoiceNumber, Type: b.Type, Status: b.Status, Total: total, AmountDue: total, Contact: b.Contact, body: b as unknown as Record<string, unknown> };
      st.invoices.push(i);
      return res(200, { Invoices: [i] });
    }
    const r = /^\/Invoices\/([\w-]+)$/.exec(path);
    if (r && init.method === 'GET') return res(200, { Invoices: st.invoices.filter((i) => i.InvoiceID === r[1]) });
    if (r && init.method === 'POST') {
      const i = st.invoices.find((x) => x.InvoiceID === r[1])!;
      if (i.AmountDue < i.Total) return res(400, { Elements: [{ ValidationErrors: [{ Message: 'Invoice not of valid status for modification' }] }] });
      i.Status = String((body!.Invoices[0] as { Status: string }).Status);
      return res(200, { Invoices: [i] });
    }
    if (m === 'PUT /Payments') {
      const p = body!.Payments[0] as { Invoice: { InvoiceID: string }; Amount: number; Account: { AccountID: string } };
      const i = st.invoices.find((x) => x.InvoiceID === p.Invoice.InvoiceID)!;
      i.AmountDue = Math.round((i.AmountDue - p.Amount) * 100) / 100;
      if (!i.AmountDue) i.Status = 'PAID';
      st.payments.push(p);
      return res(200, { Payments: [{ PaymentID: `xp-${++n}` }] });
    }
    return res(404, { Message: `Fake Xero has no ${m}` });
  };
  return { http, st, tok };
}

function fakeQuickBooks() {
  const tok = fakeTokens('q');
  const st = {
    customers: [] as { Id: string; DisplayName: string; CurrencyRef?: { value: string } }[],
    vendors: [] as { Id: string; DisplayName: string; CurrencyRef?: { value: string } }[],
    items: [] as { Id: string; Name: string }[],
    invoices: [] as Record<string, unknown>[],
    bills: [] as Record<string, unknown>[],
    payments: [] as Record<string, unknown>[],
    billPayments: [] as Record<string, unknown>[],
    deleted: [] as string[],
    requestIds: [] as string[],
  };
  let n = 0;
  const fault = (code: string, Message: string) => res(400, { Fault: { Error: [{ Message, code }], type: 'ValidationFault' } });
  const http: Http = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/oauth2/v1/tokens/bearer') return tok.handle(init);
    if (u.pathname === '/v2/oauth2/tokens/revoke') return res(200, '');
    if (init.headers.Authorization !== `Bearer q-access-${tok.s.issued}`) return res(401, { fault: 'AuthenticationFailed' });
    const m = /^\/v3\/company\/(\d+)(\/.*)$/.exec(u.pathname);
    if (!m || m[1] !== '9130000001') return res(403, { Fault: { Error: [{ Message: 'Wrong realm' }] } });
    if (u.searchParams.get('minorversion') !== '75') return res(400, 'minorversion');
    const path = m[2];
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    if (u.searchParams.get('requestid')) st.requestIds.push(u.searchParams.get('requestid')!);
    const key = `${init.method} ${path}`;
    if (key === 'GET /companyinfo/9130000001') return res(200, { CompanyInfo: { CompanyName: 'Demo Research Inc' } });
    if (key === 'GET /preferences') return res(200, { Preferences: { CurrencyPrefs: { MultiCurrencyEnabled: true, HomeCurrency: { value: 'USD' } } } });
    if (key === 'GET /query') {
      const sql = u.searchParams.get('query')!;
      const eq = /= '(.*)'/.exec(sql)?.[1]?.replace(/\\'/g, "'");
      if (sql.includes('from Account')) return res(200, { QueryResponse: { Account: [{ Id: '79', Name: 'Sales', AccountType: 'Income' }, { Id: '80', Name: 'Cost of Goods Sold', AccountType: 'Cost of Goods Sold' }, { Id: '35', Name: 'Bank', AccountType: 'Bank' }] } });
      if (sql.includes('from TaxCode')) return res(200, { QueryResponse: { TaxCode: [{ Id: '5', Name: 'GST', Active: true }] } });
      if (sql.includes('from Item')) return res(200, { QueryResponse: { Item: st.items.filter((i) => i.Name === eq) } });
      if (sql.includes('from Customer')) return res(200, { QueryResponse: { Customer: st.customers.filter((c) => c.DisplayName === eq) } });
      if (sql.includes('from Vendor')) return res(200, { QueryResponse: { Vendor: st.vendors.filter((c) => c.DisplayName === eq) } });
      if (sql.includes('from Invoice')) return res(200, { QueryResponse: { Invoice: st.invoices.filter((c) => c.DocNumber === eq) } });
      if (sql.includes('from Bill')) return res(200, { QueryResponse: { Bill: st.bills.filter((c) => c.DocNumber === eq) } });
      return res(200, { QueryResponse: {} });
    }
    const names = () => [...st.customers, ...st.vendors].map((x) => x.DisplayName);
    if (key === 'POST /item') {
      const i = { Id: `it-${++n}`, Name: String(body!.Name) };
      st.items.push(i);
      return res(200, { Item: i });
    }
    if (key === 'POST /customer' || key === 'POST /vendor') {
      if (names().includes(String(body!.DisplayName))) return fault('6240', 'Duplicate Name Exists Error');
      const c = { Id: `${path.slice(1, 2)}-${++n}`, DisplayName: String(body!.DisplayName), CurrencyRef: body!.CurrencyRef as { value: string } };
      (key === 'POST /customer' ? st.customers : st.vendors).push(c);
      return res(200, { [key === 'POST /customer' ? 'Customer' : 'Vendor']: c });
    }
    const amount = (lines: { Amount: number }[]) => lines.reduce((t, l) => t + l.Amount, 0);
    if (key === 'POST /invoice' && !u.searchParams.get('operation')) {
      const lines = body!.Line as { Amount: number; SalesItemLineDetail: { ItemRef?: { value: string }; TaxCodeRef?: { value: string } } }[];
      if (lines.some((l) => !l.SalesItemLineDetail.ItemRef)) return fault('2020', 'Required param missing, need to supply the required value for the API');
      const total = Math.round(amount(lines) * (lines[0].SalesItemLineDetail.TaxCodeRef ? 1.18 : 1) * 100) / 100;
      const i = { ...body, Id: `${++n}`, SyncToken: '0', TotalAmt: total, Balance: total };
      st.invoices.push(i);
      return res(200, { Invoice: i });
    }
    if (key === 'POST /invoice' && u.searchParams.get('operation') === 'void') {
      const i = st.invoices.find((x) => x.Id === body!.Id)!;
      if (i.SyncToken !== body!.SyncToken) return fault('5010', 'Stale Object Error');
      Object.assign(i, { Balance: 0, TotalAmt: 0, PrivateNote: 'Voided', SyncToken: '1' });
      return res(200, { Invoice: i });
    }
    if (key === 'POST /bill' && !u.searchParams.get('operation')) {
      const lines = body!.Line as { Amount: number }[];
      const b = { ...body, Id: `${++n}`, SyncToken: '0', TotalAmt: amount(lines), Balance: amount(lines) };
      st.bills.push(b);
      return res(200, { Bill: b });
    }
    if (key === 'POST /bill' && u.searchParams.get('operation') === 'delete') {
      st.deleted.push(String(body!.Id));
      st.bills = st.bills.filter((b) => b.Id !== body!.Id);
      return res(200, { Bill: { Id: body!.Id, status: 'Deleted' } });
    }
    let r = /^\/invoice\/(\w+)$/.exec(path);
    if (r) return res(200, { Invoice: st.invoices.find((x) => x.Id === r![1]) });
    r = /^\/bill\/(\w+)$/.exec(path);
    if (r) return res(200, { Bill: st.bills.find((x) => x.Id === r![1]) });
    if (key === 'POST /payment' || key === 'POST /billpayment') {
      const link = (body!.Line as { Amount: number; LinkedTxn: { TxnId: string }[] }[])[0];
      const doc = [...st.invoices, ...st.bills].find((x) => x.Id === link.LinkedTxn[0].TxnId)!;
      doc.Balance = Math.round((Number(doc.Balance) - link.Amount) * 100) / 100;
      (key === 'POST /payment' ? st.payments : st.billPayments).push(body!);
      return res(200, { [key === 'POST /payment' ? 'Payment' : 'BillPayment']: { Id: `p-${++n}` } });
    }
    return res(404, { Fault: { Error: [{ Message: `Fake QuickBooks has no ${key}` }] } });
  };
  return { http, st, tok };
}

function fakeTally() {
  const st = { ledgers: new Set<string>(['Acme Insights']), vouchers: [] as { id: string; xml: string }[], cancelled: [] as string[], down: false };
  let id = 500;
  const result = (o: Record<string, number | string>, errors: string[] = []) =>
    `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT>${Object.entries(o).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}${errors.map((e) => `<LINEERROR>${e}</LINEERROR>`).join('')}</IMPORTRESULT></DATA></BODY></ENVELOPE>`;
  const http: Http = async (url, init) => {
    if (st.down) throw new Error('connect ECONNREFUSED');
    if (!url.startsWith('http://tally.office.lan:9000')) return res(404, '');
    const x = init.body ?? '';
    if (x.includes('<TALLYREQUEST>Export</TALLYREQUEST>')) return res(200, '<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="Demo Research Pvt Ltd"><NAME>Demo Research Pvt Ltd</NAME></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>');
    const ledger = /<LEDGER NAME="([^"]+)" ACTION="Create">/.exec(x);
    if (ledger) {
      if (st.ledgers.has(ledger[1])) return res(200, result({ CREATED: 0, ERRORS: 1 }, [`Ledger '${ledger[1]}' already exists!`]));
      st.ledgers.add(ledger[1]);
      return res(200, result({ CREATED: 1, ERRORS: 0 }));
    }
    const cancel = /TAGNAME="MASTER ID" TAGVALUE="(\d+)"[^>]*ACTION="Cancel"/.exec(x);
    if (cancel) {
      st.cancelled.push(cancel[1]);
      return res(200, result({ CREATED: 0, ALTERED: 0, CANCELLED: 1, ERRORS: 0 }));
    }
    const party = /<PARTYLEDGERNAME>([^<]+)<\/PARTYLEDGERNAME>/.exec(x)?.[1];
    if (party && !st.ledgers.has(party)) return res(200, result({ CREATED: 0, ERRORS: 1 }, [`Ledger '${party}' does not exist!`]));
    st.vouchers.push({ id: String(++id), xml: x });
    return res(200, result({ CREATED: 1, ALTERED: 0, LASTVCHID: id, ERRORS: 0, EXCEPTIONS: 0 }));
  };
  return { http, st };
}

describe('Direct sync to Xero, QuickBooks Online and Tally Prime (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let svc: LedgerService;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let org: string;
  const ids: Record<string, string> = {};
  const env = { ...process.env };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    svc = app.get(LedgerService);
    svc.sleep = async () => undefined;
    for (const p of ['xero', 'quickbooks', 'tally'] as const) svc.pace[p] = { gapMs: 0, budget: 500 };
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'led');
    const b = await makeOrg(prisma, 'led-other');
    org = a.org.id;
    admin = api(app, await login(app, a.users.ADMIN.email));
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.ADMIN.email));
    const clientId = (await pm.post('/clients', { name: 'Acme Insights', code: 'ACME' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Panel A', code: 'PA' }).expect(201)).body.id;
    const project = (
      await pm.post('/projects', { name: 'Brand study', category: 'B2C', clientId, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 10, targetCompletes: 50, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' }, countries: [{ countryCode: 'US', currency: 'USD' }] }).expect(201)
    ).body;
    const lines = [{ countryCode: 'US', description: 'Completes US', quantity: 10, unitPrice: 12.5, amount: 125 }];
    const inv = (number: string, status: 'SENT' | 'PAID', currency: string, tax: number, paidAt?: string) =>
      prisma.invoice.create({ data: { organizationId: org, projectId: project.id, clientId, number, status, currency, lines, completes: 10, subtotal: 125, taxName: tax ? 'GST' : null, taxPercent: tax, taxAmount: (125 * tax) / 100, total: 125 + (125 * tax) / 100, issuedAt: new Date('2026-10-05T10:00:00Z'), dueAt: new Date('2026-11-04T10:00:00Z'), paidAt: paidAt ? new Date(paidAt) : null, paymentReference: paidAt ? 'UTR-991' : null } });
    ids.i1 = (await inv('INV-2026-00201', 'SENT', 'USD', 18)).id;
    ids.i2 = (await inv('INV-2026-00202', 'PAID', 'EUR', 0, '2026-10-25T10:00:00Z')).id;
    ids.b1 = (
      await prisma.vendorBill.create({ data: { organizationId: org, vendorId, number: 'BILL-2026-00201', status: 'APPROVED', currency: 'USD', lines: [{ projectId: project.id, projectCode: project.projectCode, countryCode: 'US', description: 'Brand study US', quantity: 10, unitPrice: 4, amount: 40 }], completes: 10, subtotal: 40, total: 40, vendorReference: 'PA-77', approvedAt: new Date('2026-10-10T08:00:00Z') } })
    ).id;
    await admin.put('/organization/finance-settings', { baseCurrency: 'USD', rates: [{ currency: 'EUR', rate: 1.08 }] }).expect(200);
    Object.assign(process.env, { PUBLIC_BASE_URL: 'http://api.samptrek.test' });
  });
  afterAll(async () => {
    process.env = env;
    await app.close();
  });

  const connect = async (p: 'xero' | 'quickbooks', extra = '') => {
    const start = await admin.get(`/accounting/ledgers/${p}/connect`).expect(302);
    const to = new URL(start.headers.location);
    const cookie = (start.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('projexa_ledger='))!.split(';')[0];
    const back = await http().get(`/api/v1/accounting/ledgers/${p}/callback?code=good-code&state=${to.searchParams.get('state')}${extra}`).set('Cookie', cookie).expect(302);
    return { to, back: back.headers.location as string, cookie };
  };
  const sync = async (p: string, as = pm) => {
    const run = (await as.post(`/accounting/ledgers/${p}/sync`, {}).expect(201)).body;
    await svc.current;
    const list = (await as.get('/accounting/ledgers').expect(200)).body as { provider: string; runs: { id: string }[] }[];
    return list.find((c) => c.provider === p)!.runs.find((r) => r.id === run.id) as unknown as { status: string; counts: Record<string, number>; errors: { number: string; message: string }[] };
  };
  const since = (p: string) => admin.put(`/accounting/ledgers/${p}/settings`, { hourly: false, since: '2026-10-01', invoices: true, bills: true, payments: true }).expect(200);

  it('shows each system as not set up and refuses to connect or sync', async () => {
    for (const k of ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET', 'QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'TALLY_URL', 'TALLY_TENANT']) delete process.env[k];
    const list = (await pm.get('/accounting/ledgers').expect(200)).body;
    expect(list.map((c: { provider: string; configured: boolean; connected: boolean }) => [c.provider, c.configured, c.connected])).toEqual([['xero', false, false], ['quickbooks', false, false], ['tally', false, false]]);
    expect(list[0].redirectUri).toBe('http://api.samptrek.test/api/v1/accounting/ledgers/xero/callback');
    const r = await admin.get('/accounting/ledgers/xero/connect').expect(302);
    expect(decodeURIComponent(r.headers.location)).toMatch(/ledger_error=Xero is not set up/);
    await since('xero');
    expect((await pm.post('/accounting/ledgers/xero/sync', {}).expect(400)).body.message).toMatch(/not set up/);
    await viewer.get('/accounting/ledgers').expect(403);
    await pm.get('/accounting/ledgers/xero/connect').expect(403);
    await pm.put('/accounting/ledgers/xero/settings', { hourly: false, since: null, invoices: true, bills: true, payments: true }).expect(403);
    await admin.get('/accounting/ledgers/sage/connect').expect(302);
  });

  describe('Xero', () => {
    let xero: ReturnType<typeof fakeXero>;
    beforeAll(() => {
      Object.assign(process.env, { XERO_CLIENT_ID: 'xero-client', XERO_CLIENT_SECRET: 'xero-secret' });
      xero = fakeXero();
      svc.http = xero.http;
    });

    it('connects with OAuth: granular scopes, checked state, encrypted tokens', async () => {
      const bad = await http().get('/api/v1/accounting/ledgers/xero/callback?code=good-code&state=nope').expect(302);
      expect(decodeURIComponent(bad.headers.location)).toMatch(/took too long|could not be checked/);
      const { to, back } = await connect('xero');
      expect(to.origin + to.pathname).toBe('https://login.xero.com/identity/connect/authorize');
      expect(to.searchParams.get('scope')).toBe('offline_access accounting.contacts accounting.invoices accounting.payments accounting.settings.read');
      expect(to.searchParams.get('redirect_uri')).toBe('http://api.samptrek.test/api/v1/accounting/ledgers/xero/callback');
      expect(back).toMatch(/\/accounting\?ledger=xero&connected=1/);
      expect(xero.tok.s.lastAuth).toBe(`Basic ${Buffer.from('xero-client:xero-secret').toString('base64')}`);
      const row = await prisma.ledgerConnection.findFirstOrThrow({ where: { organizationId: org, provider: 'xero' } });
      expect(row).toMatchObject({ status: 'connected', remoteId: 'tenant-1', remoteName: 'Demo Research Ltd' });
      expect(row.tokens).not.toContain('x-refresh');
      const list = (await pm.get('/accounting/ledgers').expect(200)).body;
      expect(list[0]).toMatchObject({ connected: true, company: 'Demo Research Ltd', connectedBy: 'ADMIN' });
      expect(JSON.stringify(list)).not.toContain('x-access');
      expect((await prisma.auditEvent.findMany({ where: { organizationId: org, action: 'ledger.connect' } })).length).toBe(1);
    });

    it('tests the connection and the account settings', async () => {
      const t = (await admin.post('/accounting/ledgers/xero/test').expect(200)).body;
      expect(t.ok).toBe(true);
      expect(t.checks.map((c: { label: string }) => c.label)).toEqual(['Connection', 'Income account', 'Expense account', 'Bank account']);
      await pm.post('/accounting/ledgers/xero/test').expect(403);
    });

    it('syncs invoices, bills and payments once, with idempotency keys', async () => {
      await since('xero');
      const run = await sync('xero');
      expect(run.errors).toEqual([]);
      expect(run).toMatchObject({ status: 'ok', counts: { invoices: 2, bills: 1, paymentsReceived: 1, customers: 1, vendors: 1 } });
      const i1 = xero.st.invoices.find((i) => i.InvoiceNumber === 'INV-2026-00201')!;
      expect(i1).toMatchObject({ Type: 'ACCREC', Status: 'AUTHORISED', Total: 147.5 });
      expect(i1.body).toMatchObject({ Reference: expect.any(String), CurrencyCode: 'USD', LineAmountTypes: 'Exclusive', DueDate: '2026-11-04' });
      expect((i1.body.LineItems as { TaxType: string; AccountCode: string }[])[0]).toMatchObject({ TaxType: 'OUTPUT', AccountCode: '200' });
      const bill = xero.st.invoices.find((i) => i.Type === 'ACCPAY')!;
      expect((bill.body.LineItems as { Description: string; AccountCode: string }[])[0]).toMatchObject({ AccountCode: '310', Description: 'Brand study US (vendor invoice PA-77)' });
      expect(xero.st.payments).toEqual([expect.objectContaining({ Amount: 125, Account: { AccountID: 'a-090' }, Date: '2026-10-25' })]);
      expect(xero.st.keys).toEqual(expect.arrayContaining([`projexa-invoice-${ids.i1}`, `projexa-invoice-payment-${ids.i2}`]));
      expect((await prisma.invoice.findUniqueOrThrow({ where: { id: ids.i1 } })).exportedAt).not.toBeNull();
      const again = await sync('xero');
      expect(again).toMatchObject({ status: 'ok', counts: { invoices: 0, bills: 0, paymentsReceived: 0, matched: 0 } });
      expect(xero.st.invoices).toHaveLength(3);
    });

    it('matches a document already in Xero instead of creating it again', async () => {
      await prisma.ledgerLink.deleteMany({ where: { organizationId: org, provider: 'xero', entityType: 'bill' } });
      const run = await sync('xero');
      expect(run.counts).toMatchObject({ matched: 1, bills: 0 });
      expect(xero.st.invoices).toHaveLength(3);
    });

    it('voids, and reports a void Xero refuses', async () => {
      await prisma.invoice.update({ where: { id: ids.i1 }, data: { status: 'VOID' } });
      await prisma.invoice.update({ where: { id: ids.i2 }, data: { status: 'VOID' } });
      const run = await sync('xero');
      expect(run.counts.voided).toBe(1);
      expect(xero.st.invoices.find((i) => i.InvoiceNumber === 'INV-2026-00201')!.Status).toBe('VOIDED');
      expect(run.errors).toEqual([expect.objectContaining({ number: 'INV-2026-00202', message: expect.stringMatching(/not of valid status/) })]);
      expect(run.status).toBe('partial');
      await prisma.invoice.update({ where: { id: ids.i1 }, data: { status: 'SENT' } });
      await prisma.invoice.update({ where: { id: ids.i2 }, data: { status: 'PAID' } });
    });

    it('rotates refresh tokens and marks the connection expired when Xero refuses them', async () => {
      const row = await prisma.ledgerConnection.findFirstOrThrow({ where: { organizationId: org, provider: 'xero' } });
      xero.tok.s.issued++; // Xero stops accepting the current access token: a 401, then one refresh
      const before = xero.tok.s.issued;
      await admin.post('/accounting/ledgers/xero/test').expect(200);
      expect(xero.tok.s.issued).toBeGreaterThan(before);
      const after = await prisma.ledgerConnection.findFirstOrThrow({ where: { organizationId: org, provider: 'xero' } });
      expect(after.tokens).not.toBe(row.tokens);
      xero.tok.s.rejectRefresh = true;
      xero.tok.s.issued++;
      const t = (await admin.post('/accounting/ledgers/xero/test').expect(200)).body;
      expect(t.ok).toBe(false);
      const list = (await pm.get('/accounting/ledgers').expect(200)).body;
      expect(list[0]).toMatchObject({ status: 'expired', connected: false });
      expect((await pm.post('/accounting/ledgers/xero/sync', {}).expect(400)).body.message).toMatch(/Connect Xero first/);
      xero.tok.s.rejectRefresh = false;
      await connect('xero');
      expect((await pm.get('/accounting/ledgers').expect(200)).body[0].status).toBe('connected');
    });

    it('disconnects (admins only) and revokes', async () => {
      await pm.delete('/accounting/ledgers/xero').expect(403);
      await admin.delete('/accounting/ledgers/xero').expect(200);
      const row = await prisma.ledgerConnection.findFirstOrThrow({ where: { organizationId: org, provider: 'xero' } });
      expect(row).toMatchObject({ status: 'disconnected', tokens: null });
      await other.get('/accounting/ledgers').expect(200).expect((r) => expect(r.body[0].connected).toBe(false));
    });
  });

  describe('QuickBooks Online', () => {
    let qb: ReturnType<typeof fakeQuickBooks>;
    beforeAll(async () => {
      Object.assign(process.env, { QUICKBOOKS_CLIENT_ID: 'qb-client', QUICKBOOKS_CLIENT_SECRET: 'qb-secret' });
      qb = fakeQuickBooks();
      svc.http = qb.http;
      await prisma.ledgerLink.deleteMany({});
      await prisma.invoice.updateMany({ data: { exportedAt: null, paymentExportedAt: null } });
    });

    it('connects to the company picked in Intuit', async () => {
      const missing = await connect('quickbooks');
      expect(decodeURIComponent(missing.back)).toMatch(/did not say which company/);
      const { to, back } = await connect('quickbooks', '&realmId=9130000001');
      expect(to.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting');
      expect(back).toMatch(/connected=1/);
      expect((await pm.get('/accounting/ledgers').expect(200)).body[1]).toMatchObject({ connected: true, company: 'Demo Research Inc' });
    });

    it('syncs with a service item, tax codes, exchange rates and request ids', async () => {
      await since('quickbooks');
      // A vendor that is also a client: QuickBooks names must be unique across both.
      qb.st.customers.push({ Id: 'c-0', DisplayName: 'Panel A' });
      const run = await sync('quickbooks');
      expect(run.errors).toEqual([]);
      expect(run.counts).toMatchObject({ invoices: 2, bills: 1, paymentsReceived: 1, customers: 2, vendors: 1 });
      expect(qb.st.items).toEqual([{ Id: expect.any(String), Name: 'Survey completes' }]);
      expect(qb.st.customers.map((c) => c.DisplayName)).toEqual(['Panel A', 'Acme Insights', 'Acme Insights (EUR)']);
      expect(qb.st.vendors.map((c) => c.DisplayName)).toEqual(['Panel A (vendor)']);
      const eur = qb.st.invoices.find((i) => i.DocNumber === 'INV-2026-00202')!;
      expect(eur).toMatchObject({ CurrencyRef: { value: 'EUR' }, ExchangeRate: 1.08, TxnDate: '2026-10-05' });
      const usd = qb.st.invoices.find((i) => i.DocNumber === 'INV-2026-00201')!;
      expect((usd.Line as { SalesItemLineDetail: { TaxCodeRef: { value: string } } }[])[0].SalesItemLineDetail.TaxCodeRef).toEqual({ value: '5' });
      expect(qb.st.payments).toEqual([expect.objectContaining({ TotalAmt: 125, DepositToAccountRef: { value: '35' }, PaymentRefNum: 'UTR-991' })]);
      expect(qb.st.requestIds).toEqual(expect.arrayContaining([`inv-${ids.i1}`, `bill-${ids.b1}`, `pay-${ids.i2}`]));
      expect((await sync('quickbooks')).counts).toMatchObject({ invoices: 0, bills: 0 });
    });

    it('pays a bill, voids an invoice and deletes a voided bill', async () => {
      await prisma.vendorBill.update({ where: { id: ids.b1 }, data: { status: 'PAID', paidAt: new Date('2026-10-28T08:00:00Z'), paymentReference: 'NEFT-12' } });
      let run = await sync('quickbooks');
      expect(run.counts.paymentsMade).toBe(1);
      expect(qb.st.billPayments[0]).toMatchObject({ PayType: 'Check', CheckPayment: { BankAccountRef: { value: '35' } }, TotalAmt: 40, DocNumber: 'NEFT-12' });
      await prisma.vendorBill.update({ where: { id: ids.b1 }, data: { status: 'VOID' } });
      run = await sync('quickbooks');
      expect(run.errors[0].message).toMatch(/has payments in QuickBooks/);
      // Once the payment is removed in QuickBooks the bill can go.
      const b = qb.st.bills[0];
      b.Balance = b.TotalAmt;
      await prisma.invoice.update({ where: { id: ids.i1 }, data: { status: 'VOID' } });
      run = await sync('quickbooks');
      expect(run.errors).toEqual([]);
      expect(run.counts.voided).toBe(2);
      expect(qb.st.deleted).toHaveLength(1);
      expect(qb.st.invoices.find((i) => i.DocNumber === 'INV-2026-00201')).toMatchObject({ PrivateNote: 'Voided' });
      await prisma.invoice.update({ where: { id: ids.i1 }, data: { status: 'SENT' } });
      await prisma.vendorBill.update({ where: { id: ids.b1 }, data: { status: 'APPROVED', paidAt: null, paymentReference: null } });
    });
  });

  describe('Tally Prime', () => {
    let tally: ReturnType<typeof fakeTally>;
    beforeAll(async () => {
      Object.assign(process.env, { TALLY_URL: 'http://tally.office.lan:9000', TALLY_TENANT: 'led' });
      tally = fakeTally();
      svc.http = tally.http;
      await prisma.ledgerLink.deleteMany({});
      const cfg = (await admin.get('/accounting/settings').expect(200)).body;
      await admin.put('/accounting/settings', { ...cfg, tally: { ...cfg.tally, company: 'Demo Research Pvt Ltd' } }).expect(200);
    });

    it('parses Tally import results', () => {
      expect(parseTallyResponse('<RESPONSE><CREATED>1</CREATED><ERRORS>0</ERRORS><LASTVCHID>77</LASTVCHID></RESPONSE>')).toMatchObject({ created: 1, errors: 0, lastVoucherId: '77', lineErrors: [] });
      expect(parseTallyResponse('<ENVELOPE><BODY><DATA><IMPORTRESULT><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Voucher totals do not match!</LINEERROR></IMPORTRESULT></DATA></BODY></ENVELOPE>')).toMatchObject({ created: 0, errors: 1, lineErrors: ['Voucher totals do not match!'] });
    });

    it('is bound to one organisation and posts vouchers in the reporting currency', async () => {
      const mine = (await pm.get('/accounting/ledgers').expect(200)).body[2];
      expect(mine).toMatchObject({ configured: true, connected: true, company: 'tally.office.lan:9000' });
      expect((await other.get('/accounting/ledgers').expect(200)).body[2]).toMatchObject({ otherTenant: true, connected: false });
      await other.put('/accounting/ledgers/tally/settings', { hourly: false, since: '2026-10-01', invoices: true, bills: true, payments: true }).expect(200);
      await other.post('/accounting/ledgers/tally/sync', {}).expect(400);
      const t = (await admin.post('/accounting/ledgers/tally/test').expect(200)).body;
      expect(t.checks[1]).toMatchObject({ label: 'Company', ok: true });
      await since('tally');
      const run = await sync('tally');
      expect(run.errors).toEqual([]);
      expect(run.counts).toMatchObject({ invoices: 2, bills: 1, paymentsReceived: 1, vendors: 1, customers: 0 });
      expect(tally.st.ledgers.has('Panel A')).toBe(true);
      const eur = tally.st.vouchers.find((v) => v.xml.includes('INV-2026-00202'))!.xml;
      expect(eur).toContain('<SVCURRENTCOMPANY>Demo Research Pvt Ltd</SVCURRENTCOMPANY>');
      expect(eur).toContain('<AMOUNT>-135.00</AMOUNT>'); // 125 EUR at 1.08
      expect(tally.st.vouchers.filter((v) => v.xml.includes('VCHTYPE="Receipt"'))).toHaveLength(1);
      expect((await sync('tally')).counts.invoices).toBe(0);
    });

    it('cancels a voided voucher by its Tally id and explains an unreachable Tally', async () => {
      await prisma.invoice.update({ where: { id: ids.i1 }, data: { status: 'VOID' } });
      const link = await prisma.ledgerLink.findFirstOrThrow({ where: { provider: 'tally', entityType: 'invoice', entityId: ids.i1 } });
      const run = await sync('tally');
      expect(run.counts.voided).toBe(1);
      expect(tally.st.cancelled).toEqual([link.remoteId]);
      await prisma.invoice.update({ where: { id: ids.i1 }, data: { status: 'SENT' } });
      tally.st.down = true;
      const t = (await admin.post('/accounting/ledgers/tally/test').expect(200)).body;
      expect(t.checks[0].detail).toMatch(/could not be reached.*XML server/);
      tally.st.down = false;
    });
  });
});
