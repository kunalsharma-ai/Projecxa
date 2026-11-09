import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { IntegrationsService } from '../../src/integrations/integrations.service';
import { PushService } from '../../src/push/push';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

type Sent = { to: string; title: string; body: string; data: { path: string } };

describe('Push notifications to the phone app (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let push: PushService;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let portal: ReturnType<typeof api>;
  let users: Record<string, { id: string; email: string }>;
  let org: string;
  let projectId: string;
  let sent: Sent[][] = [];
  let auth: (string | null)[] = [];
  /** What Expo answers per message; default ok. */
  let answer: (m: Sent) => { status: string; message?: string; details?: { error?: string } } = () => ({ status: 'ok' });
  const tok = (n: string) => `ExponentPushToken[${n.padEnd(22, 'x')}]`;
  const env = { ...process.env };

  beforeAll(async () => {
    delete process.env.EXPO_PUSH;
    ({ app, prisma } = await createApp());
    push = app.get(PushService);
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'push');
    org = a.org.id;
    users = a.users;
    admin = api(app, await login(app, users.ADMIN.email));
    pm = api(app, await login(app, users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, users.VIEWER.email));
    const clientId = (await pm.post('/clients', { name: 'Acme', code: 'ACM' }).expect(201)).body.id;
    projectId = (await pm.post('/projects', { name: 'Tracker', category: 'B2C', clientId, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 5, targetCompletes: 100, currency: 'USD' }, countries: [{ countryCode: 'US' }] }).expect(201)).body.id;
    // Clients only see projects past draft.
    await prisma.project.update({ where: { id: projectId }, data: { status: 'LIVE' } });
    await pm.post('/portal-users', { kind: 'client', partyId: clientId, name: 'Client user', email: 'client@push.test', password: 'a-long-portal-pass' }).expect(201);
    const pt = (await (await import('supertest')).default(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'client@push.test', password: 'a-long-portal-pass' }).expect(200)).body.token;
    portal = api(app, pt);
    app.get(IntegrationsService).pushSend = async (messages, accessToken) => {
      sent.push(messages as unknown as Sent[]);
      auth.push(accessToken);
      return { status: 200, text: async () => JSON.stringify({ data: (messages as unknown as Sent[]).map((m) => answer(m)) }) };
    };
  });
  afterAll(async () => {
    process.env = env;
    await app.close();
  });
  beforeEach(() => {
    sent = [];
    auth = [];
    answer = () => ({ status: 'ok' });
  });
  const all = () => sent.flat();

  it('registers phones with the categories each person can get', async () => {
    await pm.post('/push/devices', { token: 'not-a-token', platform: 'android' }).expect(400);
    await pm.post('/push/devices', { token: tok('pm'), platform: 'web' }).expect(400);
    const d = (await pm.post('/push/devices', { token: tok('pm'), platform: 'android', name: 'Pixel 9' }).expect(200)).body;
    expect(d.categories).toEqual(['alerts', 'requests', 'tasks', 'team', 'won_bids']);
    expect(d.available.map((c: { key: string }) => c.key)).toEqual(['alerts', 'requests', 'tasks', 'team', 'won_bids']);
    expect(d.enabled).toBe(false);
    // Choosing categories; unknown ones are dropped, and a refresh keeps the choice.
    expect((await pm.post('/push/devices', { token: tok('pm'), platform: 'android', categories: ['alerts', 'requests', 'tasks', 'nope'] }).expect(200)).body.categories).toEqual(['alerts', 'requests', 'tasks']);
    expect((await pm.post('/push/devices', { token: tok('pm'), platform: 'android' }).expect(200)).body.categories).toEqual(['alerts', 'requests', 'tasks']);
    // Portal people only get requests.
    const p = (await portal.post('/push/devices', { token: tok('client'), platform: 'ios' }).expect(200)).body;
    expect(p.categories).toEqual(['requests']);
    // A phone that someone else signs in on moves to them with fresh categories.
    await viewer.post('/push/devices', { token: tok('shared'), platform: 'ios', categories: ['tasks'] }).expect(200);
    expect((await admin.post('/push/devices', { token: tok('shared'), platform: 'ios' }).expect(200)).body.categories).toHaveLength(5);
    expect((await prisma.pushDevice.findUniqueOrThrow({ where: { token: tok('shared') } })).userId).toBe(users.ADMIN.id);
    // Only your own phone can be removed.
    await viewer.post('/push/devices/remove', { token: tok('shared') }).expect(200);
    expect(await prisma.pushDevice.count({ where: { token: tok('shared') } })).toBe(1);
    await admin.post('/push/devices/remove', { token: tok('shared') }).expect(200);
    expect(await prisma.pushDevice.count({ where: { token: tok('shared') } })).toBe(0);
  });

  it('sends nothing until an admin turns push on in Settings → Integrations', async () => {
    await pm.post('/push/test', { token: tok('pm') }).expect(400);
    expect(await push.notify([users.PROJECT_MANAGER.id], 'alerts', { title: 't', body: 'b', path: '/' })).toBe(0);
    expect(sent).toEqual([]);
    const list = (await admin.get('/integrations/settings').expect(200)).body.integrations;
    expect(list.find((i: { kind: string }) => i.kind === 'push')).toMatchObject({ group: 'Mobile', scope: 'platform', status: { state: 'off' } });
    await pm.put('/integrations/settings/push', { values: { EXPO_PUSH: 'on' } }).expect(403);
    await admin.put('/integrations/settings/push', { values: { EXPO_PUSH: 'on', EXPO_ACCESS_TOKEN: 'expo-secret-token' } }).expect(200);
    const saved = (await admin.get('/integrations/settings').expect(200)).body.integrations.find((i: { kind: string }) => i.kind === 'push');
    expect(saved.status.state).toBe('connected');
    expect(JSON.stringify(saved)).not.toContain('expo-secret-token');
    // The admin's test sends to the admin's own phones.
    expect((await admin.post('/integrations/settings/push/test').expect(200)).body).toMatchObject({ ok: false, message: expect.stringMatching(/Sign in to the SampTrek phone app/) });
    await admin.post('/push/devices', { token: tok('admin'), platform: 'android' }).expect(200);
    expect((await admin.post('/integrations/settings/push/test').expect(200)).body).toMatchObject({ ok: true });
    expect(auth.at(-1)).toBe('expo-secret-token');
  });

  it('sends a test to one phone, and forgets phones Expo says are gone', async () => {
    await pm.post('/push/test', { token: tok('pm') }).expect(200);
    expect(all()).toMatchObject([{ to: tok('pm'), title: 'SampTrek', data: { path: '/' } }]);
    await viewer.post('/push/test', { token: tok('pm') }).expect(404);
    answer = () => ({ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } });
    await admin.post('/push/test', { token: tok('admin') }).expect(400);
    expect(await prisma.pushDevice.count({ where: { token: tok('admin') } })).toBe(0);
  });

  it('pushes new requests and replies to the person they are meant for', async () => {
    const r = (await portal.post('/portal/requests', { subject: 'Change the LOI', body: 'Can we go to 12 minutes?', projectId }).expect(201)).body;
    expect(all()).toMatchObject([{ to: tok('pm'), title: expect.stringMatching(/^New request/), body: 'Change the LOI', data: { path: `/requests/${r.id}` } }]);
    sent = [];
    await pm.post(`/requests/${r.id}/messages`, { body: 'Yes, done.' }).expect(201);
    expect(all()).toMatchObject([{ to: tok('client'), title: expect.stringMatching(/replied on/), data: { path: '/portal/client' } }]);
    // Internal notes never reach the portal.
    sent = [];
    await pm.post(`/requests/${r.id}/messages`, { body: 'note to self', internal: true }).expect(201);
    expect(all()).toEqual([]);
  });

  it('pushes fieldwork alerts to the project manager, only when they want them', async () => {
    const project = { id: projectId, projectCode: 'PRX1', name: 'Tracker' };
    expect(await push.alertOpened(org, { severity: 'info', title: 'x', detail: 'y', project })).toBe(0);
    expect(await push.alertOpened(org, { severity: 'bad', title: 'Stalled', detail: 'No completes for 2 hours', project })).toBe(1);
    expect(all()).toMatchObject([{ to: tok('pm'), title: 'Urgent: PRX1 · Stalled', data: { path: `/projects/${projectId}` } }]);
    await pm.post('/push/devices', { token: tok('pm'), platform: 'android', categories: ['requests'] }).expect(200);
    expect(await push.alertOpened(org, { severity: 'warn', title: 'Behind pace', detail: 'd', project })).toBe(0);
    await pm.post('/push/devices', { token: tok('pm'), platform: 'android', categories: ['alerts', 'requests', 'tasks', 'won_bids'] }).expect(200);
  });

  it('pushes a task reminder once when it comes due, and again after it is moved', async () => {
    const t = (await pm.post('/tasks', { title: 'Send quota update', assigneeId: users.PROJECT_MANAGER.id, remindAt: '2026-01-01T09:00:00.000Z' }).expect(201)).body;
    await pm.post('/tasks', { title: 'Later', assigneeId: users.PROJECT_MANAGER.id, remindAt: '2099-01-01T09:00:00.000Z' }).expect(201);
    expect(await push.taskReminders()).toEqual({ due: 1, sent: 1 });
    expect(all()).toMatchObject([{ to: tok('pm'), title: 'Reminder: Send quota update', data: { path: '/tasks' } }]);
    expect(await push.taskReminders()).toEqual({ due: 0, sent: 0 });
    await pm.patch(`/tasks/${t.id}`, { remindAt: '2026-01-02T09:00:00.000Z' }).expect(200);
    expect((await push.taskReminders()).sent).toBe(1);
    await pm.patch(`/tasks/${t.id}`, { status: 'DONE' }).expect(200);
    await pm.patch(`/tasks/${t.id}`, { remindAt: '2026-01-03T09:00:00.000Z' }).expect(200);
    expect((await push.taskReminders()).due).toBe(0);
  });

  it('tells editors about a won bid, and stops pushing to people who were deactivated', async () => {
    expect(await push.wonBidReceived(org, { name: 'Brand study', bidNumber: 'BID-7' })).toBe(1);
    expect(all()).toMatchObject([{ to: tok('pm'), title: 'Won bid ready to set up', body: 'BID-7 · Brand study', data: { path: '/won-bids' } }]);
    await prisma.user.update({ where: { id: users.PROJECT_MANAGER.id }, data: { active: false } });
    expect(await push.wonBidReceived(org, { name: 'Brand study 2' })).toBe(0);
    await prisma.user.update({ where: { id: users.PROJECT_MANAGER.id }, data: { active: true } });
  });
});
