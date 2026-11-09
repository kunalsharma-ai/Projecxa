import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Mail, MailService } from '../../src/mail/mail.service';
import { FEATURE_KEYS, MOBILE_FEATURE_KEYS } from '../../src/super-admin/features';
import { alertLevel, crossingLine, LimitAlertsService } from '../../src/super-admin/limit-alerts';
import { LIMITS } from '../../src/super-admin/limits';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

/** Emails when usage nears (80%) or reaches a plan limit (docs/PLAN_LIMITS.md). */
describe('Plan limit emails (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenant: Awaited<ReturnType<typeof makeOrg>>;
  let owner: Awaited<ReturnType<typeof makeOrg>>;
  let sa: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let alerts: LimitAlertsService;
  const sent: Mail[] = [];
  const sub = (limits: object | null) =>
    sa.put(`/super-admin/organizations/${tenant.org.id}/subscription`, { planCode: 'small', status: 'ACTIVE', endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), limits }).expect(200);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    await prisma.automationRule.deleteMany();
    await prisma.plan.deleteMany();
    owner = await makeOrg(prisma, 'le-owner');
    tenant = await makeOrg(prisma, 'le-tenant');
    await prisma.organization.update({ where: { id: owner.org.id }, data: { platformOwner: true } });
    await prisma.user.update({ where: { id: owner.users.ADMIN.id }, data: { superAdmin: true } });
    app.get(MailService).transport = async (_from, m) => { sent.push(m); return { messageId: 'x' }; };
    alerts = app.get(LimitAlertsService);
    sa = api(app, await login(app, owner.users.ADMIN.email));
    pm = api(app, await login(app, tenant.users.PROJECT_MANAGER.email));
    await sa.get('/super-admin/plans').expect(200);
    await sa.post('/super-admin/plans', {
      code: 'small', name: 'Small', features: FEATURE_KEYS, mobileFeatures: MOBILE_FEATURE_KEYS, maxUsers: 10, maxProjects: null,
      limits: { clients: 5, vendors: 1, clicksPerMonth: 1000, portalUsers: 0 },
    }).expect(201);
    await sub(null);
  });
  afterAll(async () => {
    app.get(MailService).transport = null;
    await app.close();
  });

  it('works out the level and the wording', () => {
    expect(alertLevel(3, 5)).toBeNull();
    expect(alertLevel(4, 5)).toBe('near');
    expect(alertLevel(5, 5)).toBe('reached');
    expect(alertLevel(7, 5)).toBe('reached');
    expect(alertLevel(0, 0)).toBeNull();
    const clicks = LIMITS.find((l) => l.key === 'clicksPerMonth')!;
    expect(crossingLine({ def: clicks, level: 'near', used: 1640, max: 2000 }, 'stop')).toBe('Clicks a month: 1,640 of 2,000 this month (82%).');
    expect(crossingLine({ def: clicks, level: 'reached', used: 2000, max: 2000 }, 'stop')).toContain('quota full');
    expect(crossingLine({ def: clicks, level: 'reached', used: 2100, max: 2000 }, 'warn')).toContain('Entries keep going');
  });

  it('emails the admins once when a limit is close, and nothing under 80%', async () => {
    for (const c of ['A', 'B', 'C']) await pm.post('/clients', { name: `Client ${c}`, code: `C${c}` }).expect(201);
    sent.length = 0;
    expect(await alerts.check(tenant.org.id)).toEqual([]);
    expect(sent).toHaveLength(0);

    await pm.post('/clients', { name: 'Client D', code: 'CD' }).expect(201);
    const near = await alerts.check(tenant.org.id);
    expect(near.map((c) => [c.def.key, c.level])).toEqual([['clients', 'near']]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([tenant.users.ADMIN.email]);
    expect(sent[0].subject).toBe('le-tenant is close to its plan limit for clients');
    expect(sent[0].text).toContain('Clients: 4 of 5 (80%).');
    expect(sent[0].text).toContain('/settings/subscription');

    // Already told: no second email for the same limit.
    expect(await alerts.check(tenant.org.id)).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it('emails the admins and the Super Admins when a limit is reached', async () => {
    sent.length = 0;
    await pm.post('/vendors', { name: 'Panel One', code: 'P1' }).expect(201);
    const r = await alerts.check(tenant.org.id);
    expect(r.map((c) => [c.def.key, c.level])).toEqual([['vendors', 'reached']]);
    expect(sent.map((m) => m.to)).toEqual([[tenant.users.ADMIN.email], [owner.users.ADMIN.email]]);
    expect(sent[0].subject).toBe('le-tenant has reached its plan limit for vendors');
    expect(sent[0].text).toContain('Vendors: 1 of 1. Your plan allows 1 vendors.');
    expect(sent[1].subject).toBe('le-tenant reached its plan limit: vendors');
    expect(sent[1].text).toContain('Super Admin → Organisations → le-tenant → Subscription');

    // Reached first means no "close to it" email later.
    sent.length = 0;
    expect(await alerts.check(tenant.org.id)).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it('a raised limit can email again, and the Super Admin sees what was sent', async () => {
    await sub({ vendors: 2 });
    sent.length = 0;
    expect(await alerts.check(tenant.org.id)).toEqual([]);
    await pm.post('/vendors', { name: 'Panel Two', code: 'P2' }).expect(201);
    expect((await alerts.check(tenant.org.id)).map((c) => c.level)).toEqual(['reached']);
    expect(sent).toHaveLength(2);

    const detail = (await sa.get(`/super-admin/organizations/${tenant.org.id}`).expect(200)).body;
    expect(detail.limitAlerts.map((a: { limit: string; level: string; period: string }) => `${a.limit}:${a.level}:${a.period}`)).toEqual(['vendors:reached:max:2', 'vendors:reached:max:1', 'clients:near:max:5']);
    expect(detail.limitAlerts[0].sentTo).toBe('1 admin, 1 Super Admin');
  });

  it('checks every organisation, but not paused ones', async () => {
    await pm.post('/clients', { name: 'Client E', code: 'CE' }).expect(201);
    await prisma.organization.update({ where: { id: tenant.org.id }, data: { status: 'SUSPENDED' } });
    sent.length = 0;
    expect(await alerts.checkAll()).toMatchObject({ emailed: 0 });
    await prisma.organization.update({ where: { id: tenant.org.id }, data: { status: 'ACTIVE' } });
    expect(await alerts.checkAll()).toMatchObject({ emailed: 1 });
    expect(sent[0].subject).toBe('le-tenant has reached its plan limit for clients');
  });
});
