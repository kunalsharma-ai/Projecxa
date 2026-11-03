import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MailService } from '../../src/mail/mail.service';
import { humanChallenge } from '../../src/survey/captcha';
import { config } from '../../src/common/config';
import { checkChallenge, newChallenge, signupLimiter } from '../../src/vendor-signup/vendor-signup';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

/** Solves the sign-up check the way a person would: by reading the question. */
function solve(question: string) {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const m = /What is (\w+) (plus|minus) (\w+)\?/.exec(question)!;
  const a = words.indexOf(m[1]);
  const b = words.indexOf(m[3]);
  return String(m[2] === 'plus' ? a + b : a - b);
}

describe('Vendor sign-up and quote requests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let otherOrg: ReturnType<typeof api>;
  let orgId: string;
  let projectId: string;
  let countryId: string;
  const sent: { to: string[]; subject: string; text?: string }[] = [];
  const http = () => request(app.getHttpServer());
  const realNow = Date.now;

  /** Fetches the form and fills the check, pretending the person spent 10 s on it. */
  async function form(token: string) {
    const f = await http().get(`/api/v1/public/vendor-signup/${token}`).expect(200);
    return { challenge: f.body.challenge.token as string, answer: solve(f.body.challenge.question), body: f.body };
  }
  const later = async <T,>(fn: () => Promise<T>) => {
    Date.now = () => realNow() + 10_000;
    try {
      return await fn();
    } finally {
      Date.now = realNow;
    }
  };
  const application = (over: Record<string, unknown> = {}) => ({
    companyName: 'Nordic Panels AB',
    website: 'https://nordicpanels.example.com',
    contactName: 'Ingrid Berg',
    email: 'Ingrid@NordicPanels.example.com',
    countries: ['SE', 'NO', 'DK', 'SE'],
    panelSize: 120000,
    specialties: ['B2C', 'HEALTHCARE'],
    message: 'Double opt-in panel, ISO 20252.',
    ...over,
  });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'signup-a');
    const b = await makeOrg(prisma, 'signup-b');
    orgId = a.org.id;
    admin = api(app, await login(app, a.users.ADMIN.email));
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    otherOrg = api(app, await login(app, b.users.ADMIN.email));
    app.get(MailService).transport = async (_from, m) => {
      sent.push({ to: m.to, subject: m.subject, text: m.text });
      return { messageId: 'x' };
    };
    const clientId = (await pm.post('/clients', { name: 'Quote client', code: 'QC' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'Quotes study',
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 15, irPercent: 40, cpi: 6, targetCompletes: 300, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'SE', currency: 'EUR' }],
        })
        .expect(201)
    ).body;
    projectId = p.id;
    countryId = p.countries[0].id;
  });

  afterAll(async () => {
    Date.now = realNow;
    await app.close();
  });

  it('the sign-up check is signed, expires, and refuses instant submissions', () => {
    const c = newChallenge('org1', 1_000_000);
    const answer = humanChallenge('math', `${config.jwtSecret}:vendor-signup`, `org1:${c.token.split('.')[0]}`, 0).answer!;
    expect(checkChallenge('org1', c.token, answer, 1_000_500)).toMatch(/moment/);
    expect(checkChallenge('org1', c.token, answer, 1_010_000)).toBeNull();
    expect(checkChallenge('org1', c.token, '999', 1_010_000)).toMatch(/not right/);
    expect(checkChallenge('org2', c.token, answer, 1_010_000)).toMatch(/expired/);
    expect(checkChallenge('org1', c.token.replace(/.$/, (x) => (x === 'a' ? 'b' : 'a')), answer, 1_010_000)).toMatch(/expired/);
    expect(checkChallenge('org1', c.token, answer, 1_000_000 + 31 * 60_000)).toMatch(/expired/);
  });

  it('admins turn the sign-up link on and off; only a live link works', async () => {
    await http().get('/api/v1/public/vendor-signup/not-a-real-token-123456').expect(404);
    await pm.put('/vendor-applications/link').expect(403);
    expect((await pm.get('/vendor-applications/link').expect(200)).body).toEqual({ enabled: false, url: null });
    const on = (await admin.put('/vendor-applications/link').expect(200)).body;
    expect(on.url).toMatch(/\/join\/[A-Za-z0-9_-]{20,}$/);
    const token = on.url.split('/join/')[1];
    const f = await form(token);
    expect(f.body).toMatchObject({ organization: 'signup-a', specialties: expect.arrayContaining(['B2B', 'HEALTHCARE']) });
    expect(JSON.stringify(f.body)).not.toMatch(/answer/);
    await admin.delete('/vendor-applications/link').expect(200);
    await http().get(`/api/v1/public/vendor-signup/${token}`).expect(404);
  });

  it('a panel company applies; bots and repeats are filtered; staff see and approve it', async () => {
    signupLimiter.reset();
    const token = (await admin.put('/vendor-applications/link').expect(200)).body.url.split('/join/')[1];
    const f = await form(token);
    // Too fast, wrong answer, honeypot, bad data
    await http().post(`/api/v1/public/vendor-signup/${token}`).send({ ...application(), challenge: f.challenge, answer: f.answer }).expect(400);
    await later(() => http().post(`/api/v1/public/vendor-signup/${token}`).send({ ...application(), challenge: f.challenge, answer: '999' }).expect(400));
    await later(() => http().post(`/api/v1/public/vendor-signup/${token}`).send({ ...application({ countries: ['Sweden'] }), challenge: f.challenge, answer: f.answer }).expect(400));
    await later(() => http().post(`/api/v1/public/vendor-signup/${token}`).send({ ...application({ website: 'javascript:alert(1)' }), challenge: f.challenge, answer: f.answer }).expect(400));
    await later(() => http().post(`/api/v1/public/vendor-signup/${token}`).send({ ...application({ companyName: 'Bot Co' }), homepage: 'http://spam', challenge: f.challenge, answer: f.answer }).expect(201));
    const ok = await later(() => http().post(`/api/v1/public/vendor-signup/${token}`).send({ ...application(), challenge: f.challenge, answer: f.answer }).expect(201));
    expect(ok.body).toEqual({ ok: true });
    // The same email again while pending is accepted quietly but not stored twice.
    await later(() => http().post(`/api/v1/public/vendor-signup/${token}`).send({ ...application({ companyName: 'Nordic Panels' }), challenge: f.challenge, answer: f.answer }).expect(201));
    // Five per network per hour.
    await later(() => http().post(`/api/v1/public/vendor-signup/${token}`).send({ ...application(), challenge: f.challenge, answer: f.answer }).expect(429));
    expect(sent).toEqual([]);

    const list = (await viewer.get('/vendor-applications?status=PENDING').expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ companyName: 'Nordic Panels AB', email: 'ingrid@nordicpanels.example.com', countries: ['SE', 'NO', 'DK'], panelSize: 120000, status: 'PENDING', similarVendor: null });
    expect(list[0].ipHash).toBeUndefined();
    expect((await otherOrg.get('/vendor-applications').expect(200)).body).toEqual([]);
    const bell = (await pm.get('/insights').expect(200)).body.items.find((i: { id: string }) => i.id === 'vendor-applications');
    expect(bell.title).toBe('1 vendor application to review');

    await viewer.post(`/vendor-applications/${list[0].id}/approve`, { code: 'NORD' }).expect(403);
    await otherOrg.post(`/vendor-applications/${list[0].id}/approve`, { code: 'NORD' }).expect(404);
    await pm.post(`/vendor-applications/${list[0].id}/approve`, { code: 'no spaces!' }).expect(400);
    const approved = await pm.post(`/vendor-applications/${list[0].id}/approve`, { code: 'nord' }).expect(201);
    expect(approved.body.vendor).toMatchObject({ name: 'Nordic Panels AB', code: 'NORD' });
    expect(approved.body.invite).toMatchObject({ emailed: true, inviteUrl: expect.stringContaining('/set-password?token=') });
    expect(sent.at(-1)!.to).toEqual(['ingrid@nordicpanels.example.com']);
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: approved.body.vendor.id }, include: { capacity: true, users: true } });
    expect(vendor.capacity.map((c) => c.countryCode).sort()).toEqual(['DK', 'NO', 'SE']);
    expect(vendor.users[0]).toMatchObject({ role: 'VENDOR_USER', email: 'ingrid@nordicpanels.example.com', name: 'Ingrid Berg' });
    expect(vendor.redirectAllowedDomains).toEqual([]);
    await pm.post(`/vendor-applications/${list[0].id}/approve`, { code: 'NORD2' }).expect(400);
    await pm.post(`/vendor-applications/${list[0].id}/reject`, {}).expect(400);
  });

  it('staff reject an application with a reason', async () => {
    signupLimiter.reset();
    const token = (await admin.get('/vendor-applications/link').expect(200)).body.url.split('/join/')[1];
    const f = await form(token);
    await later(() => http().post(`/api/v1/public/vendor-signup/${token}`).send({ ...application({ companyName: 'Clickfarm Ltd', email: 'x@clickfarm.example.com' }), challenge: f.challenge, answer: f.answer }).expect(201));
    const a = (await pm.get('/vendor-applications?status=PENDING').expect(200)).body[0];
    expect(a.sameNetwork).toBe(1);
    await pm.post(`/vendor-applications/${a.id}/reject`, { reason: 'No ISO certification' }).expect(201);
    expect((await pm.get('/vendor-applications?status=REJECTED').expect(200)).body[0]).toMatchObject({ companyName: 'Clickfarm Ltd', rejectReason: 'No ISO certification' });
  });

  it('staff ask vendors for quotes; vendors answer in their portal without seeing the client; staff accept one', async () => {
    const v1 = (await pm.post('/vendors', { name: 'Quote Vendor 1', code: 'QV1' }).expect(201)).body.id;
    const v2 = (await pm.post('/vendors', { name: 'Quote Vendor 2', code: 'QV2' }).expect(201)).body.id;
    const pw = 'portal-password-123';
    for (const [v, e] of [[v1, 'q1@v.test'], [v2, 'q2@v.test']]) await pm.post('/portal-users', { kind: 'vendor', partyId: v, name: e, email: e, password: pw }).expect(201);
    const tok = async (email: string) => api(app, (await http().post('/api/v1/auth/login').send({ email, password: pw }).expect(200)).body.token);
    const q1 = await tok('q1@v.test');
    const q2 = await tok('q2@v.test');

    await viewer.post(`/projects/${projectId}/countries/${countryId}/quotes`, { vendorIds: [v1] }).expect(403);
    await otherOrg.post(`/projects/${projectId}/countries/${countryId}/quotes`, { vendorIds: [v1] }).expect(404);
    sent.length = 0;
    const asked = await pm.post(`/projects/${projectId}/countries/${countryId}/quotes`, { vendorIds: [v1, v2], note: 'Nationally representative, 18-65', respondBy: new Date(Date.now() + 86_400_000).toISOString() }).expect(201);
    expect(asked.body.market).toMatchObject({ countryCode: 'SE', currency: 'EUR', clientCpi: 6 });
    expect(asked.body.quotes).toHaveLength(2);
    expect(asked.body.quotes[0]).toMatchObject({ status: 'REQUESTED', completesWanted: 300 });
    expect(sent.map((m) => m.to[0]).sort()).toEqual(['q1@v.test', 'q2@v.test']);
    // Asking again while open sends nothing new.
    await pm.post(`/projects/${projectId}/countries/${countryId}/quotes`, { vendorIds: [v1] }).expect(201);
    expect(sent).toHaveLength(2);

    const mine = (await q1.get('/portal/vendor/quotes').expect(200)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ countryCode: 'SE', completesWanted: 300, loiMinutes: 15, irPercent: 40, note: 'Nationally representative, 18-65', currency: 'EUR' });
    expect(JSON.stringify(mine)).not.toMatch(/Quote client|"clientCpi"|QV2|Quote Vendor 2/);
    await q2.post(`/portal/vendor/quotes/${mine[0].id}`, { cpi: 1, feasibleCompletes: 10 }).expect(404);
    await q1.post(`/portal/vendor/quotes/${mine[0].id}`, { cpi: -1, feasibleCompletes: 10 }).expect(400);
    const answered = await q1.post(`/portal/vendor/quotes/${mine[0].id}`, { cpi: 4.2, feasibleCompletes: 250, daysNeeded: 5, note: 'Can do 250 in a week' }).expect(201);
    expect(answered.body).toMatchObject({ status: 'QUOTED', cpi: 4.2, feasibleCompletes: 250 });
    const q2id = (await q2.get('/portal/vendor/quotes').expect(200)).body[0].id;
    await q2.post(`/portal/vendor/quotes/${q2id}`, { decline: true, note: 'No Swedish panel' }).expect(201);

    const market = (await pm.get(`/projects/${projectId}/countries/${countryId}/quotes`).expect(200)).body;
    const quoted = market.quotes.find((q: { status: string }) => q.status === 'QUOTED');
    expect(quoted).toMatchObject({ cpi: 4.2, feasibleCompletes: 250, marginPercent: 30, vendorNote: 'Can do 250 in a week' });
    expect(market.quotes.find((q: { status: string }) => q.status === 'DECLINED').vendorNote).toBe('No Swedish panel');
    const bell = (await pm.get('/insights').expect(200)).body.items.find((i: { id: string }) => i.id === `quotes-${projectId}`);
    expect(bell).toMatchObject({ title: expect.stringContaining('1 vendor quote to review'), href: `/projects/${projectId}?tab=vendors` });

    await pm.post(`/quotes/${market.quotes.find((q: { status: string }) => q.status === 'DECLINED').id}/accept`, {}).expect(400);
    const accepted = await pm.post(`/quotes/${quoted.id}/accept`, {}).expect(201);
    expect(accepted.body.targetCompletes).toBe(250);
    const alloc = await prisma.vendorAllocation.findUniqueOrThrow({ where: { id: accepted.body.allocationId } });
    expect(alloc).toMatchObject({ vendorId: v1, targetCompletes: 250 });
    expect(Number(alloc.cpi)).toBe(4.2);
    expect(sent.at(-1)!.subject).toMatch(/Quote accepted/);
    // Answers cannot change an accepted quote; the vendor now has a link and cannot be asked again.
    await q1.post(`/portal/vendor/quotes/${quoted.id}`, { cpi: 9, feasibleCompletes: 1 }).expect(400);
    await pm.post(`/projects/${projectId}/countries/${countryId}/quotes`, { vendorIds: [v1] }).expect(400);
    await pm.post(`/quotes/${quoted.id}/close`).expect(400);
    // Re-asking a vendor who declined reopens its request.
    await pm.post(`/projects/${projectId}/countries/${countryId}/quotes`, { vendorIds: [v2] }).expect(201);
    expect((await q2.get('/portal/vendor/quotes?status=REQUESTED').expect(200)).body).toHaveLength(1);
  });
});
