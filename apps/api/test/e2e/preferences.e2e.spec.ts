import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Interface preferences (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'prefs');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
  });
  afterAll(async () => {
    await app.close();
  });

  it('starts empty, merges partial updates, and is per user', async () => {
    expect((await pm.get('/auth/me').expect(200)).body.preferences).toEqual({});
    await pm.patch('/auth/me/preferences', { theme: 'midnight', mode: 'dark' }).expect(200);
    const r = (await pm.patch('/auth/me/preferences', { density: 'compact', favorites: ['/reports'] }).expect(200)).body;
    expect(r).toEqual({ theme: 'midnight', mode: 'dark', density: 'compact', favorites: ['/reports'] });
    expect((await pm.get('/auth/me').expect(200)).body.preferences).toEqual(r);
    // Another user in the same organization keeps their own settings.
    expect((await viewer.get('/auth/me').expect(200)).body.preferences).toEqual({});
  });

  it('rejects unknown keys and bad values', async () => {
    await pm.patch('/auth/me/preferences', { theme: 'neon' }).expect(400);
    await pm.patch('/auth/me/preferences', { accent: 'red' }).expect(400);
    await pm.patch('/auth/me/preferences', { radius: 99 }).expect(400);
    await pm.patch('/auth/me/preferences', { favorites: ['javascript:alert(1)'] }).expect(400);
    await pm.patch('/auth/me/preferences', { isAdmin: true }).expect(400);
  });

  it('resets to defaults', async () => {
    await pm.post('/auth/me/preferences/reset').expect(200);
    expect((await pm.get('/auth/me').expect(200)).body.preferences).toEqual({});
  });
});

describe('Insights (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
  });
  afterAll(async () => {
    await app.close();
  });

  it('flags idle live markets and is tenant scoped', async () => {
    const a = await makeOrg(prisma, 'ins-a');
    const b = await makeOrg(prisma, 'ins-b');
    const pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    const other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const client = (await pm.post('/clients', { name: 'Client I', code: 'CI' }).expect(201)).body.id;
    const vendor = (await pm.post('/vendors', { name: 'Vendor I', code: 'VI' }).expect(201)).body.id;
    const p = (await pm.post('/projects', { name: 'Idle', category: 'B2B', clientId: client, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 5, targetCompletes: 10, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' }, countries: [{ countryCode: 'US' }] }).expect(201)).body;
    await pm.post(`/projects/${p.id}/countries/${p.countries[0].id}/allocations`, { vendorId: vendor, cpi: 2, targetCompletes: 10 }).expect(201);
    await pm.patch(`/projects/${p.id}/countries/${p.countries[0].id}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${p.id}`, { status: 'LIVE' }).expect(200);

    const r = (await pm.get('/insights').expect(200)).body;
    expect(r.items.map((i: { id: string }) => i.id)).toContain(`idle-${p.countries[0].id}`);
    expect(r.alerts).toBe(1);
    expect(r.activity.length).toBeGreaterThan(0);
    const o = (await other.get('/insights').expect(200)).body;
    expect(o).toEqual({ items: [], alerts: 0, wonBidsNew: 0, activity: [] });
  });
});
