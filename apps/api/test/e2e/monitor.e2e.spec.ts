import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient, RespondentStatus } from '@prisma/client';
import { createHmac, randomBytes } from 'crypto';
import { MonitorService } from '../../src/monitor/monitor.service';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Fieldwork monitor and autopilot (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let orgId: string;
  let projectId: string;
  let countryId: string;
  let allocA: string;
  let allocB: string;
  let n = 0;
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];

  /** Synthetic sessions straight into the database, with chosen times and outcomes. */
  async function sessions(allocationId: string, status: RespondentStatus, count: number, hoursAgo: number, loiMinutes = 14) {
    const started = new Date(Date.now() - hoursAgo * 3_600_000);
    const data: Prisma.RespondentSessionCreateManyInput[] = [];
    for (let i = 0; i < count; i++) {
      data.push({
        organizationId: orgId, projectId, projectCountryId: countryId, vendorAllocationId: allocationId,
        token: randomBytes(12).toString('hex'), vendorRespondentId: `M${++n}`, status, startedAt: started,
        outcomeAt: status === 'STARTED' ? null : new Date(started.getTime() + loiMinutes * 60_000),
        expiresAt: new Date(started.getTime() + 86_400_000),
      });
    }
    await prisma.respondentSession.createMany({ data });
  }
  const run = () => pm.post('/monitor/run').expect(201).then((r) => r.body);
  const active = () => pm.get('/alerts').expect(200).then((r) => r.body as { id: string; rule: string; state: string; autoAction: string | null; vendorAllocationId: string | null; webhookStatus: string | null }[]);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'mon');
    const b = await makeOrg(prisma, 'mon-other');
    orgId = a.org.id;
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    admin = api(app, await login(app, a.users.ADMIN.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Client', code: 'CL' }).expect(201)).body.id;
    const vA = (await pm.post('/vendors', { name: 'Panel Alpha', code: 'PA' }).expect(201)).body.id;
    const vB = (await pm.post('/vendors', { name: 'Panel Beta', code: 'PB' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'Monitored study',
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 15, irPercent: 40, cpi: 5, targetCompletes: 50, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    projectId = p.id;
    countryId = p.countries[0].id;
    await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId: vA, cpi: 2, targetCompletes: 5 }).expect(201);
    await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId: vB, cpi: 2, targetCompletes: 45 }).expect(201);
    await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);
    const allocs = (await pm.get(`/projects/${projectId}`).expect(200)).body.countries[0].allocations;
    allocA = allocs.find((x: { vendorId: string }) => x.vendorId === vA).id;
    allocB = allocs.find((x: { vendorId: string }) => x.vendorId === vB).id;
    app.get(MonitorService).fetcher = async (url, init) => {
      sent.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      return { status: 202 };
    };
  });

  afterAll(async () => {
    await app.close();
  });

  it('validates field dates and autopilot settings on the project', async () => {
    await pm.patch(`/projects/${projectId}`, { fieldStartAt: '2026-11-10', fieldEndAt: '2026-11-01' }).expect(400);
    await pm.patch(`/projects/${projectId}`, { autopilot: { pauseOnQuality: true, nuke: true } }).expect(400);
    const end = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const r = (await pm.patch(`/projects/${projectId}`, { fieldStartAt: '2026-10-01', fieldEndAt: end, autopilot: { pauseOnQuality: true, closeOnTarget: true } }).expect(200)).body;
    expect(r.fieldEndAt).toBe(`${end}T23:59:59.999Z`);
    expect(r.autopilot).toEqual({ pauseOnQuality: true, closeOnTarget: true });
  });

  it('shows live markets with pace before any traffic', async () => {
    const v = (await pm.get('/monitor').expect(200)).body;
    expect(v.markets).toHaveLength(1);
    expect(v.markets[0]).toMatchObject({ country: { countryCode: 'US' }, pace: { status: 'not_started', remaining: 50 }, ir: null });
    expect(v.markets[0].allocations.map((a: { vendor: { name: string } }) => a.vendor.name)).toEqual(['Panel Alpha', 'Panel Beta']);
    expect(v.settings.qualityPct).toBe(25);
    await other.get(`/monitor?projectId=${projectId}`).expect(404);
  });

  it('opens alerts, takes autopilot actions and notifies the signed webhook', async () => {
    const saved = (await admin.put('/organization/alert-settings').send({ webhookUrl: 'https://hooks.example.com/projexa' }).expect(200)).body;
    expect(saved.secret).toEqual(expect.any(String));
    expect(saved.hasSecret).toBe(true);
    const secret = saved.secret as string;

    // Alpha: delivered its target of 5. Beta: low incidence, speeders and a security spike.
    await sessions(allocA, 'COMPLETE', 5, 30);
    await sessions(allocB, 'COMPLETE', 10, 30, 4);
    await sessions(allocB, 'TERMINATE', 40, 30);
    await sessions(allocB, 'SECURITY_REJECT', 12, 2);
    await sessions(allocB, 'TERMINATE', 18, 2);

    const r = await run();
    expect(r.actions).toEqual(expect.arrayContaining([expect.stringMatching(/^Paused Panel Beta in US/), expect.stringMatching(/^Closed Panel Alpha in US/)]));
    const rules = (await active()).map((a) => a.rule).sort();
    expect(rules).toEqual(['behind_pace', 'loi_short', 'low_ir', 'quality_spike', 'target_reached']);
    const spike = (await active()).find((a) => a.rule === 'quality_spike')!;
    expect(spike).toMatchObject({ vendorAllocationId: allocB, autoAction: expect.stringContaining('Paused Panel Beta'), webhookStatus: '202' });

    const allocs = (await pm.get(`/projects/${projectId}`).expect(200)).body.countries[0].allocations;
    expect(allocs.find((a: { id: string }) => a.id === allocA).status).toBe('CLOSED');
    expect(allocs.find((a: { id: string }) => a.id === allocB).status).toBe('PAUSED');
    expect(await prisma.auditEvent.count({ where: { action: { startsWith: 'autopilot.' }, entityId: projectId } })).toBe(2);

    expect(sent).toHaveLength(5);
    const h = sent[0].headers;
    expect(h['X-Projexa-Signature']).toBe(`sha256=${createHmac('sha256', secret).update(`${h['X-Projexa-Timestamp']}.${sent[0].body}`).digest('hex')}`);
    expect(JSON.parse(sent[0].body)).toMatchObject({ event: 'alert.opened', alert: { title: expect.any(String) } });

    const insights = (await pm.get('/insights').expect(200)).body;
    expect(insights.items.some((i: { id: string; href: string }) => i.id.startsWith('alert-') && i.href === '/monitor')).toBe(true);
  });

  it('a second check refreshes alerts instead of duplicating them', async () => {
    const before = await prisma.alert.count();
    const r = await run();
    expect(r).toMatchObject({ opened: 0, resolved: 0, actions: [] });
    expect(await prisma.alert.count()).toBe(before);
    expect(sent).toHaveLength(5);
  });

  it('acknowledge and resolve need an editor in the same organisation', async () => {
    const [first] = await active();
    await viewer.post(`/alerts/${first.id}/acknowledge`).expect(403);
    await other.post(`/alerts/${first.id}/acknowledge`).expect(400);
    await pm.post(`/alerts/${first.id}/acknowledge`).expect(201);
    await pm.post(`/alerts/${first.id}/acknowledge`).expect(400);
    expect((await active()).find((a) => a.id === first.id)!.state).toBe('ACKNOWLEDGED');
    await pm.post(`/alerts/${first.id}/resolve`).expect(201);
    const resolved = (await pm.get('/alerts?state=RESOLVED').expect(200)).body;
    expect(resolved[0]).toMatchObject({ id: first.id, resolvedByName: 'PROJECT_MANAGER' });
    expect((await other.get('/alerts').expect(200)).body).toEqual([]);
  });

  it('alerts resolve themselves once the condition clears', async () => {
    await prisma.respondentSession.deleteMany({ where: { vendorAllocationId: allocB, status: { in: ['SECURITY_REJECT', 'TERMINATE'] } } });
    await prisma.respondentSession.updateMany({ where: { vendorAllocationId: allocB }, data: { outcomeAt: new Date(Date.now() - 29 * 3_600_000) } });
    await pm.patch(`/projects/${projectId}`, { fieldEndAt: null }).expect(200);
    const r = await run();
    expect(r.resolved).toBeGreaterThanOrEqual(3);
    const rules = (await active()).map((a) => a.rule);
    expect(rules).not.toContain('quality_spike');
    expect(rules).not.toContain('low_ir');
    expect(rules).not.toContain('behind_pace');
    const auto = (await pm.get('/alerts?state=RESOLVED').expect(200)).body.find((a: { rule: string }) => a.rule === 'low_ir');
    expect(auto.resolvedByName).toBe('Cleared by itself');
  });

  it('alert settings: admins only, validated, secret shown once and rotatable, test delivery', async () => {
    await pm.get('/organization/alert-settings').expect(403);
    await admin.put('/organization/alert-settings').send({ settings: { qualityPct: 2 } }).expect(400);
    await admin.put('/organization/alert-settings').send({ webhookUrl: 'ftp://x.example.com' }).expect(400);
    const s = (await admin.put('/organization/alert-settings').send({ settings: { stalledHours: 6, irDropPct: 20, loiShortPct: 40, loiLongPct: 150, qualityPct: 30, dropOffPct: 30, quotaNearPct: 85, minSample: 10 } }).expect(200)).body;
    expect(s).toMatchObject({ settings: { stalledHours: 6, quotaNearPct: 85 }, hasSecret: true, webhookUrl: 'https://hooks.example.com/projexa' });
    expect(s.secret).toBeUndefined();
    const rot = (await admin.post('/organization/alert-settings/rotate-secret').expect(201)).body;
    expect(rot.secret).toEqual(expect.any(String));
    expect((await admin.post('/organization/alert-settings/test').expect(201)).body).toEqual({ status: '202' });
    expect(JSON.parse(sent.at(-1)!.body).event).toBe('alert.test');
    const off = (await admin.put('/organization/alert-settings').send({ webhookUrl: null }).expect(200)).body;
    expect(off).toMatchObject({ webhookUrl: null, hasSecret: false });
    await admin.post('/organization/alert-settings/test').expect(400);
  });

  it('a stalled market is flagged with the configured hours', async () => {
    await pm.patch(`/projects/${projectId}/countries/${countryId}/allocations/${allocB}`, { status: 'ACTIVE' }).expect(200);
    await prisma.respondentSession.updateMany({ where: { projectId }, data: { startedAt: new Date(Date.now() - 8 * 3_600_000) } });
    await run();
    expect((await active()).map((a) => a.rule)).toContain('stalled');
  });
});
