import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClient } from '../../src/prisma/client';
import { randomBytes } from 'crypto';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Vendor auto-routing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let orgId: string;
  let projectId: string;
  let countryId: string;
  const link: Record<string, string> = {};
  let n = 0;

  async function completes(allocationId: string, count: number, hoursAgo: number) {
    const started = new Date(Date.now() - hoursAgo * 3_600_000);
    const data: Prisma.RespondentSessionCreateManyInput[] = Array.from({ length: count }, () => ({
      organizationId: orgId, projectId, projectCountryId: countryId, vendorAllocationId: allocationId,
      token: randomBytes(12).toString('hex'), vendorRespondentId: `R${++n}`, status: 'COMPLETE', startedAt: started,
      outcomeAt: new Date(started.getTime() + 15 * 60_000), expiresAt: new Date(started.getTime() + 86_400_000),
    }));
    await prisma.respondentSession.createMany({ data });
    await prisma.vendorAllocation.update({ where: { id: allocationId }, data: { completes: { increment: count } } });
  }
  const view = (who = pm) => who.get(`/projects/${projectId}/routing`).expect(200).then((r) => r.body);
  const targets = async () => Object.fromEntries((await prisma.vendorAllocation.findMany({ where: { projectCountryId: countryId } })).map((a) => [a.id, a.targetCompletes]));

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'routing');
    const b = await makeOrg(prisma, 'routing-other');
    orgId = a.org.id;
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Client', code: 'CL' }).expect(201)).body.id;
    const p = (
      await pm.post('/projects', { name: 'Routing wave', category: 'B2C', clientId, defaults: { language: 'en', loiMinutes: 15, irPercent: 40, cpi: 5, targetCompletes: 120, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' }, countries: [{ countryCode: 'US' }] }).expect(201)
    ).body;
    projectId = p.id;
    countryId = p.countries[0].id;
    for (const [code, cpi, target] of [['FAST', 2, 40], ['SLOW', 3, 40], ['IDLE', 2.5, 20], ['DEAR', 5, 20]] as const) {
      const vendorId = (await pm.post('/vendors', { name: `Panel ${code}`, code }).expect(201)).body.id;
      link[code] = (await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId, cpi, targetCompletes: target }).expect(201)).body.id;
    }
    await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
    const end = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE', fieldStartAt: '2026-10-01', fieldEndAt: end }).expect(200);
    await pm.patch(`/projects/${projectId}/countries/${countryId}/allocations/${link.IDLE}`, { status: 'PAUSED' }).expect(200);
    await completes(link.FAST, 30, 10);
    await completes(link.DEAR, 15, 10);
    await completes(link.SLOW, 3, 50);
    await completes(link.SLOW, 2, 5);
  });
  afterAll(async () => {
    await app.close();
  });

  it('plans routing with every number behind it, even before it is switched on', async () => {
    const v = await view();
    expect(v.settings).toMatchObject({ enabled: false, mode: 'approve', weights: { score: 50, cost: 30, room: 20 }, minScore: 55, keepMargin: true });
    const [m] = v.markets;
    expect(m.country).toMatchObject({ countryCode: 'US', cpi: 5 });
    // DEAR pays 5, the same as a client CPI of 5: never a receiver while "keep margin" is on.
    expect(m.skipped).toEqual([expect.objectContaining({ id: link.DEAR, why: expect.stringContaining('at or above the client CPI') })]);
    expect(m.ranking[0]).toMatchObject({ id: link.FAST, rank: 1, marginPct: 60 });
    expect(m.moves.length).toBeGreaterThan(0);
    for (const x of m.moves) expect(x).toMatchObject({ to: link.FAST, toName: 'Panel FAST', because: expect.stringContaining('Rank 1') });
    expect(m.key).toBe(m.moves.map((x: { from: string | null; to: string; completes: number }) => `${x.from ?? '-'}>${x.to}=${x.completes}`).join(','));
    expect(v.runs).toEqual([]);
  });

  it('routes the plan by hand, then undoes it', async () => {
    const before = await targets();
    const [m] = (await view()).markets;
    const url = `/projects/${projectId}/countries/${countryId}/route`;
    await viewer.post(url, { key: m.key }).expect(403);
    await other.post(url, { key: m.key }).expect(404);
    await pm.post(url, { key: 'stale' }).expect(409);
    const r = (await pm.post(url, { key: m.key }).expect(200)).body;
    expect(r.summary).toMatch(/^.+ US: Route \d+ completes: \d+ to Panel FAST/);
    const after = await targets();
    const moved = m.moves.reduce((t: number, x: { completes: number }) => t + x.completes, 0);
    expect(after[link.FAST]).toBe(before[link.FAST] + moved);

    const [run] = (await view()).runs;
    expect(run).toMatchObject({ id: r.id, trigger: 'manual', undoneAt: null, explanation: { ranking: expect.any(Array), settings: expect.objectContaining({ minScore: 55 }) } });
    expect(await prisma.auditEvent.count({ where: { action: 'allocation.route' } })).toBe(1);

    await viewer.post(`/projects/${projectId}/routing/runs/${run.id}/undo`).expect(403);
    const u = (await pm.post(`/projects/${projectId}/routing/runs/${run.id}/undo`).expect(200)).body;
    expect(u.restored.length).toBe(r.changed.length);
    expect(await targets()).toEqual(before);
    await pm.post(`/projects/${projectId}/routing/runs/${run.id}/undo`).expect(400);
    expect((await view()).runs[0]).toMatchObject({ undoneAt: expect.any(String), undoneBy: expect.any(String) });
  });

  it('refuses an undo when a target changed since the run', async () => {
    const [m] = (await view()).markets;
    const r = (await pm.post(`/projects/${projectId}/countries/${countryId}/route`, { key: m.key }).expect(200)).body;
    await prisma.vendorAllocation.update({ where: { id: link.FAST }, data: { targetCompletes: { increment: 1 } } });
    const res = await pm.post(`/projects/${projectId}/routing/runs/${r.id}/undo`).expect(409);
    expect(res.body.message).toContain("Panel FAST's target changed since this run");
    await prisma.vendorAllocation.update({ where: { id: link.FAST }, data: { targetCompletes: { decrement: 1 } } });
    await pm.post(`/projects/${projectId}/routing/runs/${r.id}/undo`).expect(200);
  });

  it('in auto mode the monitor routes on its own, then waits out the cooldown', async () => {
    const before = await targets();
    await pm.patch(`/projects/${projectId}`, { autopilot: { autoRoute: { enabled: true, mode: 'auto', maxMovePercent: 100, cooldownHours: 6 } } }).expect(200);
    // The undo a moment ago counts towards the cooldown, so the monitor leaves the market alone.
    let res = (await pm.post('/monitor/run').expect(201)).body;
    expect(res.actions.filter((a: string) => a.includes('Route '))).toEqual([]);
    expect((await view()).markets[0].cooldownUntil).toEqual(expect.any(String));
    await prisma.routingRun.updateMany({ where: { projectId }, data: { createdAt: new Date(Date.now() - 7 * 3_600_000), undoneAt: new Date(Date.now() - 7 * 3_600_000) } });

    res = (await pm.post('/monitor/run').expect(201)).body;
    expect(res.actions).toEqual(expect.arrayContaining([expect.stringMatching(/US: Route \d+ completes: \d+ to Panel FAST/)]));
    const run = await prisma.routingRun.findFirstOrThrow({ where: { projectId, trigger: 'auto' } });
    expect(run.actorId).toBeNull();
    expect((await targets())[link.FAST]).toBeGreaterThan(before[link.FAST]);
    expect(await prisma.auditEvent.count({ where: { action: 'autopilot.route' } })).toBe(1);
    expect((await view()).runs[0]).toMatchObject({ trigger: 'auto', by: 'SampTrek autopilot' });

    // Nothing more to route, and the cooldown would stop it anyway.
    res = (await pm.post('/monitor/run').expect(201)).body;
    expect(await prisma.routingRun.count({ where: { projectId, trigger: 'auto' } })).toBe(1);
  });

  it('only shows the organisation its own projects', async () => {
    await other.get(`/projects/${projectId}/routing`).expect(404);
    await other.post(`/projects/${projectId}/routing/runs/x/undo`).expect(404);
    expect((await view(viewer)).settings.enabled).toBe(true);
  });
});
