import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Dashboard widgets (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let orgId: string;
  const http = () => request(app.getHttpServer());

  async function run(code: string, uid: string, status?: string) {
    const entry = await http().get(`/s/${code}?uid=${uid}`).expect(302);
    if (!status) return;
    const token = new URL(entry.headers.location).searchParams.get('rid')!;
    await http().get(`/r/${status}?token=${token}`).expect(302);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'dw-a');
    const b = await makeOrg(prisma, 'dw-b');
    orgId = a.org.id;
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));

    const client = (await pm.post('/clients', { name: 'Client W', code: 'CW' }).expect(201)).body.id;
    const vendor = (await pm.post('/vendors', { name: 'Vendor W', code: 'VW' }).expect(201)).body.id;
    const proj = (
      await pm
        .post('/projects', {
          name: 'Widget study',
          category: 'B2C',
          clientId: client,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 9, targetCompletes: 50, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }, { countryCode: 'DE', language: 'de', currency: 'EUR', cpi: 8 }],
        })
        .expect(201)
    ).body;
    for (const c of proj.countries) {
      await pm.post(`/projects/${proj.id}/countries/${c.id}/allocations`, { vendorId: vendor, cpi: 3, targetCompletes: 20 }).expect(201);
      await pm.patch(`/projects/${proj.id}/countries/${c.id}`, { status: 'LIVE' }).expect(200);
    }
    await pm.patch(`/projects/${proj.id}`, { status: 'LIVE' }).expect(200);
    const detail = (await pm.get(`/projects/${proj.id}`).expect(200)).body;
    const code = (cc: string) => detail.countries.find((c: { countryCode: string }) => c.countryCode === cc).allocations[0].entryCode;
    await run(code('US'), 'U-1', 'complete');
    await run(code('US'), 'U-2', 'complete');
    await run(code('US'), 'U-3', 'terminate');
    await run(code('DE'), 'D-1', 'complete');
    const u2 = await prisma.respondentSession.findFirstOrThrow({ where: { vendorRespondentId: 'U-2' } });
    await pm.post(`/projects/${proj.id}/sessions/approval`, { sessionIds: [u2.id], approval: 'REJECTED' }).expect(201);
    // Fix the entry time of every session: Monday 2026-10-26 13:30 UTC (14:30 in Berlin, CET).
    await prisma.respondentSession.updateMany({ where: { organizationId: orgId }, data: { startedAt: new Date('2026-10-26T13:30:00Z') } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('each person keeps their own layout; new widgets are appended and reset restores the default', async () => {
    const d = (await viewer.get('/dashboard/layout').expect(200)).body;
    expect(d.custom).toBe(false);
    expect(d.widgets[0]).toEqual({ id: 'kpis', size: 'full', hidden: false });
    expect(d.widgets.map((w: { id: string }) => w.id)).toEqual(expect.arrayContaining(['map', 'heatmap', 'waterfall']));

    // Viewers can arrange their own dashboard. A saved layout that omits widgets gets them appended.
    const saved = (await viewer.put('/dashboard/layout', { widgets: [{ id: 'map', size: 'full' }, { id: 'kpis', size: 'half', hidden: true }] }).expect(200)).body;
    expect(saved.widgets.slice(0, 2)).toEqual([{ id: 'map', size: 'full', hidden: false }, { id: 'kpis', size: 'half', hidden: true }]);
    expect(saved.widgets).toHaveLength(d.widgets.length);
    expect((await viewer.get('/dashboard/layout').expect(200)).body).toMatchObject({ custom: true, widgets: saved.widgets });
    // Someone else's layout is untouched.
    expect((await pm.get('/dashboard/layout').expect(200)).body.custom).toBe(false);

    await viewer.put('/dashboard/layout', { widgets: [{ id: 'map', size: 'full' }, { id: 'map', size: 'half' }] }).expect(400);
    await viewer.put('/dashboard/layout', { widgets: [{ id: 'pie', size: 'full' }] }).expect(400);
    await viewer.put('/dashboard/layout', { widgets: [{ id: 'map', size: 'huge' }] }).expect(400);
    await viewer.put('/dashboard/layout', { widgets: [{ id: 'map', size: 'full', hidden: true }] }).expect(400);

    // An unreadable stored layout falls back to the default rather than breaking the page.
    const v = await prisma.user.findFirstOrThrow({ where: { organizationId: orgId, role: 'VIEWER' } });
    await prisma.user.update({ where: { id: v.id }, data: { dashboardLayout: { nonsense: true } } });
    expect((await viewer.get('/dashboard/layout').expect(200)).body.custom).toBe(false);
    expect((await viewer.delete('/dashboard/layout').expect(200)).body.custom).toBe(false);
  });

  it('markets: per-country traffic and converted money, with live markets', async () => {
    const range = '?from=2026-10-20&to=2026-10-31';
    let m = (await pm.get(`/dashboard/markets${range}`).expect(200)).body;
    expect(m.currency).toBe('USD');
    const us = m.markets.find((x: { countryCode: string }) => x.countryCode === 'US');
    // U-2 is rejected: one billable complete at CPI 9, payout 3.
    expect(us).toMatchObject({ clicks: 3, completes: 2, revenue: 9, profit: 6, liveMarkets: 1, missing: [] });
    expect(m.markets.find((x: { countryCode: string }) => x.countryCode === 'DE')).toMatchObject({ completes: 1, revenue: 0, missing: ['EUR'] });

    await prisma.exchangeRate.create({ data: { organizationId: orgId, currency: 'EUR', rate: 1.5 } });
    m = (await pm.get(`/dashboard/markets${range}`).expect(200)).body;
    expect(m.markets.find((x: { countryCode: string }) => x.countryCode === 'DE')).toMatchObject({ revenue: 12, profit: 7.5, margin: 62.5, missing: [] });
    // Outside the period: no traffic, but live markets still show.
    const empty = (await pm.get('/dashboard/markets?from=2025-01-01&to=2025-01-31').expect(200)).body;
    expect(empty.markets).toEqual(expect.arrayContaining([expect.objectContaining({ countryCode: 'US', clicks: 0, liveMarkets: 1 })]));
    expect((await other.get(`/dashboard/markets${range}`).expect(200)).body.markets).toEqual([]);
  });

  it('heatmap: entries by weekday and hour in the viewer time zone', async () => {
    const utc = (await pm.get('/dashboard/heatmap?from=2026-10-20&to=2026-10-31').expect(200)).body;
    expect(utc).toMatchObject({ tz: 'UTC', total: 4, max: 4 });
    expect(utc.entries[0][13]).toBe(4);
    expect(utc.completes[0][13]).toBe(3);
    const berlin = (await pm.get('/dashboard/heatmap?from=2026-10-20&to=2026-10-31&tz=Europe/Berlin').expect(200)).body;
    expect(berlin.entries[0][14]).toBe(4);
    await pm.get('/dashboard/heatmap?tz=Mars/Olympus').expect(400);
    await pm.get("/dashboard/heatmap?tz=UTC'%3B--").expect(400);
  });

  it('waterfall: completes value to profit in the reporting currency', async () => {
    const w = (await pm.get('/dashboard/waterfall?from=2026-10-20&to=2026-10-31').expect(200)).body;
    // Completes: U-1 (9 USD), U-2 rejected (9 USD), D-1 (8 EUR × 1.5 = 12). Payout: 3 + 3 × 1.5 (U-2 rejected: none).
    expect(w.steps.map((s: { key: string; value: number }) => [s.key, s.value])).toEqual([
      ['gross', 30],
      ['rejected', -9],
      ['revenue', 21],
      ['payout', -7.5],
      ['profit', 13.5],
    ]);
    expect(w).toMatchObject({ currency: 'USD', pending: 21, margin: 64.3, missing: [] });

    const d = (await pm.get('/dashboard?from=2026-10-20&to=2026-10-31').expect(200)).body;
    expect(d.period.converted).toMatchObject({ currency: 'USD', current: { revenue: 21, cost: 7.5, profit: 13.5, missing: [] } });
    await prisma.exchangeRate.deleteMany({ where: { organizationId: orgId } });
  });
});
