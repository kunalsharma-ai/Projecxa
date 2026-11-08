import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHmac } from 'crypto';
import request from 'supertest';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Won bids from SampBidx (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let otherPm: ReturnType<typeof api>;
  let secret: string;
  let clientId: string;

  const event = (over: Record<string, unknown> = {}, bidOver: Record<string, unknown> = {}) => ({
    event: 'bid.won',
    eventId: 'evt-1',
    occurredAt: '2026-10-30T10:00:00Z',
    ...over,
    bid: {
      id: 'bidzo-uuid-1',
      bidNumber: 'BZ-2026-0042',
      version: 3,
      projectName: 'Cloud buyers tracker',
      projectDescription: 'Quarterly B2B tracker',
      projectCategory: 'b2b',
      currency: 'USD',
      totalAmount: 18250,
      client: { id: 'bidzo-client-9', name: 'acme research' },
      contact: { name: 'Sam Contact', email: 'sam@client.example.com' },
      biddingPerson: { name: 'Bid Owner' },
      countries: [
        { countryCode: 'US', sampleSize: 400, loiMinutes: 12.5, incidencePct: 35, cpi: 22.5 },
        { countryCode: 'DE', sampleSize: 250, loiMinutes: 15, incidencePct: 20.4, cpi: 31 },
      ],
      ...bidOver,
    },
  });
  const send = (body: unknown, opts: { tenant?: string; key?: string; ts?: number; sig?: string; legacy?: boolean } = {}) => {
    const raw = JSON.stringify(body);
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const sig = opts.sig ?? `sha256=${createHmac('sha256', opts.key ?? secret).update(`${ts}.${raw}`).digest('hex')}`;
    return request(app.getHttpServer())
      // legacy: the path and headers from when SampBidx was called Bidzo.
      .post(opts.legacy ? '/api/v1/integrations/bidzo/events' : '/api/v1/integrations/sampbidx/events')
      .set('Content-Type', 'application/json')
      .set(opts.legacy ? 'X-Bidzo-Tenant' : 'X-SampBidx-Tenant', opts.tenant ?? 'won-a')
      .set(opts.legacy ? 'X-Bidzo-Timestamp' : 'X-SampBidx-Timestamp', ts)
      .set(opts.legacy ? 'X-Bidzo-Signature' : 'X-SampBidx-Signature', sig)
      .send(raw);
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'won-a');
    const b = await makeOrg(prisma, 'won-b');
    admin = api(app, await login(app, a.users.ADMIN.email));
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    otherPm = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    clientId = (await pm.post('/clients', { name: 'Acme Research', code: 'ACME' }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('is disabled until an admin creates the signing secret', async () => {
    secret = 'not-set';
    await send(event()).expect(401);
    expect((await pm.get('/integrations/sampbidx').expect(200)).body).toMatchObject({ enabled: false, tenant: 'won-a' });
    await pm.post('/integrations/sampbidx/secret').expect(403);
    const r = (await admin.post('/integrations/sampbidx/secret').expect(200)).body;
    expect(r.enabled).toBe(true);
    expect(r.secret).toMatch(/^sbx_/);
    expect(r.endpoint).toMatch(/\/api\/v1\/integrations\/sampbidx\/events$/);
    secret = r.secret;
    // The secret is never shown again, and the old /bidzo path reads the same settings.
    expect((await admin.get('/integrations/sampbidx').expect(200)).body.secret).toBeUndefined();
    expect((await admin.get('/integrations/bidzo').expect(200)).body).toMatchObject({ enabled: true, tenant: 'won-a' });
  });

  it('rejects bad signatures, stale timestamps, unknown tenants and invalid payloads', async () => {
    await send(event(), { key: 'wrong-secret' }).expect(401);
    await send(event(), { sig: 'sha256=zz' }).expect(401);
    await send(event(), { ts: Math.floor(Date.now() / 1000) - 3600 }).expect(401);
    await send(event(), { tenant: 'won-b' }).expect(401); // tenant without a secret
    await send(event(), { tenant: 'nope' }).expect(401);
    await send(event({}, { countries: [] })).expect(400);
    await send(event({ event: 'bid.lost' })).expect(400);
    expect(await prisma.wonBid.count()).toBe(0);
  });

  it('records a won bid once; repeated deliveries update it while it waits', async () => {
    const first = (await send(event()).expect(202)).body;
    expect(first).toMatchObject({ status: 'NEW', duplicate: false });
    const again = (await send(event({ eventId: 'evt-2' }, { projectName: 'Cloud buyers tracker v2' })).expect(202)).body;
    expect(again).toEqual({ wonBidId: first.wonBidId, status: 'NEW', duplicate: true });

    const list = (await viewer.get('/won-bids').expect(200)).body;
    expect(list.counts).toEqual({ NEW: 1 });
    expect(list.items[0]).toMatchObject({ bidNumber: 'BZ-2026-0042', projectName: 'Cloud buyers tracker v2', deliveries: 2, clientName: 'acme research' });
    expect(list.items[0].payload).toBeUndefined();

    const detail = (await pm.get(`/won-bids/${first.wonBidId}`).expect(200)).body;
    expect(detail.suggestedClient).toEqual({ id: clientId, name: 'Acme Research' });
    expect(detail.countries).toHaveLength(2);

    // Other tenants never see it.
    expect((await otherPm.get('/won-bids').expect(200)).body.items).toEqual([]);
    await otherPm.get(`/won-bids/${first.wonBidId}`).expect(404);
    expect((await pm.get('/insights').expect(200)).body.wonBidsNew).toBe(1);
  });

  it('creates the project once, linked to the bid', async () => {
    const { items } = (await pm.get('/won-bids').expect(200)).body;
    const wonBidId = items[0].id;
    const body = {
      name: 'Cloud buyers tracker v2', category: 'B2B', clientId, bidReference: 'BZ-2026-0042', wonBidId,
      defaults: { language: 'en', loiMinutes: 13, irPercent: 35, cpi: 22.5, targetCompletes: 400 },
      countries: [{ countryCode: 'US' }, { countryCode: 'DE', language: 'de', loiMinutes: 15, irPercent: 20, cpi: 31, targetCompletes: 250 }],
    };
    await viewer.post('/projects', body).expect(403);
    await otherPm.post('/projects', { ...body, clientId: (await otherPm.post('/clients', { name: 'X Co', code: 'XCO' }).expect(201)).body.id }).expect(409);
    const p = (await pm.post('/projects', body).expect(201)).body;
    expect(p.bidReference).toBe('BZ-2026-0042');
    const seqAfterFirst = (await prisma.organization.findUniqueOrThrow({ where: { slug: 'won-a' } })).projectSeq;

    // Second attempt: conflict, and the failed transaction leaves no project and no gap in numbering.
    await pm.post('/projects', body).expect(409);
    expect(await prisma.project.count({ where: { organization: { slug: 'won-a' } } })).toBe(1);
    expect((await prisma.organization.findUniqueOrThrow({ where: { slug: 'won-a' } })).projectSeq).toBe(seqAfterFirst);

    const after = (await pm.get(`/won-bids/${wonBidId}`).expect(200)).body;
    expect(after).toMatchObject({ status: 'PROJECT_CREATED', projectId: p.id, project: { projectCode: p.projectCode } });

    // A late re-delivery from SampBidx does not reopen or overwrite it.
    expect((await send(event({ eventId: 'evt-3' }, { projectName: 'Late rename' })).expect(202)).body).toMatchObject({ status: 'PROJECT_CREATED', duplicate: true });
    expect((await pm.get(`/won-bids/${wonBidId}`).expect(200)).body.projectName).toBe('Cloud buyers tracker v2');
  });

  it('still accepts the old /bidzo path and X-Bidzo-* headers', async () => {
    const r = await send(event({ eventId: 'evt-legacy' }, { id: 'bidzo-uuid-legacy', bidNumber: 'BZ-2026-0099' }), { legacy: true }).expect(202);
    expect(r.body.duplicate).toBe(false);
    await send(event({ eventId: 'evt-legacy-2' }, { id: 'bidzo-uuid-legacy', bidNumber: 'BZ-2026-0099' }), { legacy: true, key: 'wrong' }).expect(401);
  });

  it('dismiss and restore', async () => {
    const id = (await send(event({ eventId: 'evt-9' }, { id: 'bidzo-uuid-2', bidNumber: 'BZ-2026-0043' })).expect(202)).body.wonBidId;
    await viewer.post(`/won-bids/${id}/dismiss`, {}).expect(403);
    expect((await pm.post(`/won-bids/${id}/dismiss`, { reason: 'Client cancelled' }).expect(200)).body).toMatchObject({ status: 'DISMISSED', dismissReason: 'Client cancelled' });
    await pm.post(`/won-bids/${id}/dismiss`, {}).expect(409);
    await pm.post('/projects', { name: 'x', category: 'B2B', clientId, wonBidId: id, defaults: { language: 'en', loiMinutes: 5, irPercent: 50, cpi: 1, targetCompletes: 5 }, countries: [{ countryCode: 'US' }] }).expect(409);
    expect((await pm.post(`/won-bids/${id}/restore`).expect(200)).body.status).toBe('NEW');
    await otherPm.post(`/won-bids/${id}/restore`).expect(404);
  });

  it('rotating the secret invalidates the old one', async () => {
    const old = secret;
    secret = (await admin.post('/integrations/bidzo/secret').expect(200)).body.secret;
    await send(event({ eventId: 'evt-10' }), { key: old }).expect(401);
    await send(event({ eventId: 'evt-11' })).expect(202);
    await admin.post('/integrations/sampbidx/disable').expect(200);
    await send(event({ eventId: 'evt-12' })).expect(401);
  });
});
