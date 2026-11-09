import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

/** The Super Admin observes an organisation read-only (docs/SUPER_ADMIN_OBSERVE.md). */
describe('Super Admin observe: see everything in an organisation, change nothing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenant: Awaited<ReturnType<typeof makeOrg>>;
  let saToken: string;
  let sa: ReturnType<typeof api>;
  let pmTenant: ReturnType<typeof api>;
  let observeToken: string;
  const asObserver = () => {
    const a = api(app, saToken);
    const wrap = <T extends { set: (k: string, v: string) => T }>(r: T) => r.set('X-Observe-Token', observeToken);
    return { get: (p: string) => wrap(a.get(p)), post: (p: string, b?: object) => wrap(a.post(p, b)), patch: (p: string, b?: object) => wrap(a.patch(p, b)), delete: (p: string) => wrap(a.delete(p)) };
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const owner = await makeOrg(prisma, 'ob-owner');
    tenant = await makeOrg(prisma, 'ob-tenant');
    await prisma.organization.update({ where: { id: owner.org.id }, data: { platformOwner: true } });
    await prisma.organization.update({ where: { id: tenant.org.id }, data: { customDomain: 'research.tenant.example', customDomainVerifiedAt: new Date(), branding: { appName: 'Tenant Research' } } });
    await prisma.user.update({ where: { id: owner.users.ADMIN.id }, data: { superAdmin: true } });
    saToken = await login(app, owner.users.ADMIN.email);
    sa = api(app, saToken);
    pmTenant = api(app, await login(app, tenant.users.PROJECT_MANAGER.email));
    await pmTenant.post('/clients', { name: 'Tenant client', code: 'TC1' }).expect(201);
  });
  afterAll(() => app.close());

  it('only the Super Admin can start observing, and the start is in the organisation’s activity', async () => {
    await pmTenant.post(`/super-admin/organizations/${tenant.org.id}/observe`).expect(403);
    const r = await sa.post(`/super-admin/organizations/${tenant.org.id}/observe`).expect(200);
    expect(String(r.headers['set-cookie'])).toContain('projexa_observe=');
    observeToken = /projexa_observe=([^;]+)/.exec(String(r.headers['set-cookie']))![1];
    const log = await prisma.auditEvent.findFirst({ where: { organizationId: tenant.org.id, action: 'superadmin.observe' } });
    expect(log).toBeTruthy();
  });

  it('sees the organisation’s data, branding and every page', async () => {
    const o = asObserver();
    const me = (await o.get('/auth/me').expect(200)).body;
    expect(me.observing).toMatchObject({ organizationId: tenant.org.id, name: 'ob-tenant' });
    expect(me.organization.id).toBe(tenant.org.id);
    expect(me.features.web.monitor).toBe(true);
    const clients = (await o.get('/clients').expect(200)).body;
    expect(clients.map((c: { name: string }) => c.name)).toEqual(['Tenant client']);
    // Without the pass the Super Admin is back in their own organisation.
    expect((await sa.get('/clients').expect(200)).body).toEqual([]);
  });

  it('cannot change anything while observing', async () => {
    const o = asObserver();
    expect((await o.post('/clients', { name: 'Sneaky', code: 'SN1' }).expect(403)).body.code).toBe('OBSERVE_READ_ONLY');
    expect(await prisma.client.count({ where: { organizationId: tenant.org.id } })).toBe(1);
    const exit = (await o.post('/super-admin/observe/exit').expect(200)).body;
    expect(exit.home).toBe(`/super-admin/organizations/${tenant.org.id}`);
  });

  it('a pass from another person does not work', async () => {
    const r = api(app, await login(app, tenant.users.ADMIN.email));
    const me = (await r.get('/auth/me').set('X-Observe-Token', observeToken).expect(200)).body;
    expect(me.observing).toBeNull();
  });

  it('traffic shows clicks and the domain and name links run on', async () => {
    const t = (await sa.get(`/super-admin/organizations/${tenant.org.id}/traffic?days=7`).expect(200)).body;
    expect(t.runsAs).toMatchObject({ appName: 'Tenant Research', domain: 'research.tenant.example', domainVerified: true });
    expect(t.byDay.length).toBeGreaterThanOrEqual(7);
    expect(t.totals.clicks).toBe(0);
    await pmTenant.get(`/super-admin/organizations/${tenant.org.id}/traffic`).expect(403);
  });
});
