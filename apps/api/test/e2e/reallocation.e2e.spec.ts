import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClient } from '../../src/prisma/client';
import { randomBytes } from 'crypto';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Quota reallocation suggestions (e2e)', () => {
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
  const list = () => pm.get(`/monitor/reallocation?projectId=${projectId}`).expect(200).then((r) => r.body);
  const reallocate = (moves: object[], who = pm) => who.post(`/projects/${projectId}/countries/${countryId}/reallocate`, { moves });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'realloc');
    const b = await makeOrg(prisma, 'realloc-other');
    orgId = a.org.id;
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Client', code: 'CL' }).expect(201)).body.id;
    const p = (
      await pm.post('/projects', { name: 'Tracker wave', category: 'B2C', clientId, defaults: { language: 'en', loiMinutes: 15, irPercent: 40, cpi: 5, targetCompletes: 100, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' }, countries: [{ countryCode: 'US' }] }).expect(201)
    ).body;
    projectId = p.id;
    countryId = p.countries[0].id;
    for (const [code, cpi, target] of [['FAST', 2, 40], ['SLOW', 3, 40], ['IDLE', 2.5, 10]] as const) {
      const vendorId = (await pm.post('/vendors', { name: `Panel ${code}`, code }).expect(201)).body.id;
      link[code] = (await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId, cpi, targetCompletes: target }).expect(201)).body.id;
    }
    await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
    const end = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE', fieldStartAt: '2026-10-01', fieldEndAt: end }).expect(200);
    await pm.patch(`/projects/${projectId}/countries/${countryId}/allocations/${link.IDLE}`, { status: 'PAUSED' }).expect(200);
    await completes(link.FAST, 30, 10);
    await completes(link.SLOW, 3, 50);
    await completes(link.SLOW, 2, 5);
  });
  afterAll(async () => {
    await app.close();
  });

  it('suggests moving what slow and paused links will not deliver, and the unassigned target, to the fast link', async () => {
    const [m] = await list();
    expect(m).toMatchObject({ target: 100, completes: 35, uncovered: 0, country: { countryCode: 'US' } });
    const moves = Object.fromEntries(m.moves.map((x: { fromName: string; completes: number; toName: string; reasonLabel: string }) => [x.fromName, x]));
    expect(Object.keys(moves).sort()).toEqual(['Panel IDLE', 'Panel SLOW', 'Unassigned']);
    for (const x of m.moves) expect(x.toName).toBe('Panel FAST');
    expect(moves['Panel IDLE']).toMatchObject({ completes: 10, reason: 'paused', cpiDelta: -0.5 });
    expect(moves.Unassigned).toMatchObject({ from: null, completes: 10, reasonLabel: 'Not given to any vendor' });
    expect(moves['Panel SLOW'].reason).toBe('behind');
    expect(moves['Panel SLOW'].completes).toBeGreaterThan(25);
    expect(m.links).toHaveLength(3);
  });

  it('applies moves in one go, guarding every target', async () => {
    await reallocate([{ from: link.SLOW, to: link.IDLE, completes: 5 }]).expect(400); // receiver paused
    await reallocate([{ from: link.SLOW, to: link.FAST, completes: 36 }]).expect(400); // below SLOW's 5 completes
    await reallocate([{ from: null, to: link.FAST, completes: 11 }]).expect(400); // only 10 unassigned
    await reallocate([{ from: link.SLOW, to: link.SLOW, completes: 1 }]).expect(400);
    await reallocate([{ from: link.SLOW, to: link.FAST, completes: 1 }], viewer).expect(403);
    await other.post(`/projects/${projectId}/countries/${countryId}/reallocate`, { moves: [{ from: link.SLOW, to: link.FAST, completes: 1 }] }).expect(404);

    const [m] = await list();
    const r = (await reallocate(m.moves.map((x: { from: string | null; to: string; completes: number }) => ({ from: x.from, to: x.to, completes: x.completes }))).expect(200)).body;
    const t = Object.fromEntries((await prisma.vendorAllocation.findMany({ where: { projectCountryId: countryId } })).map((a) => [a.id, a.targetCompletes]));
    const moved = m.moves.reduce((s: number, x: { completes: number }) => s + x.completes, 0);
    expect(t[link.FAST]).toBe(40 + moved);
    expect(t[link.IDLE]).toBe(0);
    expect(t[link.SLOW] + t[link.FAST] + t[link.IDLE]).toBe(100);
    expect(r.changed).toHaveLength(3);
    expect(await prisma.auditEvent.count({ where: { action: 'allocation.reallocate' } })).toBe(1);
    // Nothing left to suggest.
    expect(await list()).toEqual([]);
  });

  it('only shows the organisation its own markets', async () => {
    await other.get(`/monitor/reallocation?projectId=${projectId}`).expect(404);
    expect((await other.get('/monitor/reallocation').expect(200)).body).toEqual([]);
    expect((await viewer.get('/monitor/reallocation').expect(200)).body).toEqual([]);
  });
});
