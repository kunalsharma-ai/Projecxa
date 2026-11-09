import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import request from 'supertest';
import { RedirectHealthService } from '../../src/redirect-health/redirect-health';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Redirect health (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let orgId: string;
  const projects: { id: string; code: string; entry: string; countryId: string }[] = [];
  const http = () => request(app.getHttpServer());
  let n = 0;

  async function enter(code: string, uid: string) {
    const r = await http().get(`/s/${code}?uid=${uid}`).set('X-Forwarded-For', `198.51.100.${++n}`).expect(302);
    return new URL(r.headers.location).searchParams.get('rid')!;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'rh-a');
    const b = await makeOrg(prisma, 'rh-b');
    orgId = a.org.id;
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Client', code: 'CL1' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Vendor', code: 'VP' }).expect(201)).body.id;
    for (const [name, url] of [['Healthy study', 'https://client.example.com/s?rid={session_token}'], ['Broken study', 'https://client.example.com/gone?rid={session_token}']]) {
      const p = (await pm.post('/projects', { name, category: 'B2C', clientId, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 2, targetCompletes: 100, liveSurveyUrl: url }, countries: [{ countryCode: 'US' }] }).expect(201)).body;
      const countryId = p.countries[0].id;
      await pm.post(`/projects/${p.id}/countries/${countryId}/allocations`, { vendorId, cpi: 1, targetCompletes: 100 }).expect(201);
      await pm.patch(`/projects/${p.id}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
      await pm.patch(`/projects/${p.id}`, { status: 'LIVE' }).expect(200);
      const entry = (await pm.get(`/projects/${p.id}`).expect(200)).body.countries[0].allocations[0].entryCode;
      projects.push({ id: p.id, code: p.projectCode, entry, countryId });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts idle, then reports redirects, fallbacks, reasons and slow redirects per project', async () => {
    const empty = (await viewer.get('/redirect-health').expect(200)).body;
    expect(empty.health).toBe('idle');
    expect(empty.projects.map((p: { health: string }) => p.health)).toEqual(['idle', 'idle']);

    const [good, bad] = projects;
    // Real traffic on the healthy study: three respondents finish.
    for (const uid of ['G1', 'G2', 'G3']) {
      const token = await enter(good.entry, uid);
      await http().get(`/r/complete?token=${token}`).expect(302);
    }
    // The broken study: ten redirects, four blocked by the allowlist, slow.
    const sessions = [];
    for (let i = 0; i < 10; i++) {
      await enter(bad.entry, `B${i}`);
      sessions.push(await prisma.respondentSession.findFirstOrThrow({ where: { projectId: bad.id, vendorRespondentId: `B${i}` } }));
    }
    await prisma.redirectExecution.createMany({
      data: sessions.map((s, i) => ({
        sessionId: s.id,
        status: 'COMPLETE' as const,
        destination: 'https://client.example.com/end',
        usedFallback: i < 4,
        blockedReason: i < 4 ? `Domain end${i}.example is not on the allowlist` : null,
        durationMs: 100 + i * 300,
      })),
    });
    // A test respondent is never counted.
    const t = await prisma.respondentSession.create({ data: { ...omit(sessions[0]), token: 'test-token', vendorRespondentId: 'T1', isTest: true } });
    await prisma.redirectExecution.create({ data: { sessionId: t.id, status: 'COMPLETE', destination: 'x', usedFallback: true, blockedReason: 'Test only', durationMs: 99999 } });

    const r = (await viewer.get('/redirect-health?window=24h').expect(200)).body;
    expect(r.window).toMatchObject({ key: '24h', bucketMinutes: 60 });
    expect(r.series).toHaveLength(24);
    expect(r.series.reduce((a: number, b: { ok: number; fallback: number }) => a + b.ok + b.fallback, 0)).toBe(r.totals.redirects);
    expect(r.totals).toMatchObject({ entries: 13, blocked: r.totals.blocked });
    expect(r.totals.redirects).toBe(13);
    expect(r.health).toBe('failing');
    expect(r.reasons[0]).toBe(`${bad.code}: 40% of redirects fell back`);
    const [first, second] = r.projects;
    expect(first.project.id).toBe(bad.id);
    expect(first).toMatchObject({ health: 'failing', redirects: 10, fallbacks: 4, blocked: 4 });
    expect(first.reasons).toEqual(expect.arrayContaining(['40% of redirects fell back', expect.stringMatching(/^Slow redirects \(p95 \d+ ms\)$/)]));
    expect(first.p95Ms).toBeGreaterThan(2000);
    expect(second.project.id).toBe(good.id);
    expect(second.redirects).toBe(3);
    const allow = r.fallbackReasons.find((x: { reason: string }) => x.reason.startsWith('Domain <host>'));
    expect(allow).toMatchObject({ count: 4, projects: [{ id: bad.id, projectCode: bad.code }] });
    expect(r.fallbackReasons.some((x: { reason: string }) => x.reason === 'Test only')).toBe(false);
    expect(r.outcomes.find((o: { status: string }) => o.status === 'COMPLETE').count).toBe(13);

    // One project only.
    const one = (await viewer.get(`/redirect-health?projectId=${good.id}&window=7d`).expect(200)).body;
    expect(one.projects).toHaveLength(1);
    expect(one.totals.redirects).toBe(3);
    expect(one.series).toHaveLength(28);
    await viewer.get('/redirect-health?window=1h').expect(200).then((x) => expect(x.body.series).toHaveLength(12));
  });

  it('shows vendor callbacks by host with query strings hidden, and sessions that never came back', async () => {
    const [good] = projects;
    const s = await prisma.respondentSession.findFirstOrThrow({ where: { projectId: good.id, vendorRespondentId: 'G1' } });
    await prisma.callbackDelivery.create({ data: { organizationId: orgId, sessionId: s.id, targetType: 'vendor', url: 'https://vendor.example.com/cb?uid=G1&key=secret', idempotencyKey: 'rh-dead', state: 'DEAD_LETTER', attempts: 6, lastStatusCode: 500, lastError: 'HTTP 500' } });
    // Two respondents left for the survey and their sessions ran out.
    for (const uid of ['X1', 'X2']) await enter(good.entry, uid);
    await prisma.respondentSession.updateMany({ where: { projectId: good.id, vendorRespondentId: { in: ['X1', 'X2'] } }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    const r = (await viewer.get(`/redirect-health?projectId=${good.id}`).expect(200)).body;
    expect(r.projects[0]).toMatchObject({ health: 'failing', callbacksDead: 1, expired: 2 });
    expect(r.projects[0].reasons).toContain('1 vendor callback gave up');
    expect(r.callbackProblems[0]).toMatchObject({ state: 'DEAD_LETTER', url: 'https://vendor.example.com/cb?…', project: { id: good.id } });
    expect(JSON.stringify(r)).not.toContain('secret');
    const host = r.callbackHosts.find((h: { host: string }) => h.host === 'vendor.example.com');
    expect(host).toMatchObject({ failing: 1, lastStatusCode: 500 });
  });

  it('keeps organisations apart', async () => {
    const r = (await other.get('/redirect-health').expect(200)).body;
    expect(r).toMatchObject({ health: 'idle', projects: [], callbackProblems: [], fallbackReasons: [], reasons: [] });
    await other.get(`/redirect-health?projectId=${projects[0].id}`).expect(404);
  });

  it('checks live survey links without reaching private networks', async () => {
    const svc = app.get(RedirectHealthService);
    const seen: string[] = [];
    svc.resolve = async (host) => (host === 'internal.example.com' ? ['10.0.0.5'] : ['93.184.216.34']);
    svc.fetcher = async (url) => {
      seen.push(url);
      return url.includes('/gone') ? { status: 404, location: null } : { status: 302, location: 'https://client.example.com/start' };
    };
    await viewer.post('/redirect-health/check-links').expect(403);
    const all = (await pm.post('/redirect-health/check-links').expect(201)).body;
    expect(all).toHaveLength(2);
    expect(all.find((x: { projectId: string }) => x.projectId === projects[0].id)).toMatchObject({ ok: true, status: 302, detail: 'Redirects to client.example.com' });
    expect(all.find((x: { projectId: string }) => x.projectId === projects[1].id)).toMatchObject({ ok: false, status: 404 });
    expect(seen[0]).toContain('rid=projexa-link-check');

    await prisma.projectCountry.update({ where: { id: projects[1].countryId }, data: { liveSurveyUrl: 'https://internal.example.com/s' } });
    const priv = (await pm.post(`/redirect-health/check-links/${projects[1].id}`).expect(201)).body;
    expect(priv).toEqual([expect.objectContaining({ ok: false, status: null, detail: 'The host points to a private network address' })]);
    expect(seen.some((u) => u.includes('internal.example.com'))).toBe(false);
    expect((await other.post(`/redirect-health/check-links/${projects[1].id}`).expect(201)).body).toEqual([]);
    expect(await prisma.auditEvent.count({ where: { organizationId: orgId, action: 'redirects.links_checked' } })).toBe(2);
  });
});

function omit<T extends { id: string; token: string; vendorRespondentId: string; answers: unknown }>(s: T) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, token, vendorRespondentId, answers, ...rest } = s;
  return rest as Omit<T, 'id' | 'token' | 'vendorRespondentId' | 'answers'>;
}
