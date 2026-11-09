/**
 * SampTrek tells SAMPLEON (SampAudience) about each new project: `project.created` is queued with
 * the project, sent signed to SAMPLEON's event endpoint, retried while SAMPLEON is down, and not
 * queued at all while the integration is not configured. The SAMPLEON here is a mock that checks
 * signatures with its own code, following SAMPLEON's contract (envelope v1, source PROJEXA).
 */
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import { createHash, createHmac } from 'crypto';
import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import { SampleonOutbox } from '../../src/sampleon/sampleon-outbox';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const SECRET = 'projexa-secret-for-project-events';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const mac = (k: string, m: string) => createHmac('sha256', k).update(m).digest('hex');

interface Hit { method: string; url: string; headers: IncomingMessage['headers']; body: string }
const hits: Hit[] = [];
let answer = 200;
const signedOk = (h: Hit) =>
  h.headers['x-sampledge-client'] === 'projexa' &&
  h.headers['x-sampledge-signature'] === `v1=${mac(SECRET, `${h.headers['x-sampledge-timestamp']}.${h.method}.${h.url}.${sha(h.body)}`)}`;

describe('SAMPLEON project.created', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let mock: Server;
  let outbox: SampleonOutbox;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let clientId: string;
  let orgId: string;
  const events = () => hits.filter((h) => h.url === '/api/v1/events');
  const newProject = (name: string, countries = [{ countryCode: 'US' }, { countryCode: 'DE', language: 'de' }, { countryCode: 'US', language: 'es' }]) =>
    pm.post('/projects', { name, category: 'Healthcare', clientId, defaults: { language: 'en', loiMinutes: 15, irPercent: 20, cpi: 40, targetCompletes: 100 }, countries }).expect(201).then((r) => r.body as { id: string; projectCode: string });

  beforeAll(async () => {
    mock = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const h = { method: req.method!, url: req.url!, headers: req.headers, body };
        hits.push(h);
        if (!signedOk(h)) return res.writeHead(401).end('{"error":"bad signature"}');
        res.writeHead(answer, { 'content-type': 'application/json' }).end(answer === 200 ? '{"status":"processed"}' : '{"error":"down"}');
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    process.env.SAMPLEON_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
    process.env.SAMPLEON_CLIENT_SECRET = SECRET;

    ({ app, prisma } = await createApp());
    outbox = app.get(SampleonOutbox);
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'alpha');
    orgId = a.org.id;
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    clientId = (await pm.post('/clients', { name: 'Client One', code: 'C1', contacts: [{ name: 'Pat', email: 'pat@client-one.example.com' }] }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await new Promise((r) => mock.close(r));
    delete process.env.SAMPLEON_URL;
    delete process.env.SAMPLEON_CLIENT_SECRET;
  });

  it('queues project.created with the project and sends it signed to SAMPLEON', async () => {
    const p = await newProject('Cardiologist tracker');
    const row = await prisma.sampleonOutboundEvent.findFirstOrThrow({ where: { projectId: p.id } });
    expect(row).toMatchObject({ organizationId: orgId, type: 'project.created', state: 'PENDING' });

    expect(await outbox.processDue()).toBe(1);
    const hit = events().at(-1)!;
    expect(signedOk(hit)).toBe(true);
    expect(hit.headers['idempotency-key']).toBe(row.eventId);
    const e = JSON.parse(hit.body);
    expect(e).toMatchObject({
      specVersion: '1.0', eventId: row.eventId, type: 'project.created', version: 1, source: 'PROJEXA', correlationId: p.projectCode,
      subject: { sourcePlatform: 'PROJEXA', sourceProjectId: p.projectCode, organizationId: orgId },
      payload: { projectId: p.projectCode, name: 'Cardiologist tracker', countries: ['DE', 'US'] },
    });
    expect(new Date(e.occurredAt).toISOString()).toBe(e.occurredAt);
    expect((await prisma.sampleonOutboundEvent.findUniqueOrThrow({ where: { id: row.id } })).state).toBe('DELIVERED');
    expect(await outbox.processDue()).toBe(0);

    const tab = (await viewer.get(`/projects/${p.id}/sampleon`).expect(200)).body;
    expect(tab.announced).toMatchObject({ eventId: row.eventId, state: 'DELIVERED', attempts: 1 });
  });

  it('retries while SAMPLEON is down, with the same event id, and stops on a permanent refusal', async () => {
    const p = await newProject('Retry study', [{ countryCode: 'GB' }]);
    answer = 503;
    expect(await outbox.processDue()).toBe(1);
    let row = await prisma.sampleonOutboundEvent.findFirstOrThrow({ where: { projectId: p.id } });
    expect(row).toMatchObject({ state: 'RETRY_SCHEDULED', attempts: 1, lastStatusCode: 503 });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(await outbox.processDue()).toBe(0);

    answer = 200;
    await prisma.sampleonOutboundEvent.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    expect(await outbox.processDue()).toBe(1);
    row = await prisma.sampleonOutboundEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(row).toMatchObject({ state: 'DELIVERED', attempts: 2, lastError: null });
    const sent = events().filter((h) => JSON.parse(h.body).correlationId === p.projectCode);
    expect(sent.map((h) => h.headers['idempotency-key'])).toEqual([row.eventId, row.eventId]);

    // A 4xx (other than 408/429) will not get better by retrying.
    const q = await newProject('Refused study', [{ countryCode: 'FR' }]);
    answer = 400;
    await outbox.processDue();
    expect((await prisma.sampleonOutboundEvent.findFirstOrThrow({ where: { projectId: q.id } })).state).toBe('FAILED');
    answer = 200;
  });

  it('sends one for a copied project, and on request for an existing one', async () => {
    const src = await newProject('Wave 1', [{ countryCode: 'JP', language: 'ja' }]);
    await outbox.processDue();
    const copy = (await pm.post(`/projects/${src.id}/clone`, { name: 'Wave 2' }).expect(201)).body;
    await outbox.processDue();
    const e = JSON.parse(events().at(-1)!.body);
    expect(e.payload).toEqual({ projectId: copy.projectCode, name: 'Wave 2', countries: ['JP'] });

    await viewer.post(`/projects/${src.id}/sampleon/announce`).expect(403);
    const a = (await pm.post(`/projects/${src.id}/sampleon/announce`).expect(202)).body;
    expect(a.announced).toMatchObject({ state: 'PENDING' });
    await outbox.processDue();
    expect(await prisma.sampleonOutboundEvent.count({ where: { projectId: src.id, state: 'DELIVERED' } })).toBe(2);
  });

  it('queues nothing while the integration is not configured', async () => {
    const saved = process.env.SAMPLEON_CLIENT_SECRET;
    delete process.env.SAMPLEON_CLIENT_SECRET;
    try {
      const p = await newProject('Offline study', [{ countryCode: 'IT', language: 'it' }]);
      expect(await prisma.sampleonOutboundEvent.count({ where: { projectId: p.id } })).toBe(0);
      expect(await outbox.processDue()).toBe(0);
      await pm.post(`/projects/${p.id}/sampleon/announce`).expect(503);
    } finally {
      process.env.SAMPLEON_CLIENT_SECRET = saved;
    }
  });
});
