import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { EntitlementsService } from '../../src/super-admin/entitlements';
import { FEATURE_KEYS, featureForRoute, MOBILE_FEATURE_KEYS } from '../../src/super-admin/features';
import { effectiveLimits } from '../../src/super-admin/limits';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

/** Usage limits per plan and per organisation (docs/PLAN_LIMITS.md). */
describe('Plan limits: projects, clients, vendors, portal logins, clicks, completes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenant: Awaited<ReturnType<typeof makeOrg>>;
  let sa: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  const http = () => request(app.getHttpServer());
  const sub = (limits: object | null, extra: object = {}) =>
    sa.put(`/super-admin/organizations/${tenant.org.id}/subscription`, { planCode: 'tiny', status: 'ACTIVE', endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), limits, ...extra }).expect(200);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    await prisma.automationRule.deleteMany();
    await prisma.plan.deleteMany();
    const owner = await makeOrg(prisma, 'pl-owner');
    tenant = await makeOrg(prisma, 'pl-tenant');
    await prisma.organization.update({ where: { id: owner.org.id }, data: { platformOwner: true } });
    await prisma.user.update({ where: { id: owner.users.ADMIN.id }, data: { superAdmin: true } });
    sa = api(app, await login(app, owner.users.ADMIN.email));
    admin = api(app, await login(app, tenant.users.ADMIN.email));
    pm = api(app, await login(app, tenant.users.PROJECT_MANAGER.email));
    await sa.get('/super-admin/plans').expect(200);
    await sa.post('/super-admin/plans', {
      code: 'tiny', name: 'Tiny', features: FEATURE_KEYS, mobileFeatures: MOBILE_FEATURE_KEYS, maxUsers: 5, maxProjects: 3,
      limits: { clients: 1, vendors: 1, portalUsers: 1, projectsPerMonth: 1, clicksPerMonth: 2, trafficAction: 'stop' },
    }).expect(201);
    await sub(null);
  });
  afterAll(() => app.close());

  it('plans carry limits and the organisation can override them', () => {
    const plan = { maxUsers: 5, maxProjects: null, limits: { clients: 10, vendors: 4, clicksPerMonth: 100, trafficAction: 'warn' } };
    expect(effectiveLimits(plan).limits).toMatchObject({ users: 5, projects: null, clients: 10, vendors: 4, clicksPerMonth: 100, completesPerMonth: null });
    expect(effectiveLimits(plan).trafficAction).toBe('warn');
    const o = effectiveLimits(plan, { maxUsers: null, maxProjects: 2, limits: { clients: null, vendors: 8, trafficAction: 'stop' } });
    expect(o.limits).toMatchObject({ users: 5, projects: 2, clients: null, vendors: 8, clicksPerMonth: 100 });
    expect(o.trafficAction).toBe('stop');
    expect(featureForRoute('PUT', '/api/v1/branding/domain')).toBe('custom_domain');
    expect(featureForRoute('PUT', '/api/v1/branding')).toBe('branding');
  });

  it('clients and vendors stop at the limit, also when importing', async () => {
    await pm.post('/clients', { name: 'Acme', code: 'ACME' }).expect(201);
    const over = await pm.post('/clients', { name: 'Beta', code: 'BETA' }).expect(403);
    expect(over.body).toMatchObject({ code: 'PLAN_LIMIT', limit: 'clients', max: 1, used: 1 });
    const imp = (await pm.post('/clients/import', { rows: [{ name: 'Gamma', contact_name: 'G', contact_email: 'g@gamma.test' }] }).expect(201)).body;
    expect(JSON.stringify(imp)).toContain('limit is reached');

    await pm.post('/vendors', { name: 'Panel One', code: 'P1' }).expect(201);
    expect((await pm.post('/vendors', { name: 'Panel Two', code: 'P2' }).expect(403)).body.limit).toBe('vendors');

    // The Super Admin lifts the client limit for this organisation only.
    await sub({ clients: null });
    await pm.post('/clients', { name: 'Beta', code: 'BETA' }).expect(201);
    await sub(null);
  });

  it('portal logins, projects a month and projects in total', async () => {
    const vendorId = (await prisma.vendor.findFirstOrThrow({ where: { organizationId: tenant.org.id } })).id;
    await admin.post('/portal-users', { kind: 'vendor', partyId: vendorId, name: 'V1', email: 'v1@pl.test', password: 'long-enough-password' }).expect(201);
    expect((await admin.post('/portal-users', { kind: 'vendor', partyId: vendorId, name: 'V2', email: 'v2@pl.test', password: 'long-enough-password' }).expect(403)).body.limit).toBe('portalUsers');
  });

  it('respondent clicks: entries past the monthly limit go back to the vendor as quota full', async () => {
    await sub({ clients: null, projectsPerMonth: null });
    const clientId = (await prisma.client.findFirstOrThrow({ where: { organizationId: tenant.org.id } })).id;
    const vendorId = (await prisma.vendor.findFirstOrThrow({ where: { organizationId: tenant.org.id } })).id;
    const p = (await pm.post('/projects', {
      name: 'Limit study', category: 'B2C', clientId,
      defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 2, targetCompletes: 100, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
      countries: [{ countryCode: 'US' }],
    }).expect(201)).body;
    const countryId = p.countries[0].id;
    await pm.post(`/projects/${p.id}/countries/${countryId}/allocations`, { vendorId, cpi: 1, targetCompletes: 100 }).expect(201);
    await pm.patch(`/projects/${p.id}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${p.id}`, { status: 'LIVE' }).expect(200);
    const alloc = (await pm.get(`/projects/${p.id}`).expect(200)).body.countries[0].allocations[0];
    app.get(EntitlementsService).resetTraffic();

    const enter = (uid: string, code = alloc.entryCode) => http().get(`/s/${code}?uid=${uid}`).set('X-Forwarded-For', `198.51.100.${uid.length}`).expect(302);
    expect((await enter('r1')).headers.location).toContain('client.example.com');
    expect((await enter('r22')).headers.location).toContain('client.example.com');
    await enter('r333');
    const third = await prisma.respondentSession.findFirstOrThrow({ where: { projectId: p.id, vendorRespondentId: 'r333' } });
    expect(third).toMatchObject({ status: 'QUOTA_FULL', statusDetail: 'PLAN_CLICK_LIMIT' });
    // Test links are not counted and keep working.
    expect((await enter('t1', alloc.testEntryCode)).headers.location).not.toContain('PLAN');
    const t = await prisma.respondentSession.findFirstOrThrow({ where: { projectId: p.id, vendorRespondentId: 't1' } });
    expect(t.statusDetail).not.toBe('PLAN_CLICK_LIMIT');

    // "Warn only": entries keep going; usage still shows the overrun.
    await sub({ clients: null, projectsPerMonth: null, trafficAction: 'warn' });
    await enter('r4444');
    expect((await prisma.respondentSession.findFirstOrThrow({ where: { projectId: p.id, vendorRespondentId: 'r4444' } })).status).toBe('STARTED');

    const usage = (await admin.get('/billing/usage').expect(200)).body;
    expect(usage.trafficAction).toBe('warn');
    const clicks = usage.limits.find((l: { key: string }) => l.key === 'clicksPerMonth');
    expect(clicks).toMatchObject({ limit: 2, used: 4, period: 'month', traffic: true });
    await pm.get('/billing/usage').expect(403);

    // Projects a month (1 from the plan) and in total (3).
    await sub({ clients: null });
    const body = { name: 'Another', category: 'B2C', clientId, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 2, targetCompletes: 10 }, countries: [{ countryCode: 'US' }] };
    expect((await pm.post('/projects', body).expect(403)).body.limit).toBe('projectsPerMonth');

    const detail = (await sa.get(`/super-admin/organizations/${tenant.org.id}`).expect(200)).body;
    expect(detail.usage.limits.find((l: { key: string }) => l.key === 'vendors')).toMatchObject({ limit: 1, used: 1 });
  });
});
