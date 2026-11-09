import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { accessAllows, readFeatureAccess } from '../../src/super-admin/entitlements';
import { featureForRoute } from '../../src/super-admin/features';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

/**
 * Three layers (docs/FEATURE_ACCESS.md): the plan the organisation bought, the Super Admin's extras or
 * removals for that organisation, then the organisation's Admin choosing who gets each feature.
 */
describe('Feature access: Super Admin → plan → Admin → users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenant: Awaited<ReturnType<typeof makeOrg>>;
  let other: Awaited<ReturnType<typeof makeOrg>>;
  let sa: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  const row = async (key: string) => (await admin.get('/feature-access').expect(200)).body.features.find((f: { key: string }) => f.key === key);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    await prisma.automationRule.deleteMany();
    await prisma.plan.deleteMany();
    const owner = await makeOrg(prisma, 'fa-owner');
    tenant = await makeOrg(prisma, 'fa-tenant');
    other = await makeOrg(prisma, 'fa-other');
    await prisma.organization.update({ where: { id: owner.org.id }, data: { platformOwner: true } });
    await prisma.user.update({ where: { id: owner.users.ADMIN.id }, data: { superAdmin: true } });
    sa = api(app, await login(app, owner.users.ADMIN.email));
    admin = api(app, await login(app, tenant.users.ADMIN.email));
    pm = api(app, await login(app, tenant.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, tenant.users.VIEWER.email));
  });
  afterAll(() => app.close());

  it('features that live inside a project have their own switch', () => {
    expect(featureForRoute('GET', '/api/v1/projects/:id/dashboard-links')).toBe('client_dashboards');
    expect(featureForRoute('GET', '/api/v1/projects/:id/comments')).toBe('collaboration');
    expect(featureForRoute('POST', '/api/v1/projects/:id/countries/:countryId/route')).toBe('vendor_routing');
    expect(featureForRoute('GET', '/api/v1/projects/:id/fraud/linked')).toBe('fraud_checks');
    expect(featureForRoute('GET', '/api/v1/monitor/forecast')).toBe('forecasting');
    expect(featureForRoute('GET', '/api/v1/chat/channels')).toBe('chat');
    expect(featureForRoute('GET', '/api/v1/feature-access')).toBe('team');
    expect(featureForRoute('GET', '/api/v1/projects/:id')).toBe('projects');
  });

  it('a new feature such as team chat starts with admins only, until the Admin allows people', async () => {
    expect((await admin.get('/auth/me/features')).body.web.chat).toBe(true);
    expect((await pm.get('/auth/me/features')).body.web.chat).toBe(false);
    expect((await row('chat')).mode).toBe('admins');
    expect((await row('tasks')).mode).toBe('everyone');
    await admin.put('/feature-access/chat', { mode: 'everyone' }).expect(200);
    expect((await pm.get('/auth/me/features')).body.web.chat).toBe(true);
  });

  it('the Admin chooses who gets a feature, and the API enforces it at once', async () => {
    await pm.get('/tasks').expect(200);
    await admin.put('/feature-access/tasks', { mode: 'off' }).expect(200);
    expect((await pm.get('/tasks').expect(403)).body).toMatchObject({ code: 'FEATURE_DISABLED', feature: 'tasks' });
    await admin.get('/tasks').expect(403);

    await admin.put('/feature-access/tasks', { mode: 'people', people: [tenant.users.PROJECT_MANAGER.id] }).expect(200);
    await pm.get('/tasks').expect(200);
    await viewer.get('/tasks').expect(403);
    await admin.get('/tasks').expect(200);

    await admin.put('/feature-access/tasks', { mode: 'admins' }).expect(200);
    await pm.get('/tasks').expect(403);
    await pm.get('/tasks').set('X-Client', 'mobile').expect(403);
    await admin.get('/tasks').set('X-Client', 'mobile').expect(200);
    await admin.put('/feature-access/tasks', { mode: 'everyone' }).expect(200);
    await viewer.get('/tasks').expect(200);
  });

  it('only admins manage it, only for their own team, and not for features that would lock them out', async () => {
    await pm.get('/feature-access').expect(403);
    await pm.put('/feature-access/tasks', { mode: 'off' }).expect(403);
    await admin.put('/feature-access/team', { mode: 'off' }).expect(400);
    await admin.put('/feature-access/settings', { mode: 'off' }).expect(400);
    await admin.put('/feature-access/nope', { mode: 'off' }).expect(400);
    await admin.put('/feature-access/tasks', { mode: 'people', people: [other.users.PROJECT_MANAGER.id] }).expect(400);
    await admin.put('/feature-access/tasks', { mode: 'sometimes' }).expect(400);
  });

  it('the Admin can only hand out what the plan and the Super Admin give the organisation', async () => {
    await sa.put(`/super-admin/organizations/${tenant.org.id}/subscription`, { planCode: 'starter', status: 'ACTIVE', endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }).expect(200);
    // Starter has no team chat: locked for everyone, and the Admin cannot give it out.
    let chat = await row('chat');
    expect(chat).toMatchObject({ available: false, source: 'not_in_plan' });
    expect((await admin.get('/auth/me/features')).body.web.chat).toBe(false);
    expect((await pm.get('/auth/me/features')).body.web.chat).toBe(false);
    expect((await admin.put('/feature-access/chat', { mode: 'everyone' }).expect(403)).body.code).toBe('FEATURE_NOT_IN_PLAN');

    // The Super Admin allows chat for this organisation as an extra: the Admin's earlier choice applies again.
    await sa.put(`/super-admin/organizations/${tenant.org.id}/features`, { changes: [{ feature: 'chat', channel: 'web', state: 'on' }] }).expect(200);
    chat = await row('chat');
    expect(chat).toMatchObject({ available: true, source: 'extra', mode: 'everyone' });
    expect((await pm.get('/auth/me/features')).body.web.chat).toBe(true);

    // The Super Admin takes tasks away: nobody has it, whatever the Admin chose.
    await sa.put(`/super-admin/organizations/${tenant.org.id}/features`, { changes: [{ feature: 'tasks', channel: 'web', state: 'off' }] }).expect(200);
    expect(await row('tasks')).toMatchObject({ available: false, source: 'taken_away' });
    await admin.get('/tasks').expect(403);
    await pm.get('/tasks').expect(403);

    // The Super Admin sees what the Admin chose.
    const detail = (await sa.get(`/super-admin/organizations/${tenant.org.id}`).expect(200)).body;
    expect(detail.features.find((f: { key: string }) => f.key === 'chat').adminAccess).toEqual({ mode: 'everyone', people: 0 });
  });

  it('reads saved choices safely', () => {
    const a = readFeatureAccess({ tasks: { mode: 'people', people: ['u1', 5] }, chat: { mode: 'bogus' }, team: { mode: 'off' } });
    expect(a.tasks).toEqual({ mode: 'people', people: ['u1'] });
    expect(a.chat.mode).toBe('admins');
    expect(a.team).toBeUndefined();
    expect(readFeatureAccess(null).dashboard.mode).toBe('everyone');
    expect(accessAllows(a.tasks, { id: 'u1', role: 'VIEWER' })).toBe(true);
    expect(accessAllows(a.tasks, { id: 'u2', role: 'VIEWER' })).toBe(false);
    expect(accessAllows(a.tasks, { id: 'u2', role: 'ADMIN' })).toBe(true);
  });
});
