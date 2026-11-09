/**
 * SAMPLEON integration (docs/SAMPLEON_INTEGRATION.md): a SampTrek project sends its approved
 * requirements to SAMPLEON as a signed audience request, sends approved changes, and follows the
 * request through SAMPLEON's signed events. The SAMPLEON here is a mock that checks signatures
 * with its own code, following SAMPLEON's documented contract; the cross-service run lives in
 * the SAMPLEON repository.
 */
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import { createHash, createHmac, randomUUID } from 'crypto';
import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const SECRET = 'projexa-client-secret-at-sampleon';
const AR = 'AR-01JC9Y3V8Q6K2N4R7T0W5X1PRJ';
const AR2 = 'AR-01JC9Y3V8Q6K2N4R7T0W5X1QTA';
const ATTRIBUTES = [
  { key: 'hcp.specialty', label: 'Medical specialty', type: 'enum', values: ['cardiology', 'oncology'], sensitivity: 'standard' },
  { key: 'b2b.years_experience', label: 'Years of professional experience', type: 'number', sensitivity: 'standard' },
];
let created = 0;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const mac = (k: string, m: string) => createHmac('sha256', k).update(m).digest('hex');

interface Hit { method: string; url: string; headers: IncomingMessage['headers']; body: string }
const hits: Hit[] = [];
const signedOk = (h: Hit) =>
  h.headers['x-sampledge-client'] === 'projexa' &&
  h.headers['x-sampledge-signature'] === `v1=${mac(SECRET, `${h.headers['x-sampledge-timestamp']}.${h.method}.${h.url}.${sha(h.body)}`)}`;

