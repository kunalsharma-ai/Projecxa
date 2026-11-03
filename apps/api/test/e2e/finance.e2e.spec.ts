import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Reconciliation, invoicing and finance dashboard (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let projectId: string;
  let codes: Record<string, string>;
  let n = 0;
  const http = () => request(app.getHttpServer());

  /** One respondent through to an outcome; returns the session token the client survey saw. */
  async function respondent(country: 'US' | 'DE', status: 'complete' | 'terminate', uid = `U${++n}`) {
    const res = await http().get(`/s/${codes[country]}?uid=${uid}`).set('X-Forwarded-For', `203.0.113.${n % 250}`).expect(302);
    const token = new URL(res.headers.location).searchParams.get('rid')!;
    await http().get(`/r/${status}?token=${token}`).expect(302);
    return { token, uid };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'fin');
    const b = await makeOrg(prisma, 'fin-other');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Acme Insights', code: 'ACME' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Panel One', code: 'P1' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'Finance study',
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
      await pm.post(`/projects/${projectId}/countries/${c.id}/allocations`, { vendorId, cpi: 4, targetCompletes: 50 }).expect(201);
      await pm.patch(`/projects/${projectId}/countries/${c.id}`, { status: 'LIVE' }).expect(200);
    }
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);
    const detail = (await pm.get(`/projects/${projectId}`).expect(200)).body;
    for (const c of detail.countries) codes[c.countryCode] = c.allocations[0].entryCode;
  });

  afterAll(async () => {
    await app.close();
  });

  it('shows link status on the project list', async () => {
    const list = (await pm.get('/projects').expect(200)).body;
    expect(list.items.find((x: { id: string }) => x.id === projectId).links).toEqual({ live: 2, total: 2 });
  });

  describe('reconciliation', () => {
    let us: { token: string; uid: string }[];
    let de: { token: string; uid: string }[];
    let term: { token: string; uid: string };

    beforeAll(async () => {
      us = [];
      for (let i = 0; i < 5; i++) us.push(await respondent('US', 'complete'));
      de = [await respondent('DE', 'complete'), await respondent('DE', 'complete')];
      term = await respondent('US', 'terminate');
    });

    it('starts with every complete pending', async () => {
      const s = (await pm.get(`/projects/${projectId}/reconciliation`).expect(200)).body;
      expect(s.pending.completes).toBe(7);
      expect(s.pending.byCurrency).toEqual(
        expect.arrayContaining([
          { currency: 'USD', completes: 5, revenue: 50, payout: 20 },
          { currency: 'EUR', completes: 2, revenue: 28, payout: 8 },
        ]),
      );
      expect(s.approved.completes).toBe(0);
      expect(s.history).toEqual([]);
    });

    it('previews a final list without changing anything, matching tokens and vendor UIDs', async () => {
      const ids = [us[0].token, us[1].uid, ` ${us[2].token} `, us[2].token, de[0].token, term.token, 'NOPE-1', 'NOPE-2', ''];
      const r = (await pm.post(`/projects/${projectId}/reconciliation/preview`, { ids, mode: 'final_list' }).expect(201)).body;
      expect(r).toMatchObject({ submitted: 7, matched: 4, approve: 4, reject: 3, unchanged: 0, locked: 0, unknown: 2, ambiguous: 0 });
      expect(r.unknownSample).toEqual(['NOPE-1', 'NOPE-2']);
      expect(r.notComplete).toEqual({ count: 1, sample: [{ id: term.token, status: 'TERMINATE' }] });
      expect(r.approvedAfter).toEqual(expect.arrayContaining([{ currency: 'USD', completes: 3, revenue: 30 }, { currency: 'EUR', completes: 1, revenue: 14 }]));
      const s = (await pm.get(`/projects/${projectId}/reconciliation`).expect(200)).body;
      expect(s.pending.completes).toBe(7);
    });

    it('only editors can reconcile; other tenants see nothing', async () => {
      await viewer.post(`/projects/${projectId}/reconciliation`, { ids: [us[0].token], mode: 'final_list' }).expect(403);
      await other.post(`/projects/${projectId}/reconciliation/preview`, { ids: [us[0].token], mode: 'final_list' }).expect(404);
      await other.get(`/projects/${projectId}/reconciliation`).expect(404);
      await pm.post(`/projects/${projectId}/reconciliation`, { ids: [' '], mode: 'final_list' }).expect(400);
      await pm.post(`/projects/${projectId}/reconciliation`, { ids: ['x'], mode: 'approve_everyone' }).expect(400);
    });

    it('applies a final list: listed approved, everything else rejected, with history and audit', async () => {
      const ids = [us[0].token, us[1].uid, us[2].token, de[0].token, 'NOPE-1'];
      const r = (await pm.post(`/projects/${projectId}/reconciliation`, { ids, mode: 'final_list', note: 'Client file 3 Nov' }).expect(201)).body;
      expect(r).toMatchObject({ approve: 4, reject: 3, unknown: 1 });
      const s = (await pm.get(`/projects/${projectId}/reconciliation`).expect(200)).body;
      expect(s).toMatchObject({ pending: { completes: 0 }, approved: { completes: 4 }, rejected: { completes: 3 }, toInvoice: { completes: 4 } });
      expect(s.history[0]).toMatchObject({ mode: 'final_list', approved: 4, rejected: 3, unknown: 1, note: 'Client file 3 Nov', unknownSample: ['NOPE-1'] });
      expect(s.history[0].actor).toBeTruthy();
      const approved = await prisma.respondentSession.findFirstOrThrow({ where: { token: us[0].token } });
      expect(approved.approval).toBe('APPROVED');
      expect(approved.approvalAt).toBeTruthy();
      expect(await prisma.auditEvent.count({ where: { action: 'project.reconcile', entityId: projectId } })).toBe(1);
    });

    it('re-running the same list changes nothing; approve_listed flips a rejected complete back', async () => {
      const again = (await pm.post(`/projects/${projectId}/reconciliation/preview`, { ids: [us[0].token, us[1].uid, us[2].token, de[0].token], mode: 'final_list' }).expect(201)).body;
      expect(again).toMatchObject({ approve: 0, reject: 0, unchanged: 7 });
      const flip = (await pm.post(`/projects/${projectId}/reconciliation`, { ids: [us[3].token], mode: 'approve_listed' }).expect(201)).body;
      expect(flip).toMatchObject({ approve: 1, reject: 0 });
    });

    describe('invoicing', () => {
      let usd: { id: string; number: string; total: number };
      let eur: { id: string };

      it('creates one draft per currency from approved completes, with lines per market and price', async () => {
        await viewer.post(`/projects/${projectId}/invoices`).expect(403);
        const r = (await pm.post(`/projects/${projectId}/invoices`, { notes: 'PO 4471' }).expect(201)).body;
        expect(r.invoices).toHaveLength(2);
        usd = r.invoices.find((i: { currency: string }) => i.currency === 'USD');
        eur = r.invoices.find((i: { currency: string }) => i.currency === 'EUR');
        expect(usd).toMatchObject({ status: 'DRAFT', completes: 4, total: 40, notes: 'PO 4471' });
        expect(usd.number).toMatch(/^INV-\d{4}-\d{5}$/);
        expect((usd as unknown as { lines: unknown[] }).lines).toEqual([{ countryCode: 'US', description: expect.stringContaining('completes, US'), quantity: 4, unitPrice: 10, amount: 40 }]);
        expect(eur).toMatchObject({ completes: 1, total: 14 });
        await pm.post(`/projects/${projectId}/invoices`).expect(400);
      });

      it('locks invoiced completes against reconciliation and manual approval', async () => {
        const r = (await pm.post(`/projects/${projectId}/reconciliation/preview`, { ids: [us[4].token], mode: 'final_list' }).expect(201)).body;
        expect(r.locked).toBe(5);
        const s = await prisma.respondentSession.findFirstOrThrow({ where: { token: us[0].token } });
        const m = (await pm.post(`/projects/${projectId}/sessions/approval`, { sessionIds: [s.id], approval: 'REJECTED' }).expect(201)).body;
        expect(m).toEqual({ updated: 0, skipped: 1 });
      });

      it('moves through sent and paid, with due dates, and refuses invalid steps', async () => {
        await pm.patch(`/invoices/${usd.id}`).send({ status: 'PAID' }).expect(400);
        await other.patch(`/invoices/${usd.id}`).send({ status: 'SENT' }).expect(404);
        await pm.patch(`/invoices/${usd.id}`).send({ notes: 'PO 4471 / Acme' }).expect(200);
        const sent = (await pm.patch(`/invoices/${usd.id}`).send({ status: 'SENT', dueDays: 45 }).expect(200)).body;
        expect(sent.status).toBe('SENT');
        expect(Date.parse(sent.dueAt) - Date.parse(sent.issuedAt)).toBe(45 * 86_400_000);
        await pm.patch(`/invoices/${usd.id}`).send({ notes: 'too late' }).expect(400);
        const paid = (await pm.patch(`/invoices/${usd.id}`).send({ status: 'PAID' }).expect(200)).body;
        expect(paid.paidAt).toBeTruthy();
        await pm.patch(`/invoices/${usd.id}`).send({ status: 'VOID' }).expect(400);
        const full = (await pm.get(`/invoices/${usd.id}`).expect(200)).body;
        expect(full).toMatchObject({ number: usd.number, issuer: 'fin', client: { name: 'Acme Insights' }, project: { id: projectId } });
        await other.get(`/invoices/${usd.id}`).expect(404);
      });

      it('voiding releases the completes so they can be billed again', async () => {
        await pm.patch(`/invoices/${eur.id}`).send({ status: 'VOID' }).expect(200);
        const s = (await pm.get(`/projects/${projectId}/reconciliation`).expect(200)).body;
        expect(s.toInvoice).toMatchObject({ completes: 1, byCurrency: [{ currency: 'EUR', completes: 1, revenue: 14, payout: 4 }] });
        const again = (await pm.post(`/projects/${projectId}/invoices`).expect(201)).body;
        expect(again.invoices).toHaveLength(1);
        expect(again.invoices[0]).toMatchObject({ currency: 'EUR', total: 14 });
        const list = (await pm.get('/invoices').expect(200)).body;
        expect(list.map((i: { status: string }) => i.status).sort()).toEqual(['DRAFT', 'PAID', 'VOID']);
        expect((await pm.get('/invoices?status=PAID').expect(200)).body).toHaveLength(1);
        expect((await other.get('/invoices').expect(200)).body).toEqual([]);
      });

      it('feeds the dashboard tiles, trend, top 5 lists and the revenue series', async () => {
        const d = (await pm.get('/dashboard').expect(200)).body;
        expect(d.finance.reconciled.count).toBe(5);
        expect(d.finance.pendingReconciliation.count).toBe(0);
        expect(d.finance.invoicePending).toMatchObject({ count: 1, byCurrency: [{ currency: 'EUR', amount: 14 }] });
        expect(d.finance.invoiced.count).toBe(0);
        expect(d.finance.paymentReceived).toMatchObject({ count: 4, byCurrency: [{ currency: 'USD', amount: 40 }] });
        expect(d.period.current).toMatchObject({ clicks: 8, completes: 7 });
        expect(d.period.trend.clicks).toBeNull();
        expect(d.top.vendors[0]).toMatchObject({ label: 'Panel One', completes: 7 });
        expect(d.top.projects[0]).toMatchObject({ id: projectId });
        expect(d.top.clients[0]).toMatchObject({ label: 'Acme Insights' });
        expect(d.clients.total).toBe(1);

        const today = new Date().toISOString().slice(0, 10);
        const day = (await pm.get(`/dashboard/series?interval=day`).expect(200)).body;
        expect(day.points).toHaveLength(30);
        expect(day.points.at(-1)).toMatchObject({ key: today, completes: 7, revenue: 54, payout: 20 });
        const month = (await pm.get(`/dashboard/series?interval=month&from=2026-01-01&to=${today}`).expect(200)).body;
        expect(month.points[0].key).toBe('2026-01');
        expect(month.points.at(-1).key).toBe(today.slice(0, 7));
        const week = (await pm.get(`/dashboard/series?interval=week&from=${today}&to=${today}`).expect(200)).body;
        expect(week.points).toHaveLength(1);
        expect(week.points[0].completes).toBe(7);
        await pm.get('/dashboard?from=2026-05-01&to=2026-04-01').expect(400);
        await pm.get('/dashboard?from=2020-01-01&to=2026-04-01').expect(400);
        const empty = (await pm.get('/dashboard?from=2025-01-01&to=2025-01-31').expect(200)).body;
        expect(empty.period).toMatchObject({ previousFrom: '2024-12-01', previousTo: '2024-12-31', current: { clicks: 0 } });
      });

      it('sending an invoice moves a closed project to invoiced', async () => {
        await pm.patch(`/projects/${projectId}`, { status: 'HOLD' }).expect(200);
        await pm.patch(`/projects/${projectId}`, { status: 'CLOSED' }).expect(200);
        const draft = (await pm.get('/invoices?status=DRAFT').expect(200)).body[0];
        await pm.patch(`/invoices/${draft.id}`).send({ status: 'SENT' }).expect(200);
        expect((await pm.get(`/projects/${projectId}`).expect(200)).body.status).toBe('INVOICED');
      });
    });
  });
});
