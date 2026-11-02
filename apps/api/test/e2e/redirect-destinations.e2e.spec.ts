import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHmac } from 'crypto';
import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { RedirectsService } from '../../src/redirects/redirects.service';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

interface Seen { path: string; headers: IncomingMessage['headers']; body: string }

describe('Dynamic redirect destinations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let orgId: string;
  let projectId: string;
  let entryCode: string;
  let n = 0;
  let resolver: Server;
  let base: string;
  const seen: Seen[] = [];
  const http = () => request(app.getHttpServer());

  /** A stand-in for a client's routing endpoint. */
  function startResolver() {
    return new Promise<void>((resolve) => {
      resolver = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          seen.push({ path: req.url ?? '', headers: req.headers, body });
          const p = JSON.parse(body || '{}');
          const send = (code: number, json: unknown) => {
            res.writeHead(code, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(json));
          };
          if (req.url === '/ok') return send(200, { url: `https://client.example.com/done?u=${p.respondent_uid}&test=${p.test ? 1 : 0}` });
          if (req.url === '/evil') return send(200, { url: 'https://evil.example.org/steal' });
          if (req.url === '/broken') return send(500, { error: 'down' });
          if (req.url === '/slow') return void setTimeout(() => send(200, { url: 'https://client.example.com/late' }), 1500);
          send(404, {});
        });
      });
      resolver.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${(resolver.address() as AddressInfo).port}`;
        resolve();
      });
    });
  }

  const apiRule = (path: string, extra: Record<string, unknown> = {}) => ({
    mode: 'HYBRID',
    config: {
      rules: [
        { status: 'COMPLETE', type: 'API', url: `${base}${path}`, fallbackUrl: 'https://client.example.com/fallback?uid={respondent_uid}', enabled: true, callbackRequired: false, ...extra },
        { status: 'TERMINATE', type: 'STATIC', url: 'https://client.example.com/term', enabled: true, callbackRequired: false },
      ],
      params: [],
    },
    changeReason: `api ${path}`,
  });

  async function activate(body: object) {
    const d = await pm.post(`/projects/${projectId}/redirects/versions`, body).expect(201);
    expect(d.body.issues.filter((i: { level: string }) => i.level === 'error')).toEqual([]);
    await pm.post(`/projects/${projectId}/redirects/versions/${d.body.version.id}/activate`).expect(201);
    return d.body.version.id as string;
  }

  async function complete() {
    const uid = `R${++n}`;
    const entry = await http().get(`/s/${entryCode}?uid=${uid}`).set('User-Agent', DESKTOP).set('X-Forwarded-For', `198.51.100.${n}`).expect(302);
    const token = new URL(entry.headers.location).searchParams.get('rid')!;
    const out = await http().get(`/r/complete?token=${token}`).expect(302);
    const session = await prisma.respondentSession.findUniqueOrThrow({ where: { token } });
    const exec = await prisma.redirectExecution.findFirstOrThrow({ where: { sessionId: session.id }, orderBy: { createdAt: 'desc' } });
    return { uid, location: out.headers.location as string, exec };
  }

  beforeAll(async () => {
    await startResolver();
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'dest', ['client.example.com', 'vendor.example.com', '127.0.0.1']);
    const b = await makeOrg(prisma, 'dest-other');
    orgId = a.org.id;
    admin = api(app, await login(app, a.users.ADMIN.email));
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Dest client', code: 'DSTC' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Dest vendor', code: 'DSTV' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'Destinations',
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 2, targetCompletes: 100, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    projectId = p.id;
    const c = p.countries[0];
    await pm.post(`/projects/${p.id}/countries/${c.id}/allocations`, { vendorId, cpi: 1, targetCompletes: 100 }).expect(201);
    await pm.patch(`/projects/${p.id}/countries/${c.id}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${p.id}`, { status: 'LIVE' }).expect(200);
    entryCode = (await pm.get(`/projects/${p.id}`).expect(200)).body.countries[0].allocations[0].entryCode;
  });

  afterAll(async () => {
    await app.close();
    resolver.close();
  });

  it('validates API rules: hybrid only, fallback required, endpoint and fallback on the allowlist, no macros', async () => {
    const errors = async (body: object) => (await pm.post(`/projects/${projectId}/redirects/versions`, body).expect(201)).body.issues.filter((i: { level: string }) => i.level === 'error').map((i: { message: string }) => i.message).join(' | ');
    const ok = apiRule('/ok');
    expect(await errors({ ...ok, mode: 'STATIC' })).toMatch(/hybrid/i);
    expect(await errors(apiRule('/ok', { fallbackUrl: undefined }))).toMatch(/fallback/i);
    expect(await errors(apiRule('/ok', { url: 'https://router.elsewhere.example.net/x' }))).toMatch(/allowlist/);
    expect(await errors(apiRule('/ok', { url: `${base}/ok?u={respondent_uid}` }))).toMatch(/macro/i);
    expect(await errors(apiRule('/ok', { fallbackUrl: 'https://evil.example.org/' }))).toMatch(/allowlist/);
    await pm.post(`/projects/${projectId}/redirects/versions`, apiRule('/ok', { timeoutMs: 50 })).expect(400);
    expect(await errors(ok)).toBe('');
  });

  it('asks the endpoint live, signed with the organisation secret, and sends the respondent where it says', async () => {
    await activate(apiRule('/ok'));
    seen.length = 0;
    const r = await complete();
    expect(r.location).toBe(`https://client.example.com/done?u=${r.uid}&test=0`);
    expect(r.exec).toMatchObject({ apiFallback: false, usedFallback: false, ruleSource: 'project' });

    const req = seen.find((s) => s.path === '/ok')!;
    expect(JSON.parse(req.body)).toEqual({ status: 'COMPLETE', respondent_uid: r.uid, vendor_id: 'DSTV', country_code: 'US', project_code: expect.any(String) });
    const secret = (await admin.get('/organization/redirect-signing-secret').expect(200)).body.secret;
    expect(secret).toMatch(/^rss_/);
    const ts = req.headers['x-projexa-timestamp'] as string;
    expect(req.headers['x-projexa-signature']).toBe(`sha256=${createHmac('sha256', secret).update(`${ts}.${req.body}`).digest('hex')}`);
  });

  it('uses the fallback URL when the endpoint is slow, broken or answers a URL that is not allowed', async () => {
    await activate(apiRule('/slow', { timeoutMs: 300 }));
    const slow = await complete();
    expect(slow.location).toBe(`https://client.example.com/fallback?uid=${slow.uid}`);
    expect(slow.exec.apiFallback).toBe(true);
    expect(slow.exec.blockedReason).toMatch(/no answer within 300 ms/);
    expect(slow.exec.durationMs).toBeLessThan(1200);

    await activate(apiRule('/broken'));
    const broken = await complete();
    expect(broken.location).toContain('/fallback?uid=');
    expect(broken.exec.blockedReason).toMatch(/HTTP 500/);

    await activate(apiRule('/evil'));
    const evil = await complete();
    expect(evil.location).toContain('/fallback?uid=');
    expect(evil.exec.blockedReason).toMatch(/evil\.example\.org is not on the allowlist/);

    const bell = await pm.get('/insights').expect(200);
    expect(bell.body.items.map((i: { id: string }) => i.id)).toContain('api-fallbacks');
  });

  it('QA studio asks the endpoint marked as a test; the effective view shows the endpoint', async () => {
    await activate(apiRule('/ok'));
    const vendorId = (await pm.get(`/projects/${projectId}/redirects`).expect(200)).body.vendors[0].id;
    const sim = await pm.post(`/projects/${projectId}/redirects/simulate`, { status: 'COMPLETE', countryCode: 'US', vendorId, uid: 'QA1' }).expect(201);
    expect(sim.body.result.destination).toBe('https://client.example.com/done?u=QA1&test=1');
    expect(sim.body.api).toMatchObject({ endpoint: `${base}/ok`, answered: 'https://client.example.com/done?u=QA1&test=1', error: null });
    expect(sim.body.billable).toBe(false);
    const eff = await pm.get(`/projects/${projectId}/redirects/effective`).expect(200);
    const row = eff.body.rows.find((x: { status: string }) => x.status === 'COMPLETE');
    expect(row).toMatchObject({ type: 'API', apiEndpoint: `${base}/ok`, destination: 'https://client.example.com/fallback?uid=SAMPLE-UID' });
  });

  it('signing secret: admins only; rotating changes it', async () => {
    await pm.get('/organization/redirect-signing-secret').expect(403);
    await viewer.post('/organization/redirect-signing-secret/rotate').expect(403);
    const before = (await admin.get('/organization/redirect-signing-secret').expect(200)).body.secret;
    const after = (await admin.post('/organization/redirect-signing-secret/rotate').expect(201)).body.secret;
    expect(after).not.toBe(before);
    expect((await admin.get('/organization/redirect-signing-secret').expect(200)).body.secret).toBe(after);
    expect(await prisma.auditEvent.findFirst({ where: { organizationId: orgId, action: 'redirect.signing-secret-rotate' } })).toBeTruthy();
  });

  it('schedules a version to go live, one at a time, and the scheduler activates it when due', async () => {
    const draft = (await pm.post(`/projects/${projectId}/redirects/versions`, apiRule('/ok', { fallbackUrl: 'https://client.example.com/scheduled' })).expect(201)).body.version;
    const soon = new Date(Date.now() + 3600_000).toISOString();
    await pm.post(`/projects/${projectId}/redirects/versions/${draft.id}/schedule`, { at: new Date(Date.now() + 1000).toISOString() }).expect(400);
    await pm.post(`/projects/${projectId}/redirects/versions/${draft.id}/schedule`, { at: new Date(Date.now() + 100 * 86_400_000).toISOString() }).expect(400);
    await viewer.post(`/projects/${projectId}/redirects/versions/${draft.id}/schedule`, { at: soon }).expect(403);
    await other.post(`/projects/${projectId}/redirects/versions/${draft.id}/schedule`, { at: soon }).expect(404);
    const s = await pm.post(`/projects/${projectId}/redirects/versions/${draft.id}/schedule`, { at: soon }).expect(201);
    expect(s.body).toMatchObject({ state: 'SCHEDULED', scheduledAt: soon });

    const second = (await pm.post(`/projects/${projectId}/redirects/versions`, apiRule('/ok')).expect(201)).body.version;
    const clash = await pm.post(`/projects/${projectId}/redirects/versions/${second.id}/schedule`, { at: soon }).expect(400);
    expect(clash.body.message).toMatch(/already scheduled/);

    // Cancel and schedule again.
    expect((await pm.delete(`/projects/${projectId}/redirects/versions/${draft.id}/schedule`).expect(200)).body.state).toBe('DRAFT');
    await pm.delete(`/projects/${projectId}/redirects/versions/${draft.id}/schedule`).expect(400);
    await pm.post(`/projects/${projectId}/redirects/versions/${draft.id}/schedule`, { at: soon }).expect(201);

    const svc = app.get(RedirectsService);
    expect(await svc.runDue(new Date())).toEqual([]);
    const activeBefore = (await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).activeRedirectVersionId;
    const ran = await svc.runDue(new Date(Date.now() + 2 * 3600_000));
    expect(ran).toEqual([{ versionId: draft.id, ok: true }]);
    const v = await prisma.redirectPolicyVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(v).toMatchObject({ state: 'ACTIVE', scheduleError: null });
    expect(v.activatedAt).toBeTruthy();
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).activeRedirectVersionId).toBe(draft.id);
    expect((await prisma.redirectPolicyVersion.findUniqueOrThrow({ where: { id: activeBefore! } })).state).toBe('ARCHIVED');
    expect(await prisma.auditEvent.findFirst({ where: { organizationId: orgId, action: 'redirect.activate-scheduled' } })).toBeTruthy();
    // Running again does nothing.
    expect(await svc.runDue(new Date(Date.now() + 2 * 3600_000))).toEqual([]);
  });

  it('a scheduled version that no longer passes goes back to draft with the reason, and the bell says so', async () => {
    const draft = (await pm.post(`/projects/${projectId}/redirects/versions`, apiRule('/ok')).expect(201)).body.version;
    await pm.post(`/projects/${projectId}/redirects/versions/${draft.id}/schedule`, { at: new Date(Date.now() + 3600_000).toISOString() }).expect(201);
    // The endpoint's domain is removed from the allowlist before the time comes.
    await prisma.organization.update({ where: { id: orgId }, data: { redirectAllowedDomains: ['client.example.com', 'vendor.example.com'] } });
    const ran = await app.get(RedirectsService).runDue(new Date(Date.now() + 2 * 3600_000));
    expect(ran[0]).toMatchObject({ versionId: draft.id, ok: false });
    const v = await prisma.redirectPolicyVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(v.state).toBe('DRAFT');
    expect(v.scheduleError).toMatch(/allowlist/);
    expect(await prisma.auditEvent.findFirst({ where: { organizationId: orgId, action: 'redirect.schedule-failed' } })).toBeTruthy();
    const bell = await pm.get('/insights').expect(200);
    expect(bell.body.items.find((i: { id: string }) => i.id === `redirect-schedule-${draft.id}`)).toMatchObject({ severity: 'bad', href: `/projects/${projectId}?tab=redirects` });
    const policy = await pm.get(`/projects/${projectId}/redirects`).expect(200);
    expect(policy.body.versions.find((x: { id: string }) => x.id === draft.id).scheduleError).toMatch(/allowlist/);
    await prisma.organization.update({ where: { id: orgId }, data: { redirectAllowedDomains: ['client.example.com', 'vendor.example.com', '127.0.0.1'] } });
  });

  it('compares two versions rule by rule', async () => {
    const a = (await pm.post(`/projects/${projectId}/redirects/versions`, apiRule('/ok')).expect(201)).body.version;
    const b = (
      await pm
        .post(`/projects/${projectId}/redirects/versions`, {
          mode: 'HYBRID',
          config: {
            rules: [
              { status: 'COMPLETE', type: 'API', url: `${base}/ok`, fallbackUrl: 'https://client.example.com/other', timeoutMs: 800, enabled: true, callbackRequired: false },
              { status: 'QUOTA_FULL', type: 'STATIC', url: 'https://client.example.com/qf', enabled: true, callbackRequired: false },
            ],
            params: [{ canonical: 'respondent_uid', alias: 'rid', required: true }],
          },
        })
        .expect(201)
    ).body.version;
    const r = await pm.get(`/projects/${projectId}/redirects/compare?from=${a.id}&to=${b.id}`).expect(200);
    expect(r.body.from.version).toBe(a.version);
    expect(r.body.diff.mode).toBeNull();
    const byStatus = Object.fromEntries(r.body.diff.rules.map((c: { status: string }) => [c.status, c]));
    expect(byStatus.COMPLETE.kind).toBe('changed');
    expect(byStatus.COMPLETE.fields.map((f: { field: string }) => f.field).sort()).toEqual(['fallbackUrl', 'timeoutMs']);
    expect(byStatus.TERMINATE.kind).toBe('removed');
    expect(byStatus.QUOTA_FULL.kind).toBe('added');
    expect(r.body.diff.params).toHaveLength(1);
    await pm.get(`/projects/${projectId}/redirects/compare?from=${a.id}`).expect(400);
    await other.get(`/projects/${projectId}/redirects/compare?from=${a.id}&to=${b.id}`).expect(404);
  });
});
