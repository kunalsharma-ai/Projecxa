import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Client and vendor portals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let vendorA: ReturnType<typeof api>;
  let vendorB: ReturnType<typeof api>;
  let client1: ReturnType<typeof api>;
  let client2: ReturnType<typeof api>;
  let otherOrgPm: ReturnType<typeof api>;
  let projectId: string;
  let draftProjectId: string;
  let vA: string;
  let vB: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'portal-a');
    const b = await makeOrg(prisma, 'portal-b');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    otherOrgPm = api(app, await login(app, b.users.PROJECT_MANAGER.email));

    const c1 = (await pm.post('/clients', { name: 'Client One', code: 'C1' }).expect(201)).body.id;
    const c2 = (await pm.post('/clients', { name: 'Client Two', code: 'C2' }).expect(201)).body.id;
    vA = (await pm.post('/vendors', { name: 'Vendor A', code: 'VA' }).expect(201)).body.id;
    vB = (await pm.post('/vendors', { name: 'Vendor B', code: 'VB' }).expect(201)).body.id;

    const pw = 'portal-password-123';
    await pm.post('/portal-users', { kind: 'vendor', partyId: vA, name: 'A user', email: 'a@vendor.test', password: pw }).expect(201);
    await pm.post('/portal-users', { kind: 'vendor', partyId: vB, name: 'B user', email: 'b@vendor.test', password: pw }).expect(201);
    await pm.post('/portal-users', { kind: 'client', partyId: c1, name: 'C1 user', email: 'one@client.test', password: pw }).expect(201);
    await pm.post('/portal-users', { kind: 'client', partyId: c2, name: 'C2 user', email: 'two@client.test', password: pw }).expect(201);
    // A PM from another tenant cannot attach users to this tenant's vendor.
    await otherOrgPm.post('/portal-users', { kind: 'vendor', partyId: vA, name: 'x', email: 'x@x.test', password: pw }).expect(400);

    const tok = async (email: string) =>
      (await http().post('/api/v1/auth/login').send({ email, password: pw }).expect(200)).body as { token: string; home: string };
    const la = await tok('a@vendor.test');
    expect(la.home).toBe('/portal/vendor');
    expect((await tok('one@client.test')).home).toBe('/portal/client');
    vendorA = api(app, la.token);
    vendorB = api(app, (await tok('b@vendor.test')).token);
    client1 = api(app, (await tok('one@client.test')).token);
    client2 = api(app, (await tok('two@client.test')).token);

    // Live project for client 1 with both vendors in US
    const p = (
      await pm
        .post('/projects', {
          name: 'Portal study',
          category: 'B2B',
          clientId: c1,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 9, targetCompletes: 10, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    projectId = p.id;
    const countryId = p.countries[0].id;
    for (const v of [vA, vB]) await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId: v, cpi: 2.5, targetCompletes: 5 }).expect(201);
    await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);

    // A draft project for client 1 that portals must not see
    draftProjectId = (
      await pm.post('/projects', { name: 'Draft', category: 'B2B', clientId: c1, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 9, targetCompletes: 10 }, countries: [{ countryCode: 'GB' }] }).expect(201)
    ).body.id;

    // Two completes from vendor A, one terminate from vendor B
    const detail = (await pm.get(`/projects/${projectId}`).expect(200)).body;
    const allocs = detail.countries[0].allocations as { vendorId: string; entryCode: string }[];
    const run = async (vendorId: string, uid: string, status: string) => {
      const code = allocs.find((x) => x.vendorId === vendorId)!.entryCode;
      const entry = await http().get(`/s/${code}?uid=${uid}`).expect(302);
      const token = new URL(entry.headers.location).searchParams.get('rid')!;
      await http().get(`/r/${status}?token=${token}`).expect(302);
    };
    await run(vA, 'A-1', 'complete');
    await run(vA, 'A-2', 'complete');
    await run(vB, 'B-1', 'terminate');
  });

  afterAll(async () => {
    await app.close();
  });

  it('portal users cannot use staff endpoints', async () => {
    await vendorA.get('/projects').expect(403);
    await vendorA.get('/vendors').expect(403);
    await client1.get('/clients').expect(403);
    await client1.get(`/projects/${projectId}`).expect(403);
    await client1.post(`/projects/${projectId}/sessions/approval`, { sessionIds: ['x'], approval: 'APPROVED' }).expect(403);
    await vendorA.get('/portal/client/projects').expect(403);
    await client1.get('/portal/vendor/allocations').expect(403);
    await vendorA.get('/auth/me').expect(200);
  });

  it('vendor sees only its own allocations, payout and respondents', async () => {
    const allocs = (await vendorA.get('/portal/vendor/allocations').expect(200)).body;
    expect(allocs).toHaveLength(1);
    expect(allocs[0]).toMatchObject({ countryCode: 'US', completes: 2, accepting: true });
    expect(Number(allocs[0].cpi)).toBe(2.5);
    expect(JSON.stringify(allocs)).not.toMatch(/Client One|"revenue"/);

    const sessions = (await vendorA.get('/portal/vendor/sessions').expect(200)).body;
    expect(sessions.map((s: { vendorRespondentId: string }) => s.vendorRespondentId).sort()).toEqual(['A-1', 'A-2']);
    expect(sessions[0]).not.toHaveProperty('revenue');
    expect(sessions[0]).not.toHaveProperty('token');

    const b = (await vendorB.get('/portal/vendor/sessions').expect(200)).body;
    expect(b.map((s: { vendorRespondentId: string }) => s.vendorRespondentId)).toEqual(['B-1']);
    await vendorB.get(`/portal/vendor/sessions?allocationId=${allocs[0].id}`).expect(404);

    const summary = (await vendorA.get('/portal/vendor/summary').expect(200)).body;
    expect(summary).toMatchObject({ clicks: 2, liveAllocations: 1 });
    expect(summary.payout.pending).toEqual({ completes: 2, payout: 5 });
  });

  it('client sees only its own non-draft projects, without vendor data', async () => {
    const list = (await client1.get('/portal/client/projects').expect(200)).body;
    expect(list.map((p: { id: string }) => p.id)).toEqual([projectId]);
    expect(list[0]).toMatchObject({ completes: 2, pendingApprovals: 2 });
    await client1.get(`/portal/client/projects/${draftProjectId}`).expect(404);
    expect((await client2.get('/portal/client/projects').expect(200)).body).toEqual([]);
    await client2.get(`/portal/client/projects/${projectId}`).expect(404);

    const detail = (await client1.get(`/portal/client/projects/${projectId}`).expect(200)).body;
    expect(detail.stats).toMatchObject({ completes: 2, terminates: 1 });
    expect(detail.spend.PENDING).toEqual({ completes: 2, amount: 18 });
    const text = JSON.stringify(detail);
    expect(text).not.toMatch(/Vendor A|Vendor B|payout|A-1/);

    const completes = (await client1.get(`/portal/client/projects/${projectId}/completes`).expect(200)).body;
    expect(completes).toHaveLength(2);
    expect(completes[0]).toHaveProperty('token');
    // Session tokens are random base64url and can contain "a-1" by chance, so check everything but the token.
    expect(JSON.stringify(completes.map(({ token: _t, ...rest }: { token: string }) => rest))).not.toMatch(/A-1|A-2|payout|vendor/i);
  });

  it('client approves and rejects pending completes once; another client cannot', async () => {
    const completes = (await client1.get(`/portal/client/projects/${projectId}/completes`).expect(200)).body as { id: string }[];
    const [first, second] = completes.map((c) => c.id);
    await client2.post(`/portal/client/projects/${projectId}/approval`, { sessionIds: [first], approval: 'REJECTED' }).expect(404);

    const r1 = (await client1.post(`/portal/client/projects/${projectId}/approval`, { sessionIds: [first], approval: 'APPROVED' }).expect(201)).body;
    expect(r1).toEqual({ updated: 1, skipped: 0 });
    // Already decided: a second decision is skipped
    const r2 = (await client1.post(`/portal/client/projects/${projectId}/approval`, { sessionIds: [first, second], approval: 'REJECTED' }).expect(201)).body;
    expect(r2).toEqual({ updated: 1, skipped: 1 });

    const summary = (await vendorA.get('/portal/vendor/summary').expect(200)).body;
    expect(summary.payout.approved).toEqual({ completes: 1, payout: 2.5 });
    expect(summary.payout.rejected).toEqual({ completes: 1, payout: 2.5 });
    expect(await prisma.auditEvent.count({ where: { action: { startsWith: 'client-portal.' } } })).toBe(2);
  });

  it('deactivated portal users are locked out immediately', async () => {
    const users = (await pm.get('/portal-users').expect(200)).body as { id: string; email: string }[];
    const b = users.find((u) => u.email === 'b@vendor.test')!;
    await pm.patch(`/portal-users/${b.id}`, { active: false }).expect(200);
    await vendorB.get('/portal/vendor/summary').expect(401);
    await otherOrgPm.patch(`/portal-users/${b.id}`, { active: true }).expect(404);
  });

  it('staff user list excludes portal users', async () => {
    const staff = (await pm.get('/users').expect(200)).body as { role: string }[];
    expect(staff.every((s) => !['CLIENT_USER', 'VENDOR_USER'].includes(s.role))).toBe(true);
  });
});
