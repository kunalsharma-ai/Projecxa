import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { CallbacksService } from '../../src/callbacks/callbacks.service';
import { hmacSha256 } from '../../src/common/crypto';
import { api, createApp, login, makeOrg, resetDb, tokenFrom } from './helpers';

const BASE = 'http://api.projexa.test';

describe('PROJEXA milestone 1 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let clientId: string;
  let vendorA: string;
  let vendorB: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'alpha');
    const b = await makeOrg(prisma, 'bravo');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));

    clientId = (await pm.post('/clients', { name: 'Client One', code: 'C1', contacts: [{ name: 'Pat' }] }).expect(201)).body.id;
    vendorA = (await pm.post('/vendors', { name: 'Vendor A', code: 'VA', callbackUrlTemplate: 'https://vendor.example.com/cb?uid={uid}&s={status}' }).expect(201)).body.id;
    vendorB = (await pm.post('/vendors', { name: 'Vendor B', code: 'VB' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createProject(overrides: object = {}) {
    const res = await pm
      .post('/projects', {
        name: 'Five market B2B study',
        category: 'B2B',
        clientId,
        generateWorkOrder: true,
        defaults: { language: 'en', loiMinutes: 15, irPercent: 30, cpi: 10, targetCompletes: 2, liveSurveyUrl: 'https://client.example.com/survey?rid={session_token}' },
        countries: [{ countryCode: 'US' }, { countryCode: 'DE', language: 'de', cpi: 14, targetCompletes: 1 }],
        ...overrides,
      })
      .expect(201);
    return res.body;
  }

  async function allocate(project: { id: string }, countryCode: string, vendorId: string, target = 5) {
    const p = (await pm.get(`/projects/${project.id}`).expect(200)).body;
    const c = p.countries.find((x: { countryCode: string }) => x.countryCode === countryCode);
    await pm.post(`/projects/${project.id}/countries/${c.id}/allocations`, { vendorId, cpi: 3, targetCompletes: target }).expect(201);
    const after = (await pm.get(`/projects/${project.id}`).expect(200)).body;
    return after.countries.find((x: { countryCode: string }) => x.countryCode === countryCode).allocations.find((a: { vendorId: string }) => a.vendorId === vendorId);
  }

  async function goLive(projectId: string) {
    const p = (await pm.get(`/projects/${projectId}`).expect(200)).body;
    for (const c of p.countries) await pm.patch(`/projects/${projectId}/countries/${c.id}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);
  }

  const HYBRID = (vA: string) => ({
    mode: 'HYBRID',
    config: {
      rules: [
        { status: 'COMPLETE', type: 'DYNAMIC', url: 'https://vendor.example.com/complete', enabled: true, callbackRequired: true },
        { status: 'TERMINATE', type: 'DYNAMIC', url: 'https://vendor.example.com/term', enabled: true, callbackRequired: false },
        { status: 'QUOTA_FULL', type: 'STATIC', url: 'https://client.example.com/qf', enabled: true, callbackRequired: false },
        { status: 'DUPLICATE', type: 'STATIC', url: 'https://client.example.com/dup', enabled: true, callbackRequired: false },
        { status: 'COMPLETE', type: 'STATIC', url: 'https://client.example.com/de-a', enabled: true, callbackRequired: false, scope: { vendorId: vA, countryCode: 'DE' } },
      ],
      params: [
        { canonical: 'respondent_uid', alias: 'uid', required: true },
        { canonical: 'vendor_id', alias: 'vid', required: true },
        { canonical: 'country_code', alias: 'cc', required: true },
      ],
    },
    changeReason: 'test',
  });

  it('creates a multi-country project with shared defaults and per-country overrides', async () => {
    const p = await createProject();
    expect(p.projectCode).toMatch(/^PRX\d+$/);
    expect(p.workOrderNo).toMatch(/^WO\d+$/);
    expect(p.redirectMode).toBe('HYBRID');
    const de = p.countries.find((c: { countryCode: string }) => c.countryCode === 'DE');
    const us = p.countries.find((c: { countryCode: string }) => c.countryCode === 'US');
    expect(de).toMatchObject({ language: 'de', loiMinutes: 15, targetCompletes: 1 });
    expect(Number(de.cpi)).toBe(14);
    expect(Number(us.cpi)).toBe(10);
    expect(p.activeRedirectVersion.version).toBe(1);
  });

  it('reports every incomplete country at once', async () => {
    const res = await pm
      .post('/projects', { name: 'x', category: 'B2C', clientId, countries: [{ countryCode: 'US', language: 'en' }, { countryCode: 'FR', language: 'fr', loiMinutes: 10 }] })
      .expect(400);
    expect(res.body.issues).toHaveLength(2);
  });

  it('isolates tenants and enforces roles', async () => {
    const p = await createProject();
    await other.get(`/projects/${p.id}`).expect(404);
    await other.post(`/projects/${p.id}/redirects/versions`, HYBRID(vendorA)).expect(404);
    expect((await other.get('/projects').expect(200)).body.total).toBe(0);
    await viewer.get(`/projects/${p.id}`).expect(200);
    await viewer.patch(`/projects/${p.id}`, { name: 'nope' }).expect(403);
    await http().get('/api/v1/projects').expect(401);
  });

  it('blocks going live without survey links and vendors', async () => {
    const p = await createProject({ defaults: { language: 'en', loiMinutes: 15, irPercent: 30, cpi: 10, targetCompletes: 2 } });
    const res = await pm.patch(`/projects/${p.id}`, { status: 'LIVE' }).expect(400);
    expect(res.body.issues.join(' ')).toMatch(/no live survey link/);
  });

  describe('respondent journey', () => {
    let project: { id: string };
    let usA: { entryCode: string; testEntryCode: string; id: string };
    let deA: { entryCode: string };
    let usB: { entryCode: string };

    beforeAll(async () => {
      project = await createProject();
      usA = await allocate(project, 'US', vendorA, 1);
      usB = await allocate(project, 'US', vendorB);
      deA = await allocate(project, 'DE', vendorA);
      const draft = await pm.post(`/projects/${project.id}/redirects/versions`, HYBRID(vendorA)).expect(201);
      expect(draft.body.issues.filter((i: { level: string }) => i.level === 'error')).toEqual([]);
      await pm.post(`/projects/${project.id}/redirects/versions/${draft.body.version.id}/activate`).expect(201);
      await goLive(project.id);
    });

    it('sends the respondent to the client survey with an opaque token, not the vendor UID', async () => {
      const res = await http().get(`/s/${usB.entryCode}?uid=SECRET-UID-1`).expect(302);
      expect(res.headers.location).toMatch(/^https:\/\/client\.example\.com\/survey\?rid=/);
      expect(res.headers.location).not.toContain('SECRET-UID-1');
    });

    it('completes once, maps UID / Vendor ID / Country Code, and queues one callback', async () => {
      const entry = await http().get(`/s/${usA.entryCode}?uid=U-100`).expect(302);
      const token = new URL(entry.headers.location).searchParams.get('rid')!;
      const done = await http().get(`/r/complete?token=${token}`).expect(302);
      const dest = new URL(done.headers.location);
      expect(dest.origin + dest.pathname).toBe('https://vendor.example.com/complete');
      expect(dest.searchParams.get('uid')).toBe('U-100');
      expect(dest.searchParams.get('vid')).toBe('VA');
      expect(dest.searchParams.get('cc')).toBe('US');

      // Browser replays and a conflicting status do not change anything or duplicate money.
      await http().get(`/r/complete?token=${token}`).expect(302);
      const conflict = await http().get(`/r/terminate?token=${token}`).expect(302);
      expect(conflict.headers.location).toContain('vendor.example.com/complete');

      const s = await prisma.respondentSession.findUniqueOrThrow({ where: { token } });
      expect(s.status).toBe('COMPLETE');
      expect(s.approval).toBe('PENDING'); // browser redirect alone is not billable
      expect(s.outcomeVerified).toBe(false);
      expect(Number(s.revenue)).toBe(10);
      expect(await prisma.respondentEvent.count({ where: { sessionId: s.id, type: 'OUTCOME' } })).toBe(1);
      expect(await prisma.callbackDelivery.count({ where: { sessionId: s.id } })).toBe(1);
      const alloc = await prisma.vendorAllocation.findUniqueOrThrow({ where: { id: usA.id } });
      expect(alloc.completes).toBe(1);
    });

    it('rejects a second entry with the same UID as DUPLICATE', async () => {
      const res = await http().get(`/s/${usA.entryCode}?uid=U-100`).expect(302);
      expect(res.headers.location).toBe('https://client.example.com/dup');
    });

    it('closes entry when the vendor quota is full', async () => {
      const res = await http().get(`/s/${usA.entryCode}?uid=U-101`).expect(302);
      expect(res.headers.location).toBe('https://client.example.com/qf');
    });

    it('counts a complete over quota as an overquota, not a complete', async () => {
      // DE target is 1. Two respondents enter, both complete.
      const t1 = new URL((await http().get(`/s/${deA.entryCode}?uid=D-1`)).headers.location).searchParams.get('rid')!;
      const t2 = new URL((await http().get(`/s/${deA.entryCode}?uid=D-2`)).headers.location).searchParams.get('rid')!;
      const r1 = await http().get(`/r/complete?token=${t1}`).expect(302);
      const r2 = await http().get(`/r/complete?token=${t2}`).expect(302);
      expect(r1.headers.location).toBe('https://client.example.com/de-a'); // vendor+country override
      expect(r2.headers.location).toBe('https://client.example.com/qf');
      const s2 = await prisma.respondentSession.findUniqueOrThrow({ where: { token: t2 } });
      expect(s2).toMatchObject({ status: 'QUOTA_FULL', statusDetail: 'OVERQUOTA', revenue: null });
    });

    it('rejects unknown and expired tokens as security rejects', async () => {
      const bad = await http().get('/r/complete?token=does-not-exist').expect(302);
      expect(bad.headers.location).toBe(`${BASE}/end/security_reject`);
      const entry = await http().get(`/s/${usB.entryCode}?uid=EXP-1`);
      const token = new URL(entry.headers.location).searchParams.get('rid')!;
      await prisma.respondentSession.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().get(`/r/complete?token=${token}`).expect(302);
      const s = await prisma.respondentSession.findUniqueOrThrow({ where: { token } });
      expect(s).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'EXPIRED' });
    });

    it('verifies signed S2S outcomes and rejects tampered ones', async () => {
      const entry = await http().get(`/s/${usB.entryCode}?uid=S2S-1`);
      const token = new URL(entry.headers.location).searchParams.get('rid')!;
      const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
      const ts = Math.floor(Date.now() / 1000);
      const sig = hmacSha256(client.s2sSecret, `${token}.terminate.${ts}`);
      await http().post('/api/v1/s2s/outcome').send({ token, status: 'complete', timestamp: ts, signature: sig }).expect(401);
      await http().post('/api/v1/s2s/outcome').send({ token, status: 'terminate', timestamp: ts, signature: sig }).expect(200);
      await http().post('/api/v1/s2s/outcome').send({ token, status: 'terminate', timestamp: ts, signature: sig }).expect(200); // idempotent
      const s = await prisma.respondentSession.findUniqueOrThrow({ where: { token } });
      expect(s).toMatchObject({ status: 'TERMINATE', outcomeVerified: true });
    });

    it('test links never create billable completes', async () => {
      const entry = await http().get(`/s/${usA.testEntryCode}?uid=QA-1`).expect(302);
      const token = new URL(entry.headers.location).searchParams.get('rid')!;
      await http().get(`/r/complete?token=${token}`).expect(302);
      const s = await prisma.respondentSession.findUniqueOrThrow({ where: { token } });
      expect(s).toMatchObject({ isTest: true, status: 'COMPLETE', approval: 'NOT_APPLICABLE', revenue: null });
      expect(await prisma.callbackDelivery.count({ where: { sessionId: s.id } })).toBe(0);
    });

    it('QA simulation writes nothing', async () => {
      const before = await prisma.respondentSession.count();
      const res = await pm.post(`/projects/${project.id}/redirects/simulate`, { status: 'COMPLETE', countryCode: 'DE', vendorId: vendorA, uid: 'SIM' }).expect(201);
      expect(res.body.billable).toBe(false);
      expect(res.body.result.ruleSource).toBe('project:vendor+country');
      expect(await prisma.respondentSession.count()).toBe(before);
    });

    it('rollback activates a copy of an old version; in-flight sessions keep their version', async () => {
      const entry = await http().get(`/s/${usB.entryCode}?uid=ROLL-1`);
      const token = new URL(entry.headers.location).searchParams.get('rid')!;
      const policy = (await pm.get(`/projects/${project.id}/redirects`).expect(200)).body;
      const v1 = policy.versions.find((v: { version: number }) => v.version === 1);
      const v2 = policy.active;
      await pm.post(`/projects/${project.id}/redirects/rollback`, { versionId: v1.id }).expect(201);
      const after = (await pm.get(`/projects/${project.id}/redirects`).expect(200)).body;
      expect(after.active.version).toBe(3);
      expect(after.active.changeReason).toMatch(/Rollback to version 1/);
      // Session started under v2 still uses v2's TERMINATE rule.
      const done = await http().get(`/r/terminate?token=${token}`).expect(302);
      expect(done.headers.location).toContain('vendor.example.com/term');
      const s = await prisma.respondentSession.findUniqueOrThrow({ where: { token } });
      expect(s.redirectVersionId).toBe(v2.id);
    });

    it('refuses to activate a version with blocked domains', async () => {
      const bad = HYBRID(vendorA);
      bad.config.rules[0].url = 'https://evil.example.org/x';
      const draft = await pm.post(`/projects/${project.id}/redirects/versions`, bad).expect(201);
      expect(draft.body.issues.some((i: { message: string }) => /allowlist/.test(i.message))).toBe(true);
      await pm.post(`/projects/${project.id}/redirects/versions/${draft.body.version.id}/activate`).expect(400);
    });

    it('delivers callbacks with retries and never sends twice', async () => {
      const svc = app.get(CallbacksService);
      const calls: string[] = [];
      let fail = true;
      svc.fetcher = async (url) => {
        calls.push(url);
        return { status: fail ? 503 : 200 };
      };
      await svc.processDue();
      const d1 = await prisma.callbackDelivery.findFirstOrThrow();
      expect(d1).toMatchObject({ state: 'RETRY_SCHEDULED', attempts: 1 });
      await prisma.callbackDelivery.update({ where: { id: d1.id }, data: { nextAttemptAt: new Date() } });
      fail = false;
      await Promise.all([svc.processDue(), svc.processDue()]);
      const d2 = await prisma.callbackDelivery.findFirstOrThrow();
      expect(d2).toMatchObject({ state: 'DELIVERED', attempts: 2 });
      expect(calls).toHaveLength(2);
      expect(calls[0]).toBe('https://vendor.example.com/cb?uid=U-100&s=complete');
    });

    it('lists projects with session counts', async () => {
      const list = (await pm.get('/projects?status=LIVE').expect(200)).body;
      const row = list.items.find((i: { id: string }) => i.id === project.id);
      expect(row).toMatchObject({ completes: 2, countries: ['DE', 'US'] });
      expect(row.overquotas).toBeGreaterThanOrEqual(1);
    });
  });
});
