import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const DAY = 86_400_000;

describe('Dashboard overview snapshot (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let orgId: string;
  const http = () => request(app.getHttpServer());

  async function run(code: string, uid: string, status: string) {
    const entry = await http().get(`/s/${code}?uid=${uid}`).expect(302);
    const token = new URL(entry.headers.location).searchParams.get('rid')!;
    await http().get(`/r/${status}?token=${token}`).expect(302);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'snap-a');
    const b = await makeOrg(prisma, 'snap-b');
    orgId = a.org.id;
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));

    const client = (await pm.post('/clients', { name: 'Client S', code: 'CS' }).expect(201)).body.id;
    await pm.post('/clients', { name: 'Client T', code: 'CT' }).expect(201);
    const vendor = (await pm.post('/vendors', { name: 'Vendor S', code: 'VS' }).expect(201)).body.id;
    const make = async (name: string) =>
      (
        await pm
          .post('/projects', {
            name,
            category: 'B2C',
            clientId: client,
            defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 9, targetCompletes: 50, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
            countries: [{ countryCode: 'US' }],
          })
          .expect(201)
      ).body;
    const live = await make('Snapshot live');
    const c = live.countries[0];
    await pm.post(`/projects/${live.id}/countries/${c.id}/allocations`, { vendorId: vendor, cpi: 3, targetCompletes: 20 }).expect(201);
    await pm.patch(`/projects/${live.id}/countries/${c.id}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${live.id}`, { status: 'LIVE' }).expect(200);
    await make('Snapshot draft');

    const detail = (await pm.get(`/projects/${live.id}`).expect(200)).body;
    const code = detail.countries[0].allocations[0].entryCode;
    await run(code, 'T-1', 'complete');
    await run(code, 'T-2', 'complete');
    await run(code, 'T-3', 'terminate');
    await run(code, 'Y-1', 'complete');
    await run(code, 'O-1', 'complete');
    // T-* stay today; Y-1 moves to yesterday; O-1 to 20 days ago (outside the last 7 days).
    const at = (ms: number) => new Date(Math.floor(ms / DAY) * DAY + 12 * 3600_000);
    await prisma.respondentSession.updateMany({ where: { organizationId: orgId, vendorRespondentId: { startsWith: 'T-' } }, data: { startedAt: at(Date.now()) } });
    await prisma.respondentSession.updateMany({ where: { organizationId: orgId, vendorRespondentId: 'Y-1' }, data: { startedAt: at(Date.now() - DAY) } });
    await prisma.respondentSession.updateMany({ where: { organizationId: orgId, vendorRespondentId: 'O-1' }, data: { startedAt: at(Date.now() - 20 * DAY) } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts projects by status, clients, vendors and traffic for today, yesterday and the last 7 days', async () => {
    const s = (await viewer.get('/dashboard/snapshot').expect(200)).body;
    expect(s.projects).toMatchObject({ all: 2, live: 1, draft: 1, test: 0, hold: 0, closed: 0 });
    expect(s.clients).toEqual({ total: 2, active: 2 });
    expect(s.vendors).toEqual({ total: 1, active: 1 });
    const p = Object.fromEntries(s.periods.map((x: { id: string }) => [x.id, x]));
    expect(Object.keys(p)).toEqual(['today', 'yesterday', 'week', 'month']);
    expect(p.today).toMatchObject({ clicks: 3, completes: 2, conversion: 66.7, revenue: 18, cost: 6, profit: 12 });
    expect(p.today.trend).toEqual({ clicks: 200, completes: 100, revenue: 100 });
    expect(p.yesterday).toMatchObject({ clicks: 1, completes: 1, revenue: 9 });
    expect(p.week).toMatchObject({ clicks: 4, completes: 3, revenue: 27 });
    // 20 days ago is before the 7-day window; whether it is in "this month" depends on today's date.
    expect([3, 4]).toContain(p.month.completes);
  });

  it('only shows the caller’s own organisation', async () => {
    const s = (await other.get('/dashboard/snapshot').expect(200)).body;
    expect(s.projects.all).toBe(0);
    expect(s.clients.total).toBe(0);
    expect(s.periods.every((x: { clicks: number }) => x.clicks === 0)).toBe(true);
  });
});
