import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import request from 'supertest';
import { dashboardLimiter, MAX_ACTIVE_DASHBOARD_LINKS } from '../../src/dashboard-links/dashboard-links';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

describe('Live client dashboard links (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let projectId: string;
  let countryId: string;
  let entryCode: string;
  let n = 0;
  let orgId: string;
  const http = () => request(app.getHttpServer());
  const view = (token: string) => http().get(`/api/v1/public/dashboard/${token}`);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    dashboardLimiter.reset();
    const a = await makeOrg(prisma, 'dash');
    orgId = a.org.id;
    const b = await makeOrg(prisma, 'dash-other');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Acme Research', code: 'ACM' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Panel North', code: 'PN' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'Brand tracker',
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 4, targetCompletes: 20, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    projectId = p.id;
    countryId = p.countries[0].id;
    await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId, cpi: 1.5, targetCompletes: 20 }).expect(201);
    await pm.put(`/projects/${projectId}/countries/${countryId}/quotas`, { cells: [{ group: 'Device', name: 'Desktop', target: 5, conditions: [{ source: 'device', values: ['desktop'] }] }] }).expect(200);
    await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);
    entryCode = (await pm.get(`/projects/${projectId}`).expect(200)).body.countries[0].allocations[0].entryCode;
  });

  afterAll(async () => {
    await app.close();
  });

  async function completeOne() {
    const id = `D${++n}`;
    const entry = await http().get(`/s/${entryCode}?uid=${id}`).set('User-Agent', DESKTOP).set('X-Forwarded-For', `198.51.100.${n}`).expect(302);
    const token = new URL(entry.headers.location).searchParams.get('rid');
    expect(token).toBeTruthy();
    await http().get(`/r/complete?token=${token}`).expect(302);
  }

  it('lets only editors of the same organisation make and see links', async () => {
    await viewer.get(`/projects/${projectId}/dashboard-links`).expect(403);
    await viewer.post(`/projects/${projectId}/dashboard-links`, {}).expect(403);
    await other.get(`/projects/${projectId}/dashboard-links`).expect(404);
    await other.post(`/projects/${projectId}/dashboard-links`, {}).expect(404);
    const list = (await pm.get(`/projects/${projectId}/dashboard-links`).expect(200)).body;
    expect(list).toMatchObject({ shareable: true, links: [] });
    await pm.post(`/projects/${projectId}/dashboard-links`, { expiresAt: new Date(Date.now() - 1000).toISOString() }).expect(400);
  });

  it('shows completes and quotas without signing in, and hides money and vendors by default', async () => {
    const link = (await pm.post(`/projects/${projectId}/dashboard-links`, { label: 'Acme team' }).expect(201)).body;
    expect(link).toMatchObject({ label: 'Acme team', state: 'ACTIVE', showMoney: false, showVendors: false, createdBy: 'PROJECT_MANAGER' });
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    await completeOne();
    await completeOne();

    const v = (await view(link.token).expect(200)).body;
    expect(v.project).toMatchObject({ code: expect.any(String), name: 'Brand tracker', status: 'LIVE' });
    expect(v.totals).toMatchObject({ target: 20, completes: 2, last24h: 2 });
    expect(v.pace).toHaveLength(24);
    expect(v.pace[23]).toBe(2);
    expect(v.markets).toEqual([
      expect.objectContaining({ countryCode: 'US', target: 20, completes: 2, quotas: [{ group: 'Device', name: 'Desktop', target: 5, completes: 2, open: true }] }),
    ]);
    // Nothing a client must not see.
    const raw = JSON.stringify(v);
    for (const secret of ['Panel North', 'cpi', 'spend', 'payout', 'margin', 'entryCode', 'client.example.com', projectId, countryId]) expect(raw).not.toContain(secret);
    expect(v.vendors).toBeUndefined();
    expect(v.markets[0].money).toBeUndefined();

    const after = (await pm.get(`/projects/${projectId}/dashboard-links`).expect(200)).body.links[0];
    expect(after.viewCount).toBe(1);
    expect(after.lastViewedAt).toBeTruthy();
  });

  it('adds client spend and vendor completes only when switched on, never vendor cost', async () => {
    const link = (await pm.post(`/projects/${projectId}/dashboard-links`, { showMoney: true }).expect(201)).body;
    let v = (await view(link.token).expect(200)).body;
    expect(v.markets[0].money).toEqual({ currency: 'USD', cpi: 4, spend: 8 });
    expect(v.vendors).toBeUndefined();
    await pm.patch(`/projects/${projectId}/dashboard-links/${link.id}`, { showVendors: true }).expect(200);
    v = (await view(link.token).expect(200)).body;
    expect(v.vendors).toEqual([{ name: 'Panel North', target: 20, completes: 2, active: true }]);
    expect(JSON.stringify(v)).not.toContain('1.5');
    await other.patch(`/projects/${projectId}/dashboard-links/${link.id}`, { showVendors: false }).expect(404);
  });

  it('stops working when revoked, expired or the project goes back to draft', async () => {
    const link = (await pm.post(`/projects/${projectId}/dashboard-links`, {}).expect(201)).body;
    await view(link.token).expect(200);
    const revoked = (await pm.post(`/projects/${projectId}/dashboard-links/${link.id}/revoke`).expect(201)).body;
    expect(revoked.state).toBe('REVOKED');
    const gone = await view(link.token).expect(404);
    expect(gone.body.code ?? gone.body.message?.code).toBe('DASHBOARD_LINK_UNAVAILABLE');
    await pm.patch(`/projects/${projectId}/dashboard-links/${link.id}`, { showMoney: true }).expect(400);

    const soon = (await pm.post(`/projects/${projectId}/dashboard-links`, { expiresAt: new Date(Date.now() + 60_000).toISOString() }).expect(201)).body;
    await view(soon.token).expect(200);
    await prisma.clientDashboardLink.update({ where: { id: soon.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await view(soon.token).expect(404);
    expect((await pm.get(`/projects/${projectId}/dashboard-links`).expect(200)).body.links.find((l: { id: string }) => l.id === soon.id).state).toBe('EXPIRED');

    const live = (await pm.post(`/projects/${projectId}/dashboard-links`, {}).expect(201)).body;
    await prisma.project.update({ where: { id: projectId }, data: { status: 'DRAFT' } });
    await view(live.token).expect(404);
    await prisma.project.update({ where: { id: projectId }, data: { status: 'LIVE' } });
    await view(live.token).expect(200);

    await view('not-a-real-token-at-all-xxxxxxxx').expect(404);
    await view('short').expect(404);
    const audit = await prisma.auditEvent.findMany({ where: { entityId: projectId, action: { startsWith: 'dashboard_link.' } } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['dashboard_link.created', 'dashboard_link.updated', 'dashboard_link.revoked']));
  });

  it('stops working when the plan no longer includes client dashboards', async () => {
    const link = (await pm.post(`/projects/${projectId}/dashboard-links`, { label: 'Plan check' }).expect(201)).body;
    await view(link.token).expect(200);
    const off = await prisma.featureOverride.create({ data: { organizationId: orgId, feature: 'client_dashboards', channel: 'web', enabled: false } });
    expect((await view(link.token).expect(404)).body.code).toBe('DASHBOARD_LINK_UNAVAILABLE');
    await prisma.featureOverride.delete({ where: { id: off.id } });
    await view(link.token).expect(200);
  });

  it('caps working links per project', async () => {
    const working = (await pm.get(`/projects/${projectId}/dashboard-links`).expect(200)).body.links.filter((l: { state: string }) => l.state === 'ACTIVE').length;
    for (let i = working; i < MAX_ACTIVE_DASHBOARD_LINKS; i++) await pm.post(`/projects/${projectId}/dashboard-links`, {}).expect(201);
    await pm.post(`/projects/${projectId}/dashboard-links`, {}).expect(400);
  });
});