describe('SAMPLEON integration', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let mock: Server;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let project: { id: string; projectCode: string };
  let recordId: string;
  let clientId: string;
  const http = () => request(app.getHttpServer());

  function event(type: string, payload: Record<string, unknown>, over: { eventId?: string; secret?: string; projectId?: string } = {}) {
    const body = JSON.stringify({
      specVersion: '1.0', eventId: over.eventId ?? randomUUID(), type, version: 1, source: 'SAMPLEON', occurredAt: new Date().toISOString(),
      correlationId: AR, causationId: null,
      subject: { sourcePlatform: 'PROJEXA', sourceProjectId: over.projectId ?? project.projectCode, surveyId: 'zsv_cardio', organizationId: 'org' },
      payload,
    });
    const path = '/api/v1/integrations/sampleon/events';
    const ts = String(Math.floor(Date.now() / 1000));
    return http().post(path).set('content-type', 'application/json').set('x-sampledge-client', 'sampleon').set('x-sampledge-timestamp', ts)
      .set('x-sampledge-signature', `v1=${mac(over.secret ?? SECRET, `${ts}.POST.${path}.${sha(body)}`)}`).send(body);
  }

  beforeAll(async () => {
    mock = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const h = { method: req.method!, url: req.url!, headers: req.headers, body };
        hits.push(h);
        if (!signedOk(h)) return res.writeHead(401).end('{}');
        if (h.method === 'GET' && h.url === '/api/v1/attributes') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ attributes: ATTRIBUTES }));
        const b = JSON.parse(body);
        if (h.method === 'POST' && h.url === '/api/v1/audience-requests') {
          if (b.source.platform !== 'PROJEXA') return res.writeHead(403).end('{}');
          return res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ audienceRequestId: created++ ? AR2 : AR, status: 'submitted', source: b.source }));
        }
        if (h.method === 'PATCH' && h.url === `/api/v1/audience-requests/${AR}`) {
          return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ audienceRequestId: AR, status: 'live', requiredCompletes: b.requiredCompletes }));
        }
        res.writeHead(404).end('{}');
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    process.env.SAMPLEON_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
    process.env.SAMPLEON_CLIENT_SECRET = SECRET;

    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'alpha');
    const b = await makeOrg(prisma, 'bravo');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    clientId = (await pm.post('/clients', { name: 'Client One', code: 'C1', contacts: [{ name: 'Pat', email: 'pat@client-one.example.com' }] }).expect(201)).body.id;
    project = (await pm.post('/projects', {
      name: 'Cardiologist tracker', category: 'Healthcare', clientId, fieldStartAt: '2026-11-10', fieldEndAt: '2026-12-10',
      defaults: { language: 'en', loiMinutes: 15, irPercent: 20, cpi: 40, targetCompletes: 500 },
      countries: [{ countryCode: 'US' }, { countryCode: 'GB' }, { countryCode: 'DE', language: 'de', loiMinutes: 18, irPercent: 40 }],
    }).expect(201)).body;
  });

  afterAll(async () => {
    await app.close();
    await new Promise((r) => mock.close(r));
  });

  const body = {
    surveyId: 'zsv_cardio',
    launchUrl: 'https://zapx.example/s/zsv_cardio?vid=SAMPLEON&uid={token}',
    targeting: { naturalLanguage: 'Cardiologists with at least five years of professional experience' },
    rewardPoints: 1500,
  };

  it('sends the project’s requirements as a signed SampTrek audience request', async () => {
    const res = await pm.post(`/projects/${project.id}/sampleon/audience-requests`, body).expect(201);
    recordId = res.body.record.id;
    expect(res.body.audienceRequest).toMatchObject({ audienceRequestId: AR, status: 'submitted' });
    const hit = hits.find((h) => h.method === 'POST' && h.url === '/api/v1/audience-requests')!;
    expect(signedOk(hit)).toBe(true);
    const sent = JSON.parse(hit.body);
    expect(sent.source).toEqual({ platform: 'PROJEXA', projectId: project.projectCode, surveyId: 'zsv_cardio' });
    expect(sent).toMatchObject({
      title: 'Cardiologist tracker',
      countries: ['DE', 'GB', 'US'],
      requiredCompletes: 1500,
      completesByCountry: { US: 500, GB: 500, DE: 500 },
      loiMinutes: 18,
      fieldwork: { start: '2026-11-10', end: '2026-12-10' },
      reward: { points: 1500 },
      survey: { launchUrl: body.launchUrl, hostId: 'zapx' },
    });
    expect(sent.expectedIncidence).toBeCloseTo((20 + 20 + 40) / 3 / 100, 5);
    const view = (await viewer.get(`/projects/${project.id}/sampleon`).expect(200)).body;
    expect(view.configured).toBe(true);
    expect(view.requests[0]).toMatchObject({ audienceRequestId: AR, status: 'submitted', requiredCompletes: 1500, completes: 0 });
  });

  it('keeps viewers and other organizations out, and validates first', async () => {
    await viewer.post(`/projects/${project.id}/sampleon/audience-requests`, body).expect(403);
    await other.post(`/projects/${project.id}/sampleon/audience-requests`, body).expect(404);
    await other.get(`/projects/${project.id}/sampleon`).expect(404);
    const n = hits.length;
    await pm.post(`/projects/${project.id}/sampleon/audience-requests`, { ...body, targeting: {} }).expect(400);
    expect(hits.length).toBe(n);
  });

  it('sends approved target changes to SAMPLEON', async () => {
    const p = (await pm.get(`/projects/${project.id}`).expect(200)).body;
    const us = p.countries.find((c: { countryCode: string }) => c.countryCode === 'US');
    await pm.patch(`/projects/${project.id}/countries/${us.id}`, { targetCompletes: 700 }).expect(200);
    const res = await pm.post(`/projects/${project.id}/sampleon/${recordId}/sync`).expect(200);
    expect(res.body.record.requiredCompletes).toBe(1700);
    const hit = hits.find((h) => h.method === 'PATCH')!;
    // Sent with the project's quota cells (none here), so SAMPLEON's quotas follow SampTrek's.
    expect(JSON.parse(hit.body)).toEqual({ requiredCompletes: 1700, quotas: [], completesByCountry: { US: 700, GB: 500, DE: 500 }, fieldwork: { start: '2026-11-10', end: '2026-12-10' } });
  });

  it('follows the request through SAMPLEON’s signed events, once per event', async () => {
    await http().post('/api/v1/integrations/sampleon/events').send({}).expect(401);
    await event('audience.approved', { approvedBy: 'u', allocation: {} }, { secret: 'wrong' }).expect(401);
    const row = () => prisma.sampleonAudienceRequest.findUniqueOrThrow({ where: { audienceRequestId: AR } });

    await event('feasibility.calculated', {}).expect(200);
    expect((await row()).status).toBe('feasibility_ready');
    const eventId = randomUUID();
    expect((await event('audience.approved', { approvedBy: 'u', allocation: {} }, { eventId }).expect(200)).body).toEqual({ status: 'processed' });
    expect((await event('audience.approved', { approvedBy: 'u', allocation: {} }, { eventId }).expect(200)).body).toEqual({ status: 'duplicate' });
    await event('batch.scheduled', { batchId: 'b1', size: 10, scheduledAt: new Date().toISOString(), mode: 'full' }).expect(200);
    expect((await row()).status).toBe('live');

    const snap = (sequence: number, completes: number) => ({ progress: { required: 1700, completes, remaining: 1700 - completes }, byCountry: { US: { target: 700, completes } }, quotas: [], sequence });
    await event('project.quota_updated', snap(5, 120)).expect(200);
    await event('project.quota_updated', snap(4, 100)).expect(200);
    expect(await row()).toMatchObject({ completes: 120, remaining: 1580, progressSequence: 5 });
    // SAMPLEON's completes are kept apart from the completes SampTrek routed itself.
    const p = (await pm.get(`/projects/${project.id}`).expect(200)).body;
    expect(p.countries.every((c: { completes: number }) => c.completes === 0)).toBe(true);

    expect((await event('project.closed', {}, { projectId: 'PRX-OTHER' }).expect(200)).body).toEqual({ status: 'ignored' });
    await event('project.closed', { reason: 'target reached' }).expect(200);
    expect((await row()).status).toBe('closed');
  });
  it('translates the project’s quota cells into SUPPLY360 attribute quotas once the questions are mapped', async () => {
    const p2 = (await pm.post('/projects', {
      name: 'Specialist quotas', category: 'Healthcare', clientId, fieldStartAt: '2026-11-10', fieldEndAt: '2026-12-10',
      defaults: { language: 'en', loiMinutes: 10, irPercent: 30, cpi: 40, targetCompletes: 100 },
      countries: [{ countryCode: 'US' }, { countryCode: 'CA' }, { countryCode: 'CA', language: 'fr' }],
    }).expect(201)).body;
    await pm.patch(`/projects/${p2.id}`, {
      gateQuestions: [
        { id: 'spec', type: 'single', text: 'What is your medical specialty?', options: [{ id: 'card', label: 'Cardiology' }, { id: 'onc', label: 'Oncology' }, { id: 'oth', label: 'Other' }] },
        { id: 'yrs', type: 'number', text: 'How many years of experience do you have?' },
      ],
    }).expect(200);
    const full = (await pm.get(`/projects/${p2.id}`).expect(200)).body;
    const market = (code: string, lang = 'en') => full.countries.find((c: { countryCode: string; language: string }) => c.countryCode === code && c.language === lang).id;
    await pm.put(`/projects/${p2.id}/countries/${market('US')}/quotas`, { cells: [
      { group: 'Specialty', name: 'Cardiology, 10+ years', target: 40, conditions: [{ source: 'gate', questionId: 'spec', values: ['card'] }, { source: 'gate', questionId: 'yrs', min: 10 }] },
      { group: 'Specialty', name: 'Other', target: 20, conditions: [{ source: 'gate', questionId: 'spec', values: ['oth'] }] },
      { group: 'Device', name: 'Mobile', target: 30, conditions: [{ source: 'device', values: ['mobile'] }] },
    ] }).expect(200);
    for (const m of [market('CA'), market('CA', 'fr')]) {
      await pm.put(`/projects/${p2.id}/countries/${m}/quotas`, { cells: [{ group: 'Specialty', name: 'Oncology', target: 25, conditions: [{ source: 'gate', questionId: 'spec', values: ['onc'] }] }] }).expect(200);
    }

    // Before mapping: the question is suggested, nothing is sent.
    const before = (await viewer.get(`/projects/${p2.id}/sampleon/quotas`).expect(200)).body;
    expect(before.attributes.map((a: { key: string }) => a.key)).toEqual(['hcp.specialty', 'b2b.years_experience']);
    expect(before.quotas).toEqual([]);
    expect(before.questions.find((q: { key: string }) => q.key === 'gate:spec')).toMatchObject({ attribute: 'hcp.specialty', suggested: true });

    await viewer.put(`/projects/${p2.id}/sampleon/quotas`, { map: {} }).expect(403);
    await other.put(`/projects/${p2.id}/sampleon/quotas`, { map: {} }).expect(404);
    const bad = await pm.put(`/projects/${p2.id}/sampleon/quotas`, { map: { 'gate:spec': { attribute: 'hcp.specialty', values: { oth: 'dentistry' } }, 'gate:yrs': { attribute: 'hcp.nope' } } }).expect(400);
    expect(bad.body.issues).toEqual(['gate:spec.oth: "dentistry" is not a value of Medical specialty', 'gate:yrs: SUPPLY360 has no attribute hcp.nope']);

    // "Other" is not a SUPPLY360 value: map it explicitly; Cardiology and Oncology match by label.
    const saved = (await pm.put(`/projects/${p2.id}/sampleon/quotas`, {
      map: { 'gate:spec': { attribute: 'hcp.specialty', values: { oth: 'oncology' } }, 'gate:yrs': { attribute: 'b2b.years_experience' } },
    }).expect(200)).body;
    expect(saved.skipped).toEqual([expect.objectContaining({ name: 'Mobile', country: 'US', reason: 'Device is only known when the respondent opens the survey' })]);

    const res = await pm.post(`/projects/${p2.id}/sampleon/audience-requests`, body).expect(201);
    expect(res.body.record).toMatchObject({ audienceRequestId: AR2, usesProjectQuotas: true });
    expect(res.body.quotas.skipped).toHaveLength(1);
    const sent = JSON.parse(hits.filter((h) => h.method === 'POST' && h.url === '/api/v1/audience-requests').at(-1)!.body);
    const withoutId = (qs: { id: string }[]) => qs.map(({ id: _id, ...rest }) => rest);
    expect(sent.quotas).toHaveLength(3);
    expect(withoutId(sent.quotas)).toEqual(expect.arrayContaining([
      { label: 'Specialty: Cardiology, 10+ years', country: 'US', target: 40, hard: true, conditions: [
        { attribute: 'hcp.specialty', op: 'in', values: ['cardiology'] }, { attribute: 'b2b.years_experience', op: 'gte', value: 10 }] },
      { label: 'Specialty: Other', country: 'US', target: 20, hard: true, conditions: [{ attribute: 'hcp.specialty', op: 'in', values: ['oncology'] }] },
      // The English and French Canada cells are one SAMPLEON quota.
      { label: 'Specialty: Oncology', country: 'CA', target: 50, hard: true, conditions: [{ attribute: 'hcp.specialty', op: 'in', values: ['oncology'] }] },
    ]));
    expect(sent.quotas.every((q: { id: string }) => /^pjx-/.test(q.id))).toBe(true);
  });
});
