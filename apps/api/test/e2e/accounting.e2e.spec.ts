import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Accounting exports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let org: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'acct');
    const b = await makeOrg(prisma, 'acct-other');
    org = a.org.id;
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    admin = api(app, await login(app, a.users.ADMIN.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Acme, "Insights"', code: 'ACME' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: '=Panel A', code: 'PA' }).expect(201)).body.id;
    const project = (
      await pm.post('/projects', { name: 'Brand study', category: 'B2C', clientId, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 10, targetCompletes: 50, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' }, countries: [{ countryCode: 'US', currency: 'USD' }] }).expect(201)
    ).body;
    const line = (desc: string, quantity: number, unitPrice: number) => ({ countryCode: 'US', description: desc, quantity, unitPrice, amount: quantity * unitPrice });
    const inv = (number: string, status: 'DRAFT' | 'SENT' | 'PAID' | 'VOID', issuedAt: string | null, currency = 'USD', tax = 0) => {
      const lines = [line(`${number} completes US`, 10, 12.5), line(`${number} completes US (bonus)`, 2, 5)];
      const subtotal = 135;
      const taxAmount = Math.round(subtotal * tax) / 100;
      return prisma.invoice.create({ data: { organizationId: org, projectId: project.id, clientId, number, status, currency, lines, completes: 12, subtotal, taxName: tax ? 'GST' : null, taxPercent: tax, taxAmount, total: subtotal + taxAmount, issuedAt: issuedAt ? new Date(issuedAt) : null, dueAt: issuedAt ? new Date(new Date(issuedAt).getTime() + 30 * 86400000) : null } });
    };
    ids.i1 = (await inv('INV-2026-00001', 'SENT', '2026-10-05T10:00:00Z', 'USD', 18)).id;
    ids.i2 = (await inv('INV-2026-00002', 'PAID', '2026-10-20T10:00:00Z', 'EUR')).id;
    ids.i3 = (await inv('INV-2026-00003', 'DRAFT', null)).id;
    ids.i4 = (await inv('INV-2026-00004', 'VOID', '2026-10-21T10:00:00Z')).id;
    ids.i5 = (await inv('INV-2026-00005', 'SENT', '2026-11-01T10:00:00Z')).id;
    ids.b1 = (
      await prisma.vendorBill.create({ data: { organizationId: org, vendorId, number: 'BILL-2026-00001', status: 'APPROVED', currency: 'USD', lines: [{ projectId: project.id, projectCode: project.projectCode, countryCode: 'US', description: 'Brand study US', quantity: 10, unitPrice: 4, amount: 40 }], completes: 10, subtotal: 40, taxName: 'GST', taxPercent: 18, taxAmount: 7.2, total: 47.2, vendorReference: 'PA-77', approvedAt: new Date('2026-10-10T08:00:00Z'), dueAt: new Date('2026-11-10T08:00:00Z') } })
    ).id;
    ids.b2 = (await prisma.vendorBill.create({ data: { organizationId: org, vendorId, number: 'BILL-2026-00002', status: 'DRAFT', currency: 'USD', lines: [], completes: 0, subtotal: 0, total: 0 } })).id;
  });
  afterAll(async () => {
    await app.close();
  });

  const f = (o: object) => ({ format: 'journal', kind: 'both', from: '2026-10-01', to: '2026-10-31', ...o });

  it('lists formats and default settings; only admins change settings', async () => {
    const formats = (await pm.get('/accounting/formats').expect(200)).body;
    expect(formats.map((x: { id: string }) => x.id)).toEqual(['zoho_books', 'tally', 'quickbooks', 'xero', 'journal']);
    const s = (await pm.get('/accounting/settings').expect(200)).body;
    expect(s).toMatchObject({ incomeAccount: 'Sales', dateFormat: 'yyyy-mm-dd', timezone: 'Asia/Kolkata', xero: { incomeCode: '200' } });
    await pm.put('/accounting/settings', s).expect(403);
    await admin.put('/accounting/settings', { ...s, timezone: 'Mars/Base' }).expect(400);
    await admin.put('/accounting/settings', { ...s, incomeAccount: 'Survey revenue', tally: { ...s.tally, company: 'Frequent Research' } }).expect(200);
    expect((await pm.get('/accounting/settings').expect(200)).body.incomeAccount).toBe('Survey revenue');
  });

  it('previews only sent or paid documents in the date range, never drafts or void', async () => {
    const p = (await pm.post('/accounting/exports/preview', f({})).expect(200)).body;
    expect(p.invoiceCount).toBe(2);
    expect(p.billCount).toBe(1);
    expect(p.documents.map((d: { number: string }) => d.number)).toEqual(['INV-2026-00001', 'BILL-2026-00001', 'INV-2026-00002']);
    expect(p.totals).toEqual(expect.arrayContaining([{ type: 'invoice', currency: 'USD', count: 1, total: 159.3 }, { type: 'invoice', currency: 'EUR', count: 1, total: 135 }]));
    const paidOnly = (await pm.post('/accounting/exports/preview', f({ invoiceStatuses: ['PAID'], kind: 'invoices' })).expect(200)).body;
    expect(paidOnly.invoiceCount).toBe(1);
    expect((await pm.post('/accounting/exports/preview', f({ currency: 'EUR' })).expect(200)).body.invoiceCount).toBe(1);
    await pm.post('/accounting/exports/preview', f({ format: 'xero', kind: 'both' })).expect(400);
    await pm.post('/accounting/exports/preview', f({ from: '2026-11-01', to: '2026-10-01' })).expect(400);
    await viewer.post('/accounting/exports/preview', f({})).expect(403);
  });

  it('Tally needs rates for other currencies, then writes balanced vouchers in the reporting currency', async () => {
    const p = (await pm.post('/accounting/exports/preview', f({ format: 'tally' })).expect(200)).body;
    expect(p.warnings[0]).toMatch(/EUR/);
    await pm.post('/accounting/exports', f({ format: 'tally', onlyNew: false })).expect(400);
    await admin.put('/organization/finance-settings', { baseCurrency: 'USD', rates: [{ currency: 'EUR', rate: 1.1 }] }).expect(200);
    const e = (await pm.post('/accounting/exports', f({ format: 'tally', onlyNew: false })).expect(201)).body;
    expect(e).toMatchObject({ invoiceCount: 2, billCount: 1, fileName: 'samptrek-tally-both-2026-10-01_to_2026-10-31.xml' });
    const res = await pm.get(`/accounting/exports/${e.id}/download`).expect(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const x = res.text;
    expect(x).toContain('<SVCURRENTCOMPANY>Frequent Research</SVCURRENTCOMPANY>');
    expect(x).toContain('<VOUCHERNUMBER>INV-2026-00001</VOUCHERNUMBER>');
    expect(x).toContain('<DATE>20261005</DATE>');
    expect(x).toContain('Acme, &quot;Insights&quot;');
    // Each voucher balances: debits (negative) equal credits.
    for (const v of x.match(/<VOUCHER [\s\S]*?<\/VOUCHER>/g)!) {
      const amounts = [...v.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Number(m[1]));
      expect(Math.abs(amounts.reduce((a, b) => a + b, 0))).toBeLessThan(0.005);
    }
    expect(x).toContain('<AMOUNT>148.50</AMOUNT>'); // EUR 135 at 1.1
    expect(x).toContain('<LEDGERNAME>Survey revenue</LEDGERNAME>');
  });

  it('general journal: one debit and credit set per document, safe CSV', async () => {
    const e = (await pm.post('/accounting/exports', f({ onlyNew: false })).expect(201)).body;
    const csv = (await pm.get(`/accounting/exports/${e.id}/download`).expect(200)).text.replace(/^﻿/, '');
    const rows = csv.trim().split('\r\n');
    expect(rows[0]).toBe('Date,Type,Number,Party,Account,Debit,Credit,Currency,Description,Reference');
    expect(rows).toContainEqual(expect.stringMatching(/^2026-10-05,Sales invoice,INV-2026-00001,"Acme, ""Insights""",Accounts Receivable,159\.30,,USD,/));
    expect(rows).toContainEqual(expect.stringMatching(/^2026-10-05,Sales invoice,INV-2026-00001,.*,Output Tax,,24\.30,USD,/));
    expect(rows.some((r) => r.includes("'=Panel A") && r.includes('Accounts Payable') && r.includes(',47.20,'))).toBe(true);
    expect(rows.filter((r) => r.includes('INV-2026-00001'))).toHaveLength(3);
  });

  it('Zoho Books, QuickBooks and Xero files follow their import layouts', async () => {
    const get = async (o: object) => {
      const e = (await pm.post('/accounting/exports', f({ onlyNew: false, ...o })).expect(201)).body;
      return (await pm.get(`/accounting/exports/${e.id}/download`).expect(200)).text.replace(/^﻿/, '').trim().split('\r\n');
    };
    const zi = await get({ format: 'zoho_books', kind: 'invoices' });
    expect(zi[0]).toMatch(/^Invoice Date,Invoice Number,Invoice Status,Customer Name/);
    expect(zi).toHaveLength(5); // 2 invoices × 2 lines
    expect(zi[1]).toContain('Survey revenue');
    expect(zi[1]).toContain(',GST,18.00,');
    const zb = await get({ format: 'zoho_books', kind: 'bills' });
    expect(zb[1]).toMatch(/^2026-10-10,BILL-2026-00001,Open,'=Panel A,/);
    const qb = await get({ format: 'quickbooks', kind: 'invoices' });
    expect(qb[0]).toBe('InvoiceNo,Customer,InvoiceDate,DueDate,Memo,Item(Product/Service),ItemDescription,ItemQuantity,ItemRate,ItemAmount,Taxable,TaxRate,Currency');
    const xe = await get({ format: 'xero', kind: 'invoices' });
    expect(xe[0].split(',')).toHaveLength(28);
    expect(xe[1]).toContain('Tax on Sales');
    expect(xe.find((r) => r.includes('INV-2026-00002'))).toContain('Tax Exempt');
  });

  it('marks documents exported, and "only new" skips them next time', async () => {
    await prisma.invoice.updateMany({ where: { organizationId: org }, data: { exportedAt: null } });
    await prisma.vendorBill.updateMany({ where: { organizationId: org }, data: { exportedAt: null } });
    const first = (await pm.post('/accounting/exports', f({ format: 'zoho_books', kind: 'invoices' })).expect(201)).body;
    expect(first.invoiceCount).toBe(2);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: ids.i1 } })).exportedAt).not.toBeNull();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: ids.i3 } })).exportedAt).toBeNull();
    await pm.post('/accounting/exports', f({ format: 'zoho_books', kind: 'invoices' })).expect(400);
    const again = (await pm.post('/accounting/exports/preview', f({ format: 'zoho_books', kind: 'invoices', onlyNew: false })).expect(200)).body;
    expect(again.warnings.join(' ')).toMatch(/exported before/);
    // Bills were not part of it.
    expect((await pm.post('/accounting/exports', f({ format: 'zoho_books', kind: 'bills' })).expect(201)).body.billCount).toBe(1);
  });

  it('keeps a history to download again, per organization', async () => {
    const list = (await pm.get('/accounting/exports').expect(200)).body;
    expect(list.length).toBeGreaterThanOrEqual(7);
    expect(list[0]).toMatchObject({ formatLabel: 'Zoho Books', kind: 'bills', billCount: 1, createdBy: 'PROJECT_MANAGER' });
    expect(await prisma.auditEvent.count({ where: { action: 'accounting.export' } })).toBe(list.length);
    await other.get(`/accounting/exports/${list[0].id}/download`).expect(404);
    expect((await other.get('/accounting/exports').expect(200)).body).toEqual([]);
    expect((await other.post('/accounting/exports/preview', f({})).expect(200)).body.invoiceCount).toBe(0);
  });
});
