import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import request from 'supertest';
import { PrivacyService } from '../../src/privacy/privacy';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const DAY = 86_400_000;
const NOTICE = { title: 'Your privacy', body: 'We record your answers and a hashed IP address to check survey quality.\n\nWe keep them for 90 days.', privacyUrl: 'https://example.com/privacy' };

describe('Privacy: retention, consent and erasure (e2e)', () => {
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
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'privacy');
    const b = await makeOrg(prisma, 'privacy-other');
    orgId = a.org.id;
    admin = api(app, await login(app, a.users.ADMIN.email));
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.ADMIN.email));
    const clientId = (await pm.post('/clients', { name: 'Client', code: 'CL1' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Vendor', code: 'VP' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'Privacy study',
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 2, targetCompletes: 100, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    projectId = p.id;
    const countryId = p.countries[0].id;
    await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId, cpi: 1, targetCompletes: 100 }).expect(201);
    await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);
    entryCode = (await pm.get(`/projects/${projectId}`).expect(200)).body.countries[0].allocations[0].entryCode;
  });

  afterAll(async () => {
    await app.close();
  });

  const session = (uid: string) => prisma.respondentSession.findFirstOrThrow({ where: { projectId, vendorRespondentId: uid } });
  async function enter(uid: string) {
    const r = await http().get(`/s/${entryCode}?uid=${uid}`).set('X-Forwarded-For', `198.51.100.${++n}`).expect(302);
    const loc = r.headers.location as string;
    return { loc, token: loc.includes('/g/') ? decodeURIComponent(loc.split('/g/')[1]) : null };
  }
  const gate = (token: string, body: object) => http().post(`/g/${encodeURIComponent(token)}`).send(body).expect(200);

  it('saves consent notices: admin only, validated, versioned when the wording changes', async () => {
    await pm.put('/privacy/consent/*', NOTICE).expect(403);
    await viewer.put('/privacy/consent/*', NOTICE).expect(403);
    await admin.put('/privacy/consent/usa', NOTICE).expect(400);
    await admin.put('/privacy/consent/*', { ...NOTICE, body: 'Too short' }).expect(400);
    await admin.put('/privacy/consent/*', { ...NOTICE, privacyUrl: 'http://example.com/privacy' }).expect(400);

    const before = await enter('NOCONSENT');
    expect(before.token).toBeNull();
    expect(before.loc).toContain('client.example.com');

    expect((await admin.put('/privacy/consent/*', NOTICE).expect(200)).body).toMatchObject({ countryCode: '*', enabled: true, version: 1 });
    expect((await admin.put('/privacy/consent/*', { ...NOTICE, enabled: true }).expect(200)).body.version).toBe(1);
    expect((await admin.put('/privacy/consent/*', { ...NOTICE, body: `${NOTICE.body} Ask us to delete them at any time.` }).expect(200)).body.version).toBe(2);
    const list = (await viewer.get('/privacy').expect(200)).body;
    expect(list.consent).toHaveLength(1);
    expect(list.consent[0]).toMatchObject({ countryCode: '*', version: 2 });
    expect((await other.get('/privacy').expect(200)).body.consent).toHaveLength(0);
  });

  it('shows the notice first on the gate page and records the answer', async () => {
    const declined = await enter('DECLINE');
    expect(declined.token).toBeTruthy();
    const page = await http().get(`/g/${encodeURIComponent(declined.token!)}`).expect(200);
    expect(page.text).toContain('Your privacy');
    expect(page.text).toContain('I do not agree');
    expect(page.text).toContain('href="https://example.com/privacy"');
    await gate(declined.token!, { consent: false });
    expect(await session('DECLINE')).toMatchObject({ status: 'PARTIAL', statusDetail: 'CONSENT_DECLINED', consentAt: null });

    const missing = await enter('MISSING');
    await gate(missing.token!, {});
    expect(await session('MISSING')).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'GATE_INCOMPLETE' });

    const agreed = await enter('AGREE');
    const res = await gate(agreed.token!, { consent: true });
    expect(res.body.location).toContain('client.example.com');
    const s = await session('AGREE');
    expect(s.status).toBe('STARTED');
    expect(s.consentVersion).toBe(2);
    expect(s.consentAt).toBeInstanceOf(Date);

    // A market's own notice wins over "*"; switched off, that market asks for nothing.
    await admin.put('/privacy/consent/US', { ...NOTICE, enabled: false }).expect(200);
    expect((await enter('USOFF')).token).toBeNull();
    await admin.delete('/privacy/consent/US').expect(200);
    await admin.delete('/privacy/consent/US').expect(404);
    expect((await enter('USBACK')).token).toBeTruthy();
    expect((await admin.get('/privacy').expect(200)).body.totals.consented).toBe(1);
  });

  it('anonymises old sessions and deletes old events on a retention run', async () => {
    await pm.put('/privacy/retention', { respondentDays: 30, eventDays: null }).expect(403);
    await admin.put('/privacy/retention', { respondentDays: 10, eventDays: null }).expect(400);
    // Finish AGREE as a complete, then age everything.
    const agree = await session('AGREE');
    await http().get(`/r/complete?token=${agree.token}`).expect(302);
    const old = new Date(Date.now() - 40 * DAY);
    await prisma.respondentSession.updateMany({ where: { projectId }, data: { startedAt: old } });
    // Completes wait for the client's approval; once decided they can be anonymised.
    expect((await session('AGREE')).approval).toBe('PENDING');
    await prisma.respondentSession.update({ where: { id: (await session('AGREE')).id }, data: { approval: 'APPROVED' } });
    await prisma.respondentSession.update({ where: { id: (await session('MISSING')).id }, data: { approval: 'PENDING' } });
    // Abandoned (never came back) and past its expiry.
    await prisma.respondentSession.update({ where: { id: (await session('USOFF')).id }, data: { expiresAt: old } });
    const fresh = await enter('FRESH');
    await gate(fresh.token!, { consent: true });
    await http().get(`/r/complete?token=${(await session('FRESH')).token}`).expect(302);
    await prisma.respondentEvent.updateMany({ where: { session: { vendorRespondentId: 'NOCONSENT' } }, data: { createdAt: old } });

    const set = (await admin.put('/privacy/retention', { respondentDays: 30, eventDays: 35 }).expect(200)).body;
    // Finished or expired and old: DECLINE, AGREE, USOFF. In the survey: NOCONSENT, USBACK. Waiting for approval: MISSING.
    expect(set.preview).toMatchObject({ sessions: 3, waitingForApproval: 1 });
    expect(set.preview.events).toBeGreaterThan(0);

    const before = await session('AGREE');
    const run = (await admin.post('/privacy/retention/run').expect(201)).body;
    expect(run).toMatchObject({ sessions: 3 });
    expect(run.events).toBe(set.preview.events);

    const after = await prisma.respondentSession.findUniqueOrThrow({ where: { id: before.id } });
    expect(after).toMatchObject({ vendorRespondentId: `erased:${before.id}`, status: 'COMPLETE', ipHash: null, userAgent: null, consentVersion: 2 });
    expect(after.anonymizedAt).toBeInstanceOf(Date);
    expect(after.revenue?.toString()).toBe(before.revenue?.toString());
    expect(await session('MISSING')).toMatchObject({ anonymizedAt: null });
    expect(await session('USBACK')).toMatchObject({ anonymizedAt: null });
    expect(await session('NOCONSENT')).toMatchObject({ anonymizedAt: null });
    expect(await session('FRESH')).toMatchObject({ anonymizedAt: null });
    expect(await prisma.respondentEvent.count({ where: { sessionId: { in: [(await session('FRESH')).id] } } })).toBeGreaterThan(0);
    expect(await prisma.respondentEvent.count({ where: { createdAt: { lt: new Date(Date.now() - 35 * DAY) }, session: { organizationId: orgId } } })).toBe(0);

    const view = (await admin.get('/privacy').expect(200)).body;
    expect(view).toMatchObject({ retention: { respondentDays: 30, eventDays: 35 }, preview: { sessions: 0 }, totals: { anonymised: 3 } });
    expect(view.lastRunAt).toBeTruthy();

    // The daily run skips an organisation that already ran today.
    const svc = app.get(PrivacyService);
    expect((await svc.runDue()).find((r) => r.org === orgId)).toBeUndefined();
    expect((await svc.runDue(new Date(Date.now() + DAY + 120_000))).find((r) => r.org === orgId)).toBeDefined();
    expect(await prisma.auditEvent.count({ where: { organizationId: orgId, action: 'privacy.retention_run' } })).toBeGreaterThan(0);
  });

  it('finds a respondent by panel ID and erases them on request', async () => {
    await pm.get('/privacy/respondents?uid=FRESH').expect(403);
    await admin.get('/privacy/respondents').expect(400);
    const rows = (await admin.get('/privacy/respondents?uid=FRESH').expect(200)).body;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'COMPLETE', countryCode: 'US', consentVersion: 2, vendor: 'Vendor', project: { name: 'Privacy study' } });
    await other.post('/privacy/respondents/erase', { sessionIds: [rows[0].id] }).expect(404);
    await pm.post('/privacy/respondents/erase', { sessionIds: [rows[0].id] }).expect(403);
    expect((await admin.post('/privacy/respondents/erase', { sessionIds: [rows[0].id], reason: 'Request from panel' }).expect(201)).body).toEqual({ anonymised: 1 });
    expect((await admin.get('/privacy/respondents?uid=FRESH').expect(200)).body).toHaveLength(0);
    expect((await admin.post('/privacy/respondents/erase', { sessionIds: [rows[0].id] }).expect(201)).body).toEqual({ anonymised: 0 });
    const s = await prisma.respondentSession.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(s).toMatchObject({ vendorRespondentId: `erased:${rows[0].id}`, answers: null, fingerprintHash: null });
    expect(await prisma.redirectExecution.count({ where: { sessionId: s.id, NOT: { destination: '[removed]' } } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { organizationId: orgId, action: 'privacy.erase' } })).toBe(1);
  });
});
