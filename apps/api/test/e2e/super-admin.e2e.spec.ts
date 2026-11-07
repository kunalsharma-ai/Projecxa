import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Mail, MailService } from '../../src/mail/mail.service';
import { AutomationService } from '../../src/super-admin/automation';
import { EntitlementsService } from '../../src/super-admin/entitlements';
import { featureForRoute, FEATURE_KEYS } from '../../src/super-admin/features';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

function solve(question: string) {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const m = /What is (\w+) (plus|minus) (\w+)\?/.exec(question)!;
  const a = words.indexOf(m[1]);
  const b = words.indexOf(m[3]);
  return String(m[2] === 'plus' ? a + b : a - b);
}

describe('Super Admin: subscriptions, feature switches, activity, automation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let owner: Awaited<ReturnType<typeof makeOrg>>;
  let tenant: Awaited<ReturnType<typeof makeOrg>>;
  let sa: ReturnType<typeof api>;
  let tenantAdmin: ReturnType<typeof api>;
  let tenantPm: ReturnType<typeof api>;
  const sent: Mail[] = [];
  const http = () => request(app.getHttpServer());
  const realNow = Date.now;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    await prisma.automationRule.deleteMany();
    await prisma.plan.deleteMany();
    owner = await makeOrg(prisma, 'sa-owner');
    tenant = await makeOrg(prisma, 'sa-tenant');
    await prisma.organization.update({ where: { id: owner.org.id }, data: { platformOwner: true } });
    await prisma.user.update({ where: { id: owner.users.ADMIN.id }, data: { superAdmin: true } });
    app.get(MailService).transport = async (_from, m) => { sent.push(m); return { messageId: 'x' }; };
    sa = api(app, await login(app, owner.users.ADMIN.email));
    tenantAdmin = api(app, await login(app, tenant.users.ADMIN.email));
    tenantPm = api(app, await login(app, tenant.users.PROJECT_MANAGER.email));
  });
  afterAll(async () => {
    Date.now = realNow;
    await app.close();
  });

  it('maps every signed-in API route to a feature or marks it ungated', () => {
    const router = (app.getHttpAdapter().getInstance() as { router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] } }).router;
    const routes = router.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route!.methods).map((m) => [m.toUpperCase(), l.route!.path] as const));
    expect(routes.length).toBeGreaterThan(100);
    // Public routes are never gated (respondent links, sign-up forms, the public API has its own check).
    const PUBLIC = /^(\/api\/v1)?\/(public|s|r|g|u|end|pa|brand|s2s|integrations\/bidzo\/events|auth)(\/|$)/;
    const unmapped = routes.filter(([m, p]) => !PUBLIC.test(p) && featureForRoute(m, p) === undefined);
    expect(unmapped).toEqual([]);
    expect(featureForRoute('POST', '/api/v1/projects')).toBe('projects.create');
    expect(featureForRoute('GET', '/api/v1/projects')).toBe('projects');
    expect(featureForRoute('GET', '/api/v1/portal/requests', 'VENDOR_USER')).toBe('portal.vendor');
  });

  it('organisations without a subscription keep every feature; the contract the apps read', async () => {
    const r = await tenantPm.get('/auth/me/features').expect(200);
    expect(r.body).toMatchObject({ plan: null, block: null, mobile: { enabled: true } });
    expect(typeof r.body.version).toBe('string');
    expect(r.headers['x-features-version']).toBe(r.body.version);
    expect(r.body.web.projects).toBe(true);
    expect(r.body.web.team).toBe(false); // role: admins only
    expect(r.body.mobile.features.reports).toBe(true);
    expect(r.body.mobile.features.accounting).toBeUndefined(); // not in the app
    await tenantPm.get('/monitor').expect(200);
    const me = await tenantPm.get('/auth/me').expect(200);
    expect(me.body.features.version).toBe(r.body.version);
  });

  it('only the Super Admin reaches the console', async () => {
    await tenantAdmin.get('/super-admin/overview').expect(403);
    await tenantPm.get('/super-admin/overview').expect(403);
    // An admin of the owner organisation who is not a Super Admin cannot either.
    const other = await prisma.user.create({ data: { organizationId: owner.org.id, email: 'admin2@sa-owner.test', name: 'Admin 2', role: 'ADMIN', passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: owner.users.ADMIN.id } })).passwordHash } });
    await api(app, await login(app, other.email)).get('/super-admin/overview').expect(403);
    // The flag means nothing outside the owner organisation.
    await prisma.user.update({ where: { id: tenant.users.ADMIN.id }, data: { superAdmin: true } });
    await tenantAdmin.get('/super-admin/overview').expect(403);
    expect((await tenantAdmin.get('/auth/me/features').expect(200)).body.superAdmin).toBe(false);
    await prisma.user.update({ where: { id: tenant.users.ADMIN.id }, data: { superAdmin: false } });
    const o = await sa.get('/super-admin/overview').expect(200);
    expect(o.body.counts.organizations).toBe(2);
  });

  it('a plan limits features at once on the web and in the app', async () => {
    const plans = await sa.get('/super-admin/plans').expect(200);
    expect(plans.body.map((p: { code: string }) => p.code)).toEqual(['starter', 'professional', 'enterprise']);
    const before = (await tenantPm.get('/auth/me/features')).body.version;
    await sa.put(`/super-admin/organizations/${tenant.org.id}/subscription`, { planCode: 'starter', status: 'ACTIVE', endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }).expect(200);

    const r = await tenantPm.get('/projects').expect(200);
    expect(r.headers['x-features-version']).not.toBe(before);
    const f = (await tenantPm.get('/auth/me/features')).body;
    expect(f.plan).toBe('Starter');
    expect(f.web.monitor).toBe(false);
    const denied = await tenantPm.get('/monitor').expect(403);
    expect(denied.body).toMatchObject({ code: 'FEATURE_DISABLED', feature: 'monitor' });

    // Super Admin turns monitor on for this organisation on the web only.
    await sa.put(`/super-admin/organizations/${tenant.org.id}/features`, { changes: [{ feature: 'monitor', channel: 'web', state: 'on' }] }).expect(200);
    await tenantPm.get('/monitor').expect(200);
    const mobile = await tenantPm.get('/monitor').set('X-Client', 'mobile').expect(403);
    expect(mobile.body.code).toBe('FEATURE_DISABLED');
    await sa.put(`/super-admin/organizations/${tenant.org.id}/features`, { changes: [{ feature: 'monitor', channel: 'mobile', state: 'on' }] }).expect(200);
    await tenantPm.get('/monitor').set('X-Client', 'mobile').expect(200);

    // Reports is in the plan; turning it off for the org stops it everywhere.
    await tenantPm.get('/reports/overall').expect((res) => expect(res.status).not.toBe(403));
    await sa.put(`/super-admin/organizations/${tenant.org.id}/features`, { changes: [{ feature: 'reports', channel: 'web', state: 'off' }] }).expect(200);
    expect((await tenantPm.get('/reports/overall').expect(403)).body.feature).toBe('reports');
    const detail = await sa.get(`/super-admin/organizations/${tenant.org.id}`).expect(200);
    const rep = detail.body.features.find((x: { key: string }) => x.key === 'reports');
    expect(rep.web).toEqual({ plan: true, override: false, effective: false });
    await sa.put(`/super-admin/organizations/${tenant.org.id}/features`, { changes: [{ feature: 'reports', channel: 'web', state: 'plan' }] }).expect(200);
    await tenantPm.get('/reports/overall').expect((res) => expect(res.status).not.toBe(403));
  });

  it('switches for one person, and mobile access per person', async () => {
    await sa.patch(`/super-admin/users/${tenant.users.PROJECT_MANAGER.id}`, { featuresOff: ['clients'] }).expect(200);
    await tenantPm.get('/clients').expect(403);
    await tenantAdmin.get('/clients').expect(200);
    await sa.patch(`/super-admin/users/${tenant.users.PROJECT_MANAGER.id}`, { featuresOff: [], mobileAccess: false }).expect(200);
    await tenantPm.get('/clients').expect(200);
    expect((await tenantPm.get('/clients').set('X-Client', 'mobile').expect(403)).body.code).toBe('MOBILE_DISABLED');
    // The features endpoint still answers so the app can explain.
    const f = (await tenantPm.get('/auth/me/features').set('X-Client', 'mobile').expect(200)).body;
    expect(f.mobile.enabled).toBe(false);
    expect(Object.values(f.mobile.features).every((v) => v === false)).toBe(true);
    await sa.patch(`/super-admin/users/${tenant.users.PROJECT_MANAGER.id}`, { mobileAccess: true }).expect(200);
    const users = await sa.get(`/super-admin/organizations/${tenant.org.id}/users`).expect(200);
    expect(users.body.find((u: { id: string }) => u.id === tenant.users.PROJECT_MANAGER.id)).toMatchObject({ mobileAccess: true, featuresOff: [] });
  });

  it('plan limits: users and projects', async () => {
    await sa.put(`/super-admin/organizations/${tenant.org.id}/subscription`, { planCode: 'starter', status: 'ACTIVE', maxUsers: 3, maxProjects: 0 }).expect(200);
    const r = await tenantAdmin.post('/team', { email: 'new@sa-tenant.test', name: 'New', role: 'VIEWER' }).expect(403);
    expect(r.body).toMatchObject({ code: 'PLAN_LIMIT', limit: 'users' });
    await expect(app.get(EntitlementsService).assertProjectRoom(tenant.org.id)).rejects.toMatchObject({ response: { code: 'PLAN_LIMIT', limit: 'projects' } });
    await sa.put(`/super-admin/organizations/${tenant.org.id}/subscription`, { planCode: 'starter', status: 'ACTIVE' }).expect(200);
    await tenantAdmin.post('/team', { email: 'new@sa-tenant.test', name: 'New', role: 'VIEWER' }).expect(201);
  });

  it('integrations can be taken away from an organisation', async () => {
    // Starter has email but not Zoho Books.
    const list = await tenantAdmin.get('/integrations/settings').expect(200);
    const zb = list.body.integrations.find((i: { kind: string }) => i.kind === 'zoho_books');
    expect(zb).toMatchObject({ allowed: false, editable: false });
    expect(list.body.integrations.find((i: { kind: string }) => i.kind === 'smtp').allowed).toBe(true);
    await tenantAdmin.put('/integrations/settings/bidzo', { values: { BIDZO_URL: 'https://bidzo.example.com' } }).expect(403);
    const m = await sa.get('/super-admin/integrations').expect(200);
    const row = m.body.organizations.find((o: { id: string }) => o.id === tenant.org.id);
    expect(row.integrations.bidzo.allowed).toBe(false);
    expect(row.integrations.smtp.allowed).toBe(true);
    await sa.put(`/super-admin/organizations/${tenant.org.id}/features`, { changes: [{ feature: 'integration.bidzo', channel: 'web', state: 'on' }] }).expect(200);
    await tenantAdmin.put('/integrations/settings/bidzo', { values: { BIDZO_URL: 'https://bidzo.example.com' } }).expect(200);
    await sa.delete(`/super-admin/organizations/${tenant.org.id}/integrations/bidzo`).expect(200);
  });

  it('an ended subscription stops the app but not the account screens; suspension stops sign-in', async () => {
    await sa.put(`/super-admin/organizations/${tenant.org.id}/subscription`, { planCode: 'starter', status: 'ACTIVE', endsAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
    expect((await tenantPm.get('/projects').expect(403)).body.code).toBe('SUBSCRIPTION_INACTIVE');
    const f = (await tenantPm.get('/auth/me/features').expect(200)).body;
    expect(f.block).toBe('SUBSCRIPTION_INACTIVE');
    expect(f.web.projects).toBe(false);
    await sa.put(`/super-admin/organizations/${tenant.org.id}/subscription`, { planCode: 'starter', status: 'PAST_DUE', endsAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
    await tenantPm.get('/projects').expect(200);

    await sa.patch(`/super-admin/organizations/${tenant.org.id}`, { status: 'SUSPENDED' }).expect(200);
    await tenantPm.get('/projects').expect(401); // signed out
    await http().post('/api/v1/auth/login').send({ email: tenant.users.PROJECT_MANAGER.email, password: 'correct-horse-battery' }).expect(401);
    await sa.patch(`/super-admin/organizations/${owner.org.id}`, { status: 'SUSPENDED' }).expect(403);
    await sa.patch(`/super-admin/organizations/${tenant.org.id}`, { status: 'ACTIVE' }).expect(200);
    tenantPm = api(app, await login(app, tenant.users.PROJECT_MANAGER.email));
    tenantAdmin = api(app, await login(app, tenant.users.ADMIN.email));
    await tenantPm.get('/projects').expect(200);
  });

  it('activity shows what admins, users and the Super Admin did, across organisations', async () => {
    const all = await sa.get('/super-admin/activity?limit=200').expect(200);
    const actions = all.body.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['superadmin.subscription', 'superadmin.features', 'superadmin.org_suspend', 'user.invite']));
    const t = await sa.get(`/super-admin/activity?organizationId=${tenant.org.id}&action=user.`).expect(200);
    expect(t.body.items.every((i: { organization: { id: string }; action: string }) => i.organization.id === tenant.org.id && i.action.startsWith('user.'))).toBe(true);
    expect(t.body.items[0].actor).toMatchObject({ name: 'ADMIN' });
    const orgs = await sa.get('/super-admin/organizations').expect(200);
    expect(orgs.body.find((o: { id: string }) => o.id === tenant.org.id)).toMatchObject({ status: 'ACTIVE', subscription: { plan: { code: 'starter' } } });
    expect(orgs.body.find((o: { id: string }) => o.id === tenant.org.id).lastActiveAt).not.toBeNull();
  });

  it('registration, approval and automation recipes', async () => {
    expect((await http().get('/api/v1/public/register').expect(200)).body).toEqual({ open: false });
    await sa.put('/super-admin/settings', { registrationOpen: true, defaultPlanCode: 'starter', trialDays: 14 }).expect(200);
    await sa.post('/super-admin/automations/recipes/notify-registration').expect(201);

    const form = await http().get('/api/v1/public/register').expect(200);
    expect(form.body.plans.length).toBe(3);
    const body = { companyName: 'Field Co', contactName: 'Asha', email: 'asha@fieldco.test', plan: 'professional', challenge: form.body.challenge.token, answer: solve(form.body.challenge.question) };
    await http().post('/api/v1/public/register').send(body).expect(400); // too fast
    Date.now = () => realNow() + 10_000;
    await http().post('/api/v1/public/register').send(body).expect(200);
    Date.now = realNow;
    const pending = await prisma.organization.findFirstOrThrow({ where: { name: 'Field Co' }, include: { users: true } });
    expect(pending.status).toBe('PENDING');
    expect(pending.users[0]).toMatchObject({ email: 'asha@fieldco.test', active: false, role: 'ADMIN' });
    expect(sent.some((m) => m.subject === 'New registration: Field Co' && m.to.includes(owner.users.ADMIN.email))).toBe(true);
    expect(await prisma.task.count({ where: { organizationId: owner.org.id, title: 'Review the registration of Field Co' } })).toBe(1);

    const ok = await sa.post(`/super-admin/organizations/${pending.id}/approve`, {}).expect(200);
    expect(ok.body.invite.inviteUrl).toMatch(/set-password\?token=/);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: pending.id }, include: { plan: true } });
    expect(sub).toMatchObject({ status: 'TRIAL', plan: { code: 'professional' } });
    expect(sent.some((m) => m.to.includes('asha@fieldco.test'))).toBe(true);

    // Auto-approve recipe: the next registration starts at once.
    await sa.post('/super-admin/automations/recipes/auto-approve').expect(201);
    const f2 = await http().get('/api/v1/public/register').expect(200);
    Date.now = () => realNow() + 10_000;
    await http().post('/api/v1/public/register').send({ companyName: 'Quick Co', contactName: 'Ravi', email: 'ravi@quick.test', challenge: f2.body.challenge.token, answer: solve(f2.body.challenge.question) }).expect(200);
    Date.now = realNow;
    const quick = await prisma.organization.findFirstOrThrow({ where: { name: 'Quick Co' }, include: { subscription: { include: { plan: true } } } });
    expect(quick.status).toBe('ACTIVE');
    expect(quick.subscription).toMatchObject({ status: 'TRIAL', plan: { code: 'starter' } });
  });

  it('time rules act once per organisation and occasion', async () => {
    const quick = await prisma.organization.findFirstOrThrow({ where: { name: 'Quick Co' } });
    await prisma.subscription.update({ where: { organizationId: quick.id }, data: { trialEndsAt: new Date(Date.now() + 2 * 86_400_000) } });
    const rule = (await sa.post('/super-admin/automations/recipes/trial-ending').expect(201)).body;
    const preview = await sa.post('/super-admin/automations/preview', { name: 'x', trigger: 'trial.ending', triggerConfig: { days: 3 }, actions: [{ type: 'create_task', title: 'x' }] }).expect(200);
    expect(preview.body.organizations.map((o: { name: string }) => o.name)).toContain('Quick Co');
    sent.length = 0;
    await sa.post('/super-admin/automations/run').expect(200);
    await app.get(AutomationService).runAll();
    const mails = sent.filter((m) => m.to.includes('ravi@quick.test') && /trial ends/.test(m.subject));
    expect(mails.length).toBe(1);
    const runs = await sa.get(`/super-admin/automations/runs?ruleId=${rule.id}`).expect(200);
    expect(runs.body.filter((r: { organization: { name: string } }) => r.organization?.name === 'Quick Co')).toHaveLength(1);
    expect(runs.body[0].status).toBe('ok');

    // Ended + grace recipes: past due, then expired.
    await prisma.subscription.update({ where: { organizationId: quick.id }, data: { status: 'ACTIVE', trialEndsAt: null, endsAt: new Date(Date.now() - 3_600_000) } });
    await sa.post('/super-admin/automations/recipes/grace').expect(201);
    await sa.post('/super-admin/automations/recipes/expire').expect(201);
    await sa.post('/super-admin/automations/run').expect(200);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: quick.id } })).status).toBe('PAST_DUE');
    await app.get(AutomationService).runAll(new Date(Date.now() + 8 * 86_400_000));
    expect((await prisma.subscription.findUniqueOrThrow({ where: { organizationId: quick.id } })).status).toBe('EXPIRED');

    // Rules are validated.
    await sa.post('/super-admin/automations', { name: 'bad', trigger: 'trial.ending', actions: [{ type: 'approve_registration' }] }).expect(400);
    await sa.post('/super-admin/automations', { name: 'bad', trigger: 'trial.ending', actions: [{ type: 'change_plan', planCode: 'nope' }] }).expect(400);
    await sa.post('/super-admin/automations', { name: 'bad', trigger: 'trial.ending', actions: [{ type: 'set_feature', feature: 'accounting', channel: 'mobile', state: 'on' }] }).expect(400);
  });

  it('plans: create, edit, cannot delete one in use', async () => {
    const p = await sa.post('/super-admin/plans', { code: 'field-only', name: 'Field only', features: ['projects', 'monitor'], mobileFeatures: ['projects', 'accounting'] }).expect(201);
    expect(p.body.mobileFeatures).toEqual(['projects']);
    await sa.post('/super-admin/plans', { code: 'x', name: 'X', features: ['nope'], mobileFeatures: [] }).expect(400);
    await sa.put(`/super-admin/organizations/${tenant.org.id}/subscription`, { planCode: 'field-only', status: 'ACTIVE' }).expect(200);
    expect((await tenantPm.get('/auth/me/features')).body.web.clients).toBe(false);
    await sa.patch(`/super-admin/plans/${p.body.id}`, { features: ['projects', 'monitor', 'clients'] }).expect(200);
    expect((await tenantPm.get('/auth/me/features')).body.web.clients).toBe(true);
    await sa.delete(`/super-admin/plans/${p.body.id}`).expect(400);
    const created = await sa.post('/super-admin/organizations', { name: 'Direct Co', adminName: 'Mo', adminEmail: 'mo@direct.test', planCode: 'enterprise' }).expect(201);
    expect(created.body.invite.inviteUrl).toMatch(/set-password/);
    const d = await sa.get(`/super-admin/organizations/${created.body.id}`).expect(200);
    expect(d.body.features.filter((f: { web: { effective: boolean } }) => f.web.effective)).toHaveLength(FEATURE_KEYS.length);
  });
});
