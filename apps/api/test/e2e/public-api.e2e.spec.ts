import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { hmacSha256 } from '../../src/common/crypto';
import { ApiKeyGuard, RateLimiter } from '../../src/public-api/api-key.guard';
import { WebhooksService } from '../../src/webhooks/webhooks.service';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Public API keys and event webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let hooks: WebhooksService;
  let projectId: string;
  let projectCode: string;
  let entryCode: string;
  let linkId: string;
  let n = 0;
  const http = () => request(app.getHttpServer());
  const pub = (key: string) => ({
    get: (p: string) => http().get(`/api/v1/public${p}`).set('Authorization', `Bearer ${key}`),
    patch: (p: string, body: object) => http().patch(`/api/v1/public${p}`).set('X-API-Key', key).send(body),
  });
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  let reply = 200;

  async function complete() {
    const res = await http().get(`/s/${entryCode}?uid=P${++n}`).set('X-Forwarded-For', `203.0.113.${n % 250}`).expect(302);
    const token = new URL(res.headers.location).searchParams.get('rid')!;
    await http().get(`/r/complete?token=${token}`).expect(302);
  }
  const newKey = async (scopes: string[], extra: object = {}) => (await admin.post('/api-keys', { name: `Key ${scopes.join(' ')}`, scopes, ...extra }).expect(201)).body;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'pub');
    const b = await makeOrg(prisma, 'pub-other');
    admin = api(app, await login(app, a.users.ADMIN.email));
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    other = api(app, await login(app, b.users.ADMIN.email));
    hooks = app.get(WebhooksService);
    hooks.fetcher = async (url, init) => {
      sent.push({ url, headers: init.headers, body: init.body });
      return { status: reply };
    };
    const clientId = (await pm.post('/clients', { name: 'Acme', code: 'ACME' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Panel A', code: 'PA' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'API study',
          category: 'B2B',
          clientId,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 10, targetCompletes: 50, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    projectId = p.id;
    projectCode = p.projectCode;
    await pm.post(`/projects/${projectId}/countries/${p.countries[0].id}/allocations`, { vendorId, cpi: 4, targetCompletes: 50 }).expect(201);
    await pm.patch(`/projects/${projectId}/countries/${p.countries[0].id}`, { status: 'LIVE' }).expect(200);
    const al = (await pm.get(`/projects/${projectId}`).expect(200)).body.countries[0].allocations[0];
    entryCode = al.entryCode;
    linkId = al.id;
    // Something in the other organization that a key must never see.
    const oc = (await other.post('/clients', { name: 'Other', code: 'OTH' }).expect(201)).body.id;
    await other.post('/projects', { name: 'Hidden', category: 'B2C', clientId: oc, defaults: { language: 'en', loiMinutes: 5, irPercent: 50, cpi: 1, targetCompletes: 10 }, countries: [{ countryCode: 'GB' }] }).expect(201);
  });

  beforeEach(() => ApiKeyGuard.limiter.reset());
  afterAll(async () => {
    await app.close();
  });

  it('only admins manage keys; the key is shown once and stored hashed', async () => {
    await pm.get('/api-keys').expect(403);
    await pm.post('/api-keys', { name: 'x', scopes: ['projects:read'] }).expect(403);
    await admin.post('/api-keys', { name: 'x', scopes: [] }).expect(400);
    await admin.post('/api-keys', { name: 'x', scopes: ['everything'] }).expect(400);
    const k = await newKey(['projects:read'], { expiresInDays: 30 });
    expect(k.key).toMatch(/^pjx_[A-Za-z0-9_-]{32}$/);
    expect(k.key.startsWith(k.prefix)).toBe(true);
    const list = (await admin.get('/api-keys').expect(200)).body;
    expect(list.scopes.map((s: { name: string }) => s.name)).toContain('finance:read');
    const row = list.keys.find((x: { id: string }) => x.id === k.id);
    expect(row).toMatchObject({ state: 'active', prefix: k.prefix });
    expect(JSON.stringify(list)).not.toContain(k.key);
    const db = await prisma.apiKey.findUniqueOrThrow({ where: { id: k.id } });
    expect(db.keyHash).not.toContain(k.key);
    expect((await other.get('/api-keys').expect(200)).body.keys).toHaveLength(0);
    await other.delete(`/api-keys/${k.id}`).expect(404);
  });

  it('authenticates with Bearer or X-API-Key and stays inside the organization', async () => {
    await http().get('/api/v1/public/projects').expect(401);
    await http().get('/api/v1/public/projects').set('Authorization', 'Bearer pjx_notarealkeynotarealkeynotareal').expect(401);
    // A staff session token is not an API key.
    const staff = await login(app, 'admin@pub.test');
    await http().get('/api/v1/public/projects').set('Authorization', `Bearer ${staff}`).expect(401);
    const { key } = await newKey(['projects:read']);
    const me = (await pub(key).get('/me').expect(200)).body;
    expect(me.organization.slug).toBe('pub');
    const list = (await pub(key).get('/projects').expect(200)).body;
    expect(list.data.map((p: { projectCode: string }) => p.projectCode)).toEqual([projectCode]);
    expect(list.data[0]).toMatchObject({ targetCompletes: 50, completes: 0, markets: [{ countryCode: 'US', status: 'LIVE' }] });
    const detail = (await http().get(`/api/v1/public/projects/${projectCode.toLowerCase()}`).set('X-API-Key', key).expect(200)).body;
    expect(detail.markets[0].vendorLinks[0]).toMatchObject({ id: linkId, status: 'ACTIVE', cpi: 4, vendor: { code: 'PA' } });
    expect(JSON.stringify(detail)).not.toContain(entryCode);
    const hidden = await prisma.project.findFirstOrThrow({ where: { name: 'Hidden' } });
    await pub(key).get(`/projects/${hidden.id}`).expect(404);
    // Codes are per organization: the same code finds this organization's own project.
    expect((await pub(key).get(`/projects/${hidden.projectCode}`).expect(200)).body.id).toBe(projectId);
  });

  it('enforces permissions, revocation and expiry', async () => {
    const { key, id } = await newKey(['projects:read']);
    await pub(key).get(`/projects/${projectCode}/sessions`).expect(403);
    await pub(key).get('/invoices').expect(403);
    await pub(key).patch(`/projects/${projectCode}`, { status: 'HOLD' }).expect(403);
    await pm.delete(`/api-keys/${id}`).expect(403);
    expect((await admin.delete(`/api-keys/${id}`).expect(200)).body.state).toBe('revoked');
    await pub(key).get('/me').expect(401);
    const exp = await newKey(['projects:read']);
    await prisma.apiKey.update({ where: { id: exp.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await pub(exp.key).get('/me').expect(401);
    expect(r.body.message).toMatch(/expired/);
    expect((await admin.get('/api-keys').expect(200)).body.keys.find((x: { id: string }) => x.id === exp.id).state).toBe('expired');
  });

  it('rate limits each key', async () => {
    const { key } = await newKey(['projects:read']);
    ApiKeyGuard.limiter = new RateLimiter(3);
    try {
      for (let i = 0; i < 3; i++) await pub(key).get('/me').expect(200);
      const r = await pub(key).get('/me').expect(429);
      expect(r.headers['retry-after']).toBeDefined();
      expect(r.headers['x-ratelimit-remaining']).toBe('0');
    } finally {
      ApiKeyGuard.limiter = new RateLimiter();
    }
  });

  it('writes act as the key creator and are validated like the app', async () => {
    const { key } = await newKey(['projects:read', 'projects:write']);
    await pub(key).patch(`/projects/${projectCode}`, { name: 'Renamed' }).expect(400);
    await pub(key).patch(`/projects/${projectCode}/markets/US/vendor-links/${linkId}`, { status: 'PAUSED' }).expect(200);
    expect((await prisma.vendorAllocation.findUniqueOrThrow({ where: { id: linkId } })).status).toBe('PAUSED');
    await pub(key).patch(`/projects/${projectCode}/markets/US/vendor-links/${linkId}`, { status: 'ACTIVE' }).expect(200);
    await pub(key).patch(`/projects/${projectCode}/markets/FR`, { targetCompletes: 10 }).expect(404);
    const out = (await pub(key).patch(`/projects/${projectCode}`, { status: 'LIVE', fieldEndAt: '2026-12-31' }).expect(200)).body;
    expect(out.status).toBe('LIVE');
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: projectId, action: 'project.update' }, orderBy: { createdAt: 'desc' } });
    expect(audit.actorId).toBe((await prisma.user.findFirstOrThrow({ where: { email: 'admin@pub.test' } })).id);
    // A key stops writing once its creator is no longer an admin or project manager.
    const adminUser = await prisma.user.findFirstOrThrow({ where: { email: 'admin@pub.test' } });
    await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'VIEWER' } });
    try {
      await pub(key).patch(`/projects/${projectCode}`, { status: 'HOLD' }).expect(403);
      await pub(key).get(`/projects/${projectCode}`).expect(200);
    } finally {
      await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'ADMIN' } });
    }
  });

  it('serves the OpenAPI description without a key', async () => {
    const spec = (await http().get('/api/v1/public/openapi.json').expect(200)).body;
    expect(spec.openapi).toBe('3.0.3');
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/projects', '/projects/{ref}/sessions', '/bills']));
  });

  it('queues signed webhooks for subscribed events and retries failures', async () => {
    await pm.post('/webhooks', { url: 'https://hooks.example.com/a', events: ['session.completed'] }).expect(403);
    await admin.post('/webhooks', { url: 'ftp://x', events: ['session.completed'] }).expect(400);
    await admin.post('/webhooks', { url: 'https://hooks.example.com/a', events: ['nope'] }).expect(400);
    const ep = (await admin.post('/webhooks', { url: 'https://hooks.example.com/a', description: 'Ops', events: ['session.completed', 'project.status_changed'] }).expect(201)).body;
    expect(ep.secret).toMatch(/^whsec_/);
    const off = (await admin.post('/webhooks', { url: 'https://hooks.example.com/off', events: ['session.completed'] }).expect(201)).body;
    await admin.patch(`/webhooks/${off.id}`, { active: false }).expect(200);
    await admin.post('/webhooks', { url: 'https://hooks.example.com/alerts', events: ['alert.opened'] }).expect(201);
    expect((await admin.get('/webhooks').expect(200)).body.endpoints.find((e: { id: string }) => e.id === ep.id).secret).toBeUndefined();

    await complete();
    await pm.patch(`/projects/${projectId}`, { status: 'HOLD' }).expect(200);
    const queued = await prisma.webhookDelivery.findMany({ orderBy: { createdAt: 'asc' } });
    expect(queued.map((d) => [d.endpointId, d.event])).toEqual([[ep.id, 'session.completed'], [ep.id, 'project.status_changed']]);

    sent.length = 0;
    reply = 200;
    expect(await hooks.processDue()).toBe(2);
    expect(sent).toHaveLength(2);
    const first = sent[0];
    const body = JSON.parse(first.body);
    expect(body).toMatchObject({ event: 'session.completed', data: { project: { projectCode }, market: { countryCode: 'US' }, vendor: { code: 'PA' } } });
    expect(first.headers['X-Projexa-Event']).toBe('session.completed');
    const ts = first.headers['X-Projexa-Timestamp'];
    expect(first.headers['X-Projexa-Signature']).toBe(`sha256=${hmacSha256(ep.secret, `${ts}.${first.body}`)}`);
    expect(JSON.parse(sent[1].body).data).toMatchObject({ from: 'LIVE', to: 'HOLD' });

    // A 503 is retried later; a 410 is permanent and can be replayed by hand.
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);
    reply = 503;
    await hooks.processDue();
    let d = await prisma.webhookDelivery.findFirstOrThrow({ where: { event: 'project.status_changed' }, orderBy: { createdAt: 'desc' } });
    expect(d).toMatchObject({ state: 'RETRY_SCHEDULED', attempts: 1, lastStatusCode: 503 });
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { nextAttemptAt: new Date() } });
    reply = 410;
    await hooks.processDue();
    d = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(d).toMatchObject({ state: 'FAILED', attempts: 2 });
    const failed = (await admin.get(`/webhooks/${ep.id}/deliveries?state=failed`).expect(200)).body;
    expect(failed.map((x: { id: string }) => x.id)).toEqual([d.id]);
    await admin.post(`/webhooks/deliveries/${d.id}/replay`).expect(201);
    reply = 200;
    await hooks.processDue();
    d = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(d.state).toBe('DELIVERED');
    await admin.post(`/webhooks/deliveries/${d.id}/replay`).expect(400);
    const all = (await admin.get('/webhooks').expect(200)).body.endpoints.find((e: { id: string }) => e.id === ep.id);
    expect(all.last7d).toEqual({ delivered: 3, pending: 0, failed: 0 });
  });

  it('test pings, rotates secrets and keeps endpoints per organization', async () => {
    const ep = (await admin.get('/webhooks').expect(200)).body.endpoints[0];
    sent.length = 0;
    reply = 204;
    expect((await admin.post(`/webhooks/${ep.id}/test`).expect(201)).body).toEqual({ status: 204 });
    expect(JSON.parse(sent[0].body).event).toBe('ping');
    const { secret } = (await admin.post(`/webhooks/${ep.id}/rotate-secret`).expect(201)).body;
    expect(secret).toMatch(/^whsec_/);
    await other.patch(`/webhooks/${ep.id}`, { active: false }).expect(404);
    await other.get(`/webhooks/${ep.id}/deliveries`).expect(404);
    expect((await other.get('/webhooks').expect(200)).body.endpoints).toHaveLength(0);
  });

  it('lists sessions, quotas, invoices and bills with paging', async () => {
    await complete();
    await complete();
    const { key } = await newKey(['projects:read', 'sessions:read', 'quotas:read', 'finance:read']);
    const p1 = (await pub(key).get(`/projects/${projectCode}/sessions?limit=2`).expect(200)).body;
    expect(p1.data).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await pub(key).get(`/projects/${projectCode}/sessions?limit=2&cursor=${p1.nextCursor}`).expect(200)).body;
    expect(p2.data).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect(p1.data[0]).toMatchObject({ status: 'COMPLETE', countryCode: 'US', vendor: { code: 'PA' }, revenue: 10, payout: 4 });
    await pub(key).get(`/projects/${projectCode}/sessions?outcomeSince=yesterday`).expect(400);
    expect((await pub(key).get(`/projects/${projectCode}/sessions?status=TERMINATE`).expect(200)).body.data).toHaveLength(0);
    expect((await pub(key).get(`/projects/${projectCode}/quotas`).expect(200)).body.markets[0]).toMatchObject({ countryCode: 'US', completes: 3 });
    expect((await pub(key).get('/invoices').expect(200)).body).toEqual({ data: [], nextCursor: null });
    expect((await pub(key).get('/bills').expect(200)).body).toEqual({ data: [], nextCursor: null });
  });
});
