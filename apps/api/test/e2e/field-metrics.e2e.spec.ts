import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

/** Avg LOI / Avg IR, the speeder check, live money and the auto-pause checkpoint (docs/FIELD_METRICS.md). */
describe('Field metrics, speeders and auto-pause (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let projectId: string;
  let countryId: string;
  let entryCode: string;
  let n = 0;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'fm');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    const clientId = (await pm.post('/clients', { name: 'Client', code: 'CL' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Panel', code: 'PN' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'Speedy study',
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 12, irPercent: 40, cpi: 5, targetCompletes: 10, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    projectId = p.id;
    countryId = p.countries[0].id;
    await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId, cpi: 2, targetCompletes: 10 }).expect(201);
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);
    entryCode = (await pm.get(`/projects/${projectId}`).expect(200)).body.countries[0].allocations[0].entryCode;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Enter, wait `minutes` (by moving the start back), then send the outcome. Returns where the respondent went. */
  async function respondent(status: 'complete' | 'terminate', minutes: number) {
    const entry = await http().get(`/s/${entryCode}?uid=F${++n}`).set('X-Forwarded-For', `198.51.100.${n}`).expect(302);
    const token = new URL(entry.headers.location).searchParams.get('rid')!;
    await prisma.respondentSession.update({ where: { token }, data: { startedAt: new Date(Date.now() - minutes * 60_000) } });
    const out = await http().get(`/r/${status}?token=${token}`).expect(302);
    return { token, location: out.headers.location as string, session: await prisma.respondentSession.findUniqueOrThrow({ where: { token } }) };
  }

  it('validates the speeder check and keeps it in the settings history', async () => {
    await pm.patch(`/projects/${projectId}`, { speederCheck: { enabled: true, fraction: '4/4' } }).expect(400);
    await pm.patch(`/projects/${projectId}`, { speederCheck: { enabled: true, fraction: '1/3' } }).expect(200);
    await viewer.patch(`/projects/${projectId}`, { speederCheck: { enabled: false, fraction: '1/3' } }).expect(403);
    const p = (await pm.get(`/projects/${projectId}`).expect(200)).body;
    expect(p.speederCheck).toEqual({ enabled: true, fraction: '1/3' });
    const history = (await pm.get(`/projects/${projectId}/history`).expect(200)).body;
    expect(JSON.stringify(history)).toContain('Speeder check');
  });

  it('turns a too-fast complete into a speeder and keeps normal completes', async () => {
    const ok = await respondent('complete', 9);
    expect(ok.session).toMatchObject({ status: 'COMPLETE', statusDetail: null });
    // 1/3 of 12 minutes = 4 minutes; 2 minutes is a speeder.
    const fast = await respondent('complete', 2);
    expect(fast.session).toMatchObject({ status: 'QUALITY_FAIL', statusDetail: 'SPEEDER', revenue: null, payout: null });
    expect(fast.location).toContain('quality_fail');
    await respondent('terminate', 1);
    const c = await prisma.projectCountry.findUniqueOrThrow({ where: { id: countryId } });
    expect(c.completes).toBe(1);
  });

  it('shows Avg LOI, Avg IR, speeders and live money on the project and in the list', async () => {
    const p = (await pm.get(`/projects/${projectId}`).expect(200)).body;
    expect(p.stats).toMatchObject({ COMPLETE: 1, TERMINATE: 1, SPEEDER: 1, QUALITY_FAIL: 0 });
    expect(p.metrics).toMatchObject({ irPercent: 50, speeders: 1 });
    expect(p.metrics.avgLoiMinutes).toBeGreaterThan(8.9);
    expect(p.metrics.avgLoiMinutes).toBeLessThan(9.2);
    expect(p.countries[0].metrics).toMatchObject({ irPercent: 50, speeders: 1 });
    expect(p.finance[0]).toMatchObject({ revenue: 5, cost: 2, margin: 3 });
    const row = (await pm.get('/projects').expect(200)).body.items.find((x: { id: string }) => x.id === projectId);
    expect(row).toMatchObject({ speeders: 1, avgIrPercent: 50, loiMinutes: 12, irPercent: 40, completes: 1 });
    expect(row.avgLoiMinutes).toBeCloseTo(9, 0);
  });

  it('reports LOI, IR and speeders, with speeders left out of quality fails', async () => {
    const t = (await viewer.get('/reports/overall').expect(200)).body.totals;
    expect(t).toMatchObject({ completes: 1, terminates: 1, speeders: 1, qualityFail: 0, ir: 50 });
    expect(t.loiMinutes).toBeCloseTo(9, 0);
  });

  it('accepts the server-to-server complete for a speeder without a conflict', async () => {
    const fast = await respondent('complete', 1);
    const s = await prisma.respondentSession.findUniqueOrThrow({ where: { token: fast.token }, include: { project: { include: { client: true } } } });
    const ts = Math.floor(Date.now() / 1000);
    const { createHmac } = await import('crypto');
    const signature = createHmac('sha256', s.project.client.s2sSecret).update(`${fast.token}.complete.${ts}`).digest('hex');
    const r = await http().post('/api/v1/s2s/outcome').send({ token: fast.token, status: 'complete', timestamp: ts, signature }).expect(200);
    expect(r.body).toMatchObject({ ok: true, status: 'QUALITY_FAIL' });
  });

  it('auto-pauses the market at the checkpoint, raises an alert, and stays off after a resume', async () => {
    await pm.patch(`/projects/${projectId}`, { autopilot: { pauseOnQuality: false, closeOnTarget: false, autoPause: { enabled: true, by: 'percent', value: 100, scope: 'market' } } }).expect(400);
    await pm.patch(`/projects/${projectId}`, { autopilot: { pauseOnQuality: false, closeOnTarget: false, autoPause: { enabled: true, by: 'completes', value: 3, scope: 'market' } } }).expect(200);
    await respondent('complete', 8); // 2 completes: below the checkpoint
    expect((await prisma.projectCountry.findUniqueOrThrow({ where: { id: countryId } })).status).toBe('LIVE');
    await respondent('complete', 8); // 3 completes: the checkpoint
    expect((await prisma.projectCountry.findUniqueOrThrow({ where: { id: countryId } })).status).toBe('HOLD');
    let p = (await pm.get(`/projects/${projectId}`).expect(200)).body;
    expect(p.autopilotState.autoPause.done[`m:${countryId}`]).toMatchObject({ reason: 'paused', completes: 3, target: 10 });
    // The only market is done, so the autopilot switched the checkpoint off.
    expect(p.autopilot.autoPause.enabled).toBe(false);
    expect(p.autopilotState.autoPause.switchedOffAt).toBeTruthy();

    await pm.post('/monitor/run').expect(201);
    const alerts = (await pm.get('/alerts').expect(200)).body as { rule: string; projectCountryId: string }[];
    expect(alerts.some((x) => x.rule === 'auto_paused' && x.projectCountryId === countryId)).toBe(true);

    // Someone resumes the market: it is not paused again, and the alert clears.
    await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
    await respondent('complete', 8);
    expect((await prisma.projectCountry.findUniqueOrThrow({ where: { id: countryId } })).status).toBe('LIVE');
    await pm.post('/monitor/run').expect(201);
    expect(((await pm.get('/alerts').expect(200)).body as { rule: string }[]).some((x) => x.rule === 'auto_paused')).toBe(false);

    // Turning it on again starts afresh.
    await pm.patch(`/projects/${projectId}`, { autopilot: { pauseOnQuality: false, closeOnTarget: false, autoPause: { enabled: true, by: 'completes', value: 3, scope: 'market' } } }).expect(200);
    p = (await pm.get(`/projects/${projectId}`).expect(200)).body;
    expect(p.autopilotState).toBeNull();
  });

  it('pauses vendor links on their own target when the scope is vendor', async () => {
    await pm.patch(`/projects/${projectId}`, { autopilot: { pauseOnQuality: false, closeOnTarget: false, autoPause: { enabled: true, by: 'percent', value: 50, scope: 'vendor' } } }).expect(200);
    await respondent('complete', 8); // the link now has 5 of 10
    const alloc = await prisma.vendorAllocation.findFirstOrThrow({ where: { projectCountryId: countryId } });
    expect(alloc.completes).toBe(5);
    expect(alloc.status).toBe('PAUSED');
    expect((await prisma.projectCountry.findUniqueOrThrow({ where: { id: countryId } })).status).toBe('LIVE');
  });
});
