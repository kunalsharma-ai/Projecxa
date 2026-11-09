import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClient } from '../../src/prisma/client';
import { randomBytes } from 'crypto';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Profit forecast and margin alert (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let orgId: string;
  let projectId: string;
  let countryId: string;
  let allocCheap: string;
  let allocCostly: string;
  let n = 0;

  /** Live completes straight into the database, with the revenue and payout the engine would record. */
  async function completes(allocationId: string, count: number, hoursAgo: number, payout: number) {
    const started = new Date(Date.now() - hoursAgo * 3_600_000);
    const data: Prisma.RespondentSessionCreateManyInput[] = [];
    for (let i = 0; i < count; i++) {
      data.push({
        organizationId: orgId, projectId, projectCountryId: countryId, vendorAllocationId: allocationId,
        token: randomBytes(12).toString('hex'), vendorRespondentId: `F${++n}`, status: 'COMPLETE', startedAt: started,
        outcomeAt: new Date(started.getTime() + 14 * 60_000), expiresAt: new Date(started.getTime() + 86_400_000),
        revenue: Number(5), payout: Number(payout),
      });
    }
    await prisma.respondentSession.createMany({ data });
  }
  const forecast = () => pm.get(`/monitor/forecast?projectId=${projectId}`).expect(200).then((r) => r.body);
  const marginAlerts = async () => (await pm.get('/alerts').expect(200)).body.filter((a: { rule: string }) => a.rule === 'margin_low');

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'fc');
    const b = await makeOrg(prisma, 'fc-other');
    orgId = a.org.id;
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    admin = api(app, await login(app, a.users.ADMIN.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Client', code: 'CL' }).expect(201)).body.id;
    const vA = (await pm.post('/vendors', { name: 'Cheap Panel', code: 'CP' }).expect(201)).body.id;
    const vB = (await pm.post('/vendors', { name: 'Costly Panel', code: 'XP' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'Forecast study', category: 'B2C', clientId,
          defaults: { language: 'en', loiMinutes: 15, irPercent: 40, cpi: 5, targetCompletes: 100, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    projectId = p.id;
    countryId = p.countries[0].id;
    await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId: vA, cpi: 1, targetCompletes: 50 }).expect(201);
    await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId: vB, cpi: 4.5, targetCompletes: 50 }).expect(201);
    const allocs = (await pm.get(`/projects/${projectId}`).expect(200)).body.countries[0].allocations;
    allocCheap = allocs.find((x: { vendorId: string }) => x.vendorId === vA).id;
    allocCostly = allocs.find((x: { vendorId: string }) => x.vendorId === vB).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('waits until the project is live', async () => {
    expect(await forecast()).toEqual({ forecast: null, reason: 'The forecast runs while the project is live.' });
    await other.get(`/monitor/forecast?projectId=${projectId}`).expect(404);
    await pm.get('/monitor/forecast').expect(400);
  });

  it('predicts finish, cost and margin from the pace and vendor mix', async () => {
    await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);
    await completes(allocCheap, 10, 30, 1);
    await completes(allocCostly, 20, 30, 4.5);
    const f = (await forecast()).forecast;
    // 30 completes in the last 72h of a 30-hour-old project: 24 a day, 70 to go → about 2.9 days.
    expect(f.markets[0]).toMatchObject({ countryCode: 'US', remaining: 70, costBasis: 'vendor_pace' });
    expect(new Date(f.finishAt).getTime()).toBeGreaterThan(Date.now() + 2.5 * 86_400_000);
    // Remaining payout weighted by pace: (1 × 10 + 4.5 × 20) / 30 = 3.33 a complete.
    expect(f.markets[0].costPerComplete).toBeCloseTo(3.33, 2);
    expect(f.currencies[0]).toMatchObject({ currency: 'USD', revenue: 150, cost: 100, plannedRevenue: 500, plannedCost: 275, plannedMarginPct: 45, forecastRevenue: 500 });
    expect(f.currencies[0].forecastMarginPct).toBeCloseTo(33.3, 1);
    expect(f.marginFloorPct).toBe(20);
  });

  it('raises a margin alert under the floor and clears it when the margin recovers', async () => {
    // Organisation floor of 40%: the 33% forecast is under it.
    await admin.put('/organization/alert-settings').send({ settings: { marginFloorPct: 40, marginDropPts: 50 } }).expect(200);
    await pm.post('/monitor/run').expect(201);
    const [a] = await marginAlerts();
    expect(a).toMatchObject({ severity: 'warn', projectId, title: expect.stringMatching(/margin is heading for 33\.\d% \(floor 40%\)$/) });

    // A per-project floor overrides the organisation's.
    await pm.patch(`/projects/${projectId}`, { autopilot: { marginFloorPct: 30 } }).expect(200);
    expect((await forecast()).forecast.marginFloorPct).toBe(30);
    await pm.post('/monitor/run').expect(201);
    expect(await marginAlerts()).toEqual([]);
    await pm.patch(`/projects/${projectId}`, { autopilot: { marginFloorPct: 101 } }).expect(400);
  });

  it('falls on the drop from plan and turns bad when the project would lose money', async () => {
    await admin.put('/organization/alert-settings').send({ settings: { marginFloorPct: 0, marginDropPts: 10 } }).expect(200);
    await pm.patch(`/projects/${projectId}`, { autopilot: {} }).expect(200);
    await pm.post('/monitor/run').expect(201);
    expect((await marginAlerts())[0].title).toMatch(/\(planned 45%\)$/);

    // The cheap panel is paused and the costly one now pays 8 a complete: a loss at finish.
    await pm.patch(`/projects/${projectId}/countries/${countryId}/allocations/${allocCheap}`, { status: 'PAUSED' }).expect(200);
    await prisma.vendorAllocation.update({ where: { id: allocCostly }, data: { cpi: Number(8) } });
    await pm.post('/monitor/run').expect(201);
    const [bad] = await marginAlerts();
    expect(bad.severity).toBe('bad');
    expect((await forecast()).forecast.currencies[0].forecastProfit).toBeLessThan(0);
  });
});
