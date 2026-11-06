import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { config } from '../../src/common/config';
import { humanChallenge } from '../../src/survey/captcha';
import { leadingZeroBits, powChallenge, POW_BITS, signEntry } from '../../src/survey/respondent-checks';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const FP = 'ab'.repeat(32);

function solve(token: string, bits = POW_BITS) {
  const challenge = powChallenge(config.jwtSecret, token);
  for (let n = 0; ; n++) if (leadingZeroBits(createHash('sha256').update(`${challenge}:${n}`).digest()) >= bits) return n;
}

describe('Respondent security settings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let projectId: string;
  let alloc: { entryCode: string; testEntryCode: string };
  let vendorSecret: string;
  let n = 0;
  const http = () => request(app.getHttpServer());
  const uid = () => `R${++n}`;

  beforeAll(async () => {
    process.env.GEO_COUNTRY_HEADER = 'cf-ipcountry';
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    await prisma.torExitNode.deleteMany({});
    const a = await makeOrg(prisma, 'sec');
    const b = await makeOrg(prisma, 'sec-other');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    admin = api(app, await login(app, a.users.ADMIN.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Client', code: 'CL1' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Vendor', code: 'VS' }).expect(201)).body.id;
    vendorSecret = (await admin.get(`/vendors/${vendorId}/callback-secret`).expect(200)).body.callbackSecret;
    const p = (
      await pm
        .post('/projects', {
          name: 'Security study',
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 2, targetCompletes: 500, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}', testSurveyUrl: 'https://client.example.com/test?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    projectId = p.id;
    const c = p.countries[0];
    await pm.post(`/projects/${projectId}/countries/${c.id}/allocations`, { vendorId, cpi: 1, targetCompletes: 500 }).expect(201);
    await pm.patch(`/projects/${projectId}/countries/${c.id}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);
    alloc = (await pm.get(`/projects/${projectId}`).expect(200)).body.countries[0].allocations[0];
  });

  afterAll(async () => {
    delete process.env.GEO_COUNTRY_HEADER;
    await prisma.torExitNode.deleteMany({});
    await app.close();
  });

  const setSecurity = (security: object, extra: object = {}) => pm.patch(`/projects/${projectId}`, { security, ...extra }).expect(200);
  const session = (vendorRespondentId: string) => prisma.respondentSession.findFirstOrThrow({ where: { projectId, vendorRespondentId } });
  const enter = (id: string, opts: { ua?: string; ip?: string; geo?: string; sig?: string; test?: boolean } = {}) => {
    let r = http()
      .get(`/s/${opts.test ? alloc.testEntryCode : alloc.entryCode}?uid=${id}${opts.sig ? `&sig=${opts.sig}` : ''}`)
      .set('User-Agent', opts.ua ?? DESKTOP)
      .set('X-Forwarded-For', opts.ip ?? `198.51.100.${n % 250}`);
    if (opts.geo) r = r.set('CF-IPCountry', opts.geo);
    return r.expect(302);
  };

  /** Enter, open the gate page (gets cookies) and submit. Returns the final redirect and the session. */
  async function throughGate(
    id: string,
    body: Record<string, unknown> = {},
    opts: { cookies?: boolean; browserCookie?: string; solve?: boolean; test?: boolean; human?: false | 'math' | 'logic' | 'text_image' } = {},
  ) {
    const entry = await enter(id, { test: opts.test });
    expect(entry.headers.location).toMatch(/\/g\//);
    const token = decodeURIComponent(entry.headers.location.split('/g/')[1]);
    let gate = http().get(`/g/${encodeURIComponent(token)}`);
    if (opts.browserCookie) gate = gate.set('Cookie', `pxb=${opts.browserCookie}`);
    const page = await gate.expect(200);
    const set = (page.headers['set-cookie'] as unknown as string[]) ?? [];
    const jar = set.map((c) => c.split(';')[0]);
    if (opts.browserCookie && !jar.some((c) => c.startsWith('pxb='))) jar.push(`pxb=${opts.browserCookie}`);
    if (opts.human) {
      const answer = humanChallenge(opts.human, config.jwtSecret, token, 0).answer;
      const h = await http().post(`/g/${encodeURIComponent(token)}/human`).send({ answer: opts.human === 'logic' ? answer!.toLowerCase() : answer }).expect(200);
      expect(h.body).toEqual({ ok: true });
    }
    let post = http().post(`/g/${encodeURIComponent(token)}`).send({ ...(opts.solve === false ? {} : { nonce: solve(token, opts.test ? 12 : POW_BITS) }), ...body });
    if (opts.cookies !== false) post = post.set('Cookie', jar.join('; '));
    const res = await post.expect(200);
    return { location: res.body.location as string, page, session: await session(id), jar };
  }

  it('enforces the allowed device types', async () => {
    await setSecurity({}, { devices: { desktop: false, mobile: true, tablet: true } });
    const d = uid();
    await enter(d);
    expect(await session(d)).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'DEVICE_NOT_ALLOWED', deviceType: 'desktop' });
    const m = uid();
    expect((await enter(m, { ua: PHONE })).headers.location).toMatch(/^https:\/\/client\.example\.com\/s\?rid=/);
    expect(await session(m)).toMatchObject({ status: 'STARTED', deviceType: 'mobile' });
    await pm.patch(`/projects/${projectId}`, { devices: { desktop: true, mobile: true, tablet: true } }).expect(200);
  });

  it('narrows mobile to Android or iOS', async () => {
    const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';
    await pm.patch(`/projects/${projectId}`, { devices: { desktop: true, mobile: true, tablet: true, android: false, ios: false } }).expect(400);
    await setSecurity({}, { devices: { desktop: true, mobile: true, tablet: true, android: true, ios: false } });
    const i = uid();
    await enter(i, { ua: PHONE });
    expect(await session(i)).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'MOBILE_OS_NOT_ALLOWED', deviceType: 'mobile' });
    const a = uid();
    expect((await enter(a, { ua: ANDROID })).headers.location).toMatch(/^https:\/\/client\.example\.com\/s\?rid=/);
    expect(await session(a)).toMatchObject({ status: 'STARTED', deviceType: 'mobile' });
    await pm.patch(`/projects/${projectId}`, { devices: { desktop: true, mobile: true, tablet: true } }).expect(200);
  });

  it('URL protection: unsigned or wrongly signed links create no session; signed links work', async () => {
    await setSecurity({ urlProtection: true });
    const p = (await pm.get(`/projects/${projectId}`).expect(200)).body;
    expect(p.countries[0].allocations[0].entryLink).toContain('&sig=[SIG]');
    const bad = uid();
    expect((await enter(bad)).headers.location).toMatch(/\/end\/security_reject$/);
    expect((await enter(bad, { sig: signEntry(vendorSecret, 'someone-else') })).headers.location).toMatch(/\/end\/security_reject$/);
    expect(await prisma.respondentSession.count({ where: { vendorRespondentId: bad } })).toBe(0);
    // The real respondent with that ID can still get in.
    expect((await enter(bad, { sig: signEntry(vendorSecret, bad) })).headers.location).toMatch(/^https:\/\/client\.example\.com/);
    const summary = (await pm.get(`/projects/${projectId}/security-summary`).expect(200)).body;
    expect(summary.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'BAD_SIGNATURE', count: 2 })]));
  });

  it('TOR detection rejects exit nodes once the list is loaded, and lets entries through before that', async () => {
    await setSecurity({ torDetection: true });
    const before = uid();
    await enter(before, { ip: '203.0.113.66' });
    expect((await session(before)).status).toBe('STARTED');
    await prisma.torExitNode.createMany({ data: [{ ip: '203.0.113.66' }, { ip: '203.0.113.67' }] });
    const tor = uid();
    await enter(tor, { ip: '203.0.113.66' });
    expect(await session(tor)).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'TOR_EXIT' });
    const clean = uid();
    await enter(clean, { ip: '203.0.113.10' });
    expect((await session(clean)).status).toBe('STARTED');
    expect((await pm.get('/security/status').expect(200)).body.tor.nodes).toBe(2);
  });

  it('geolocation compares the edge country header with the survey country', async () => {
    await setSecurity({ geolocation: true });
    const de = uid();
    await enter(de, { geo: 'DE' });
    expect(await session(de)).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'GEO_MISMATCH', geoCountry: 'DE' });
    const us = uid();
    await enter(us, { geo: 'us' });
    expect((await session(us)).status).toBe('STARTED');
    const unknown = uid();
    await enter(unknown, { geo: 'XX' });
    expect((await session(unknown)).status).toBe('STARTED');
    expect((await pm.get('/security/status').expect(200)).body.geolocation).toEqual({ configured: true, header: 'cf-ipcountry' });
  });

  describe('gate page', () => {
    beforeAll(() => setSecurity({ captcha: true, browserLanguage: true, timezoneTracking: true, cookieValidation: true, browserFingerprinting: true }));

    it('serves a locked-down page and releases the survey link when every check passes', async () => {
      const id = uid();
      const r = await throughGate(id, { languages: ['en-US', 'fr'], timezone: 'America/New_York', fingerprint: FP }, { human: 'math' });
      expect(r.location).toMatch(/^https:\/\/client\.example\.com\/s\?rid=/);
      expect(r.page.headers['content-security-policy']).toMatch(/script-src 'nonce-/);
      expect(r.page.text).not.toContain(id);
      expect(r.jar.some((c) => c.startsWith('pxg='))).toBe(true);
      expect(r.session.gatePassedAt).not.toBeNull();
      expect(r.session.status).toBe('STARTED');
    });

    it.each([
      ['skipped human check', { languages: ['en'], timezone: 'America/Chicago' }, {}, 'HUMAN_CHECK_FAILED'],
      ['no captcha solution', { languages: ['en'], timezone: 'America/Chicago' }, { solve: false, human: 'math' }, 'CAPTCHA_FAILED'],
      ['cookies blocked', { languages: ['en'], timezone: 'America/Chicago' }, { cookies: false, human: 'math' }, 'COOKIES_BLOCKED'],
      ['wrong language', { languages: ['de-DE'], timezone: 'America/Chicago' }, { human: 'math' }, 'LANGUAGE_MISMATCH'],
      ['wrong time zone', { languages: ['en-IN'], timezone: 'Asia/Calcutta' }, { human: 'math' }, 'TIMEZONE_MISMATCH'],
    ] as const)('rejects %s', async (_label, body, opts, reason) => {
      const id = uid();
      const r = await throughGate(id, { ...body, fingerprint: createHash('sha256').update(id).digest('hex') }, { ...opts });
      expect(r.session).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: reason, gatePassedAt: null });
    });

    it('treats generic time zones and missing signals as unknown, not as failures', async () => {
      const r = await throughGate(uid(), { timezone: 'Etc/UTC', fingerprint: createHash('sha256').update('utc').digest('hex') }, { human: 'math' });
      expect(r.session.gatePassedAt).not.toBeNull();
    });

    it('catches the same device by fingerprint and the same browser by cookie', async () => {
      const sig = { languages: ['en'], timezone: 'America/Denver' };
      await throughGate(uid(), { ...sig, fingerprint: 'cd'.repeat(32) }, { human: 'math' });
      const again = await throughGate(uid(), { ...sig, fingerprint: 'cd'.repeat(32) }, { human: 'math' });
      expect(again.session).toMatchObject({ status: 'DUPLICATE', statusDetail: 'SAME_FINGERPRINT' });

      const first = await throughGate(uid(), { ...sig, fingerprint: 'ee'.repeat(32) }, { human: 'math' });
      const pxb = first.jar.find((c) => c.startsWith('pxb='))!.slice(4);
      const second = await throughGate(uid(), { ...sig, fingerprint: 'ff'.repeat(32) }, { browserCookie: pxb, human: 'math' });
      expect(second.session).toMatchObject({ status: 'DUPLICATE', statusDetail: 'SAME_BROWSER' });
    });

    it('rejects an outcome from a respondent who skipped the gate, and counts no complete', async () => {
      const id = uid();
      const entry = await enter(id);
      const token = decodeURIComponent(entry.headers.location.split('/g/')[1]);
      await http().get(`/r/complete?token=${encodeURIComponent(token)}`).expect(302);
      expect(await session(id)).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'GATE_SKIPPED', revenue: null });
    });

    it('test links run the checks, log them, and never block', async () => {
      const id = uid();
      const r = await throughGate(id, { languages: ['de'], timezone: 'Europe/Berlin', fingerprint: FP }, { test: true, human: 'math' });
      expect(r.location).toMatch(/^https:\/\/client\.example\.com\/test\?rid=/);
      const ev = await prisma.respondentEvent.findFirstOrThrow({ where: { sessionId: r.session.id, type: 'SECURITY_CHECK', detail: { path: ['stage'], equals: 'gate' } } });
      const detail = ev.detail as { enforced: boolean; checks: { check: string; ok: boolean }[] };
      expect(detail.enforced).toBe(false);
      expect(detail.checks.filter((c) => !c.ok).map((c) => c.check).sort()).toEqual(['fingerprint', 'language', 'timezone']);
    });
  });

  describe('human check styles', () => {
    it('gives three tries with a new question each time, then rejects', async () => {
      await setSecurity({ captcha: false, gateSurvey: true }, { captchaStyle: 'math', gateQuestions: null });
      const id = uid();
      const token = decodeURIComponent((await enter(id)).headers.location.split('/g/')[1]);
      const page = await http().get(`/g/${encodeURIComponent(token)}`).expect(200);
      const q0 = humanChallenge('math', config.jwtSecret, token, 0);
      expect(page.text).toContain(q0.text);
      expect(page.text).not.toContain(`>${q0.answer}<`);
      const r1 = await http().post(`/g/${encodeURIComponent(token)}/human`).send({ answer: '999' }).expect(200);
      expect(r1.body).toMatchObject({ ok: false, human: { attemptsLeft: 2, question: humanChallenge('math', config.jwtSecret, token, 1).text } });
      // Right answer on the second try passes.
      await http().post(`/g/${encodeURIComponent(token)}/human`).send({ answer: humanChallenge('math', config.jwtSecret, token, 1).answer }).expect(200, { ok: true });
      expect((await session(id)).humanPassedAt).not.toBeNull();

      const bad = uid();
      const t2 = decodeURIComponent((await enter(bad)).headers.location.split('/g/')[1]);
      for (let i = 0; i < 2; i++) await http().post(`/g/${encodeURIComponent(t2)}/human`).send({ answer: 'x' }).expect(200);
      const last = await http().post(`/g/${encodeURIComponent(t2)}/human`).send({ answer: 'x' }).expect(200);
      expect(last.body.location).toBeDefined();
      expect(await session(bad)).toMatchObject({ status: 'SECURITY_REJECT', statusDetail: 'HUMAN_CHECK_FAILED' });
    });

    it('logic and picture styles work, and the picture does not contain the answer as text', async () => {
      await setSecurity({ gateSurvey: true }, { captchaStyle: 'logic' });
      const l = await throughGate(uid(), {}, { human: 'logic', solve: false });
      expect(l.location).toMatch(/^https:\/\/client\.example\.com/);

      await setSecurity({ gateSurvey: true }, { captchaStyle: 'text_image' });
      const id = uid();
      const token = decodeURIComponent((await enter(id)).headers.location.split('/g/')[1]);
      const page = await http().get(`/g/${encodeURIComponent(token)}`).expect(200);
      expect(page.text).toContain('/captcha.svg');
      const img = await http().get(`/g/${encodeURIComponent(token)}/captcha.svg`).expect(200).expect('Content-Type', /svg/);
      const answer = humanChallenge('text_image', config.jwtSecret, token, 0).answer!;
      expect(img.body.toString()).not.toContain(answer);
      expect(img.body.toString()).not.toMatch(/<text/);
      await http().post(`/g/${encodeURIComponent(token)}/human`).send({ answer: answer.toLowerCase() }).expect(200, { ok: true });
    });

    it('invisible style shows no question but needs the background proof of work', async () => {
      await setSecurity({ gateSurvey: true }, { captchaStyle: 'invisible' });
      const ok = await throughGate(uid(), {});
      expect(ok.location).toMatch(/^https:\/\/client\.example\.com/);
      expect(ok.page.text).not.toContain('Quick check');
      const bad = await throughGate(uid(), {}, { solve: false });
      expect(bad.session.statusDetail).toBe('CAPTCHA_FAILED');
    });

    it('Turnstile needs admin keys; falls back to the math check without them; verifies tokens server side', async () => {
      await setSecurity({ gateSurvey: true }, { captchaStyle: 'turnstile' });
      const fallback = uid();
      const t0 = decodeURIComponent((await enter(fallback)).headers.location.split('/g/')[1]);
      const p0 = await http().get(`/g/${encodeURIComponent(t0)}`).expect(200);
      expect(p0.text).toContain(humanChallenge('math', config.jwtSecret, t0, 0).text);

      await pm.put('/security/captcha').send({ turnstile: { siteKey: '0x4AAAAAAAtestsitekey', secret: '0x4AAAAAAAtestsecret' } }).expect(403);
      const set = await admin.put('/security/captcha').send({ turnstile: { siteKey: '0x4AAAAAAAtestsitekey', secret: '0x4AAAAAAAtestsecret' } }).expect(200);
      expect(set.body.providers.turnstile).toEqual({ configured: true, siteKey: '0x4AAAAAAAtestsitekey' });
      expect(JSON.stringify(set.body)).not.toContain('testsecret');

      const id = uid();
      const token = decodeURIComponent((await enter(id)).headers.location.split('/g/')[1]);
      const page = await http().get(`/g/${encodeURIComponent(token)}`).expect(200);
      expect(page.text).toContain('data-sitekey="0x4AAAAAAAtestsitekey"');
      expect(page.headers['content-security-policy']).toContain('https://challenges.cloudflare.com');

      const realFetch = global.fetch;
      const calls: string[] = [];
      global.fetch = (async (url: string, init?: { body?: URLSearchParams }) => {
        calls.push(String(init?.body));
        const ok = init?.body?.get('response') === 'good-token';
        return new Response(JSON.stringify({ success: ok, 'error-codes': ok ? [] : ['invalid-input-response'] }), { status: 200 });
      }) as typeof fetch;
      try {
        expect((await http().post(`/g/${encodeURIComponent(token)}/human`).send({ answer: 'bad-token' }).expect(200)).body.ok).toBe(false);
        await http().post(`/g/${encodeURIComponent(token)}/human`).send({ answer: 'good-token' }).expect(200, { ok: true });
      } finally {
        global.fetch = realFetch;
      }
      expect(calls[0]).toContain('secret=0x4AAAAAAAtestsecret');
      await admin.put('/security/captcha').send({ turnstile: null }).expect(200);
    });
  });

  describe('gate survey and prescreener questions', () => {
    const GATE = [
      { id: 'age', type: 'number', text: 'How old are you?', validation: { min: 1, max: 120, integer: true }, qualify: { min: 18 } },
      { id: 'gender', type: 'single', text: 'Gender?', options: [{ id: 'm', label: 'Male' }, { id: 'f', label: 'Female' }, { id: 'x', label: 'Other' }] },
      { id: 'brands', type: 'multi', text: 'Which brands do you know?', validation: { minSelect: 1, maxSelect: 2 }, options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }, { id: 'none', label: 'None of these', exclusive: true }] },
      { id: 'income', type: 'dropdown', text: 'Income?', options: [{ id: 'b1', label: 'Low' }, { id: 'b2', label: 'High' }] },
      { id: 'zip', type: 'text', text: 'ZIP?', validation: { format: 'digits', minLength: 5, maxLength: 5 } },
      { id: 'sat', type: 'grid', text: 'Rate', rows: [{ id: 'r1', label: 'Price' }, { id: 'r2', label: 'Taste' }], options: [{ id: 'lo', label: 'Low' }, { id: 'hi', label: 'High' }] },
      { id: 'note', type: 'text', text: 'Anything else?', required: false },
    ];
    const PRE = [{ id: 'pet', type: 'single', text: 'Do you own a pet?', options: [{ id: 'yes', label: 'Yes', action: 'qualify' }, { id: 'no', label: 'No' }] }];
    const good = { age: 34, gender: 'f', brands: ['a', 'b'], income: 'b2', zip: '10001', sat: { r1: 'lo', r2: 'hi' } };

    beforeAll(async () => {
      await setSecurity({ gateSurvey: true, prescreening: true }, { captchaStyle: 'invisible', gateQuestions: GATE, prescreen: PRE });
    });

    it('rejects broken question setups', async () => {
      const bad = (q: object) => pm.patch(`/projects/${projectId}`, { prescreen: [q] }).expect(400);
      await bad({ id: 'q', type: 'single', text: 'x', options: [{ id: 'a', label: 'A', action: 'terminate' }, { id: 'b', label: 'B', action: 'terminate' }] });
      await bad({ id: 'q', type: 'single', text: 'x', options: [{ id: 'a', label: 'A' }] });
      await bad({ id: 'q', type: 'number', text: 'x', validation: { min: 10, max: 1 } });
      await bad({ id: 'q', type: 'multi', text: 'x', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], validation: { minSelect: 3, maxSelect: 2 } });
      await bad({ id: 'q', type: 'grid', text: 'x', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
      await bad({ id: 'q', type: 'text', text: 'x', validation: { format: 'regex' } });
      const t = (await pm.get('/question-templates?currency=INR').expect(200)).body;
      expect(t.map((x: { question: { id: string } }) => x.question.id)).toEqual(['age', 'gender', 'postal', 'income', 'employment', 'education']);
      expect(JSON.stringify(t)).toContain('lakh');
      await pm.patch(`/projects/${projectId}`, { prescreen: t.map((x: { question: object }) => x.question) }).expect(200);
      await pm.patch(`/projects/${projectId}`, { prescreen: PRE }).expect(200);
    });

    it('renders every question type and stores the answers with labels', async () => {
      const id = uid();
      const r = await throughGate(id, { answers: { gate: { ...good, note: '  great  ' }, prescreen: { pet: 'yes' } } });
      for (const t of ['type="number"', 'type="checkbox"', '<select', 'data-row="r2"', 'data-exclusive="1"', 'Do you own a pet?']) expect(r.page.text).toContain(t);
      expect(r.location).toMatch(/^https:\/\/client\.example\.com/);
      expect(r.session.answers).toEqual({
        gate: {
          age: { value: 34, label: '34' },
          gender: { value: 'f', label: 'Female' },
          brands: { value: ['a', 'b'], label: 'Alpha; Beta' },
          income: { value: 'b2', label: 'High' },
          zip: { value: '10001', label: '10001' },
          sat: { value: { r1: 'lo', r2: 'hi' }, label: 'Price: Low; Taste: High' },
          note: { value: 'great', label: 'great' },
        },
        prescreen: { pet: { value: 'yes', label: 'Yes' } },
      });
    });

    it.each([
      ['under the qualifying age', { gate: { ...good, age: 16 }, prescreen: { pet: 'yes' } }, 'TERMINATE', 'GATE_SCREENOUT'],
      ['not a qualifying prescreen answer', { gate: good, prescreen: { pet: 'no' } }, 'TERMINATE', 'PRESCREEN'],
      ['a missing required answer', { gate: { ...good, gender: undefined }, prescreen: { pet: 'yes' } }, 'SECURITY_REJECT', 'GATE_INCOMPLETE'],
      ['too many choices', { gate: { ...good, brands: ['a', 'b', 'c'] }, prescreen: { pet: 'yes' } }, 'SECURITY_REJECT', 'GATE_INCOMPLETE'],
      ['"none" with another choice', { gate: { ...good, brands: ['a', 'none'] }, prescreen: { pet: 'yes' } }, 'SECURITY_REJECT', 'GATE_INCOMPLETE'],
      ['a ZIP in the wrong format', { gate: { ...good, zip: '1000A' }, prescreen: { pet: 'yes' } }, 'SECURITY_REJECT', 'GATE_INCOMPLETE'],
      ['a decimal where a whole number is needed', { gate: { ...good, age: 30.5 }, prescreen: { pet: 'yes' } }, 'SECURITY_REJECT', 'GATE_INCOMPLETE'],
      ['an unanswered grid row', { gate: { ...good, sat: { r1: 'lo' } }, prescreen: { pet: 'yes' } }, 'SECURITY_REJECT', 'GATE_INCOMPLETE'],
      ['an answer id that does not exist', { gate: { ...good, income: 'b9' }, prescreen: { pet: 'yes' } }, 'SECURITY_REJECT', 'GATE_INCOMPLETE'],
    ])('screens out %s', async (_l, answers, status, reason) => {
      const r = await throughGate(uid(), { answers });
      expect(r.session).toMatchObject({ status, statusDetail: reason });
    });

    it('shows answers per project with filters, counts and export, to that tenant only', async () => {
      await throughGate(uid(), { answers: { gate: { ...good, gender: 'm', brands: ['c'] }, prescreen: { pet: 'yes' } } });
      const all = (await pm.get(`/projects/${projectId}/answers`).expect(200)).body;
      expect(all.questions.map((x: { section: string; id: string }) => `${x.section}.${x.id}`)).toEqual(['gate.age', 'gate.gender', 'gate.brands', 'gate.income', 'gate.zip', 'gate.sat', 'gate.note', 'prescreen.pet']);
      const gender = all.summary.find((x: { id: string }) => x.id === 'gender');
      expect(gender.counts.find((c: { id: string }) => c.id === 'm').count).toBe(1);
      expect(all.summary.find((x: { id: string }) => x.id === 'age').number.min).toBe(16);
      const women = (await pm.get(`/projects/${projectId}/answers?section=gate&question=gender&option=f`).expect(200)).body;
      expect(women.rows.every((r: { answers: { gate: { gender: { value: string } } } }) => r.answers.gate.gender.value === 'f')).toBe(true);
      expect(women.total).toBeLessThan(all.total);
      const gamma = (await pm.get(`/projects/${projectId}/answers?section=gate&question=brands&option=c`).expect(200)).body;
      expect(gamma.total).toBe(1);
      const screened = (await pm.get(`/projects/${projectId}/answers?status=TERMINATE`).expect(200)).body;
      expect(screened.rows[0].reason).toMatch(/Did not qualify/);
      const exp = (await pm.get(`/projects/${projectId}/answers?export=true`).expect(200)).body;
      expect(exp.rows).toHaveLength(all.total);
      await other.get(`/projects/${projectId}/answers`).expect(404);
    });

    afterAll(() => setSecurity({}, { gateQuestions: null, prescreen: null, captchaStyle: 'math' }));
  });

  it('summarises what each check caught, per project and tenant', async () => {
    const s = (await pm.get(`/projects/${projectId}/security-summary`).expect(200)).body;
    const by = Object.fromEntries(s.reasons.map((r: { reason: string; count: number }) => [r.reason, r.count]));
    expect(by).toMatchObject({ DEVICE_NOT_ALLOWED: 1, MOBILE_OS_NOT_ALLOWED: 1, TOR_EXIT: 1, GEO_MISMATCH: 1, CAPTCHA_FAILED: 2, HUMAN_CHECK_FAILED: 2, COOKIES_BLOCKED: 1, SAME_FINGERPRINT: 1, SAME_BROWSER: 1, GATE_SKIPPED: 1, GATE_SCREENOUT: 1, PRESCREEN: 1, GATE_INCOMPLETE: 7, BAD_SIGNATURE: 2 });
    expect(s.gate.required).toBeGreaterThan(s.gate.passed);
    await other.get(`/projects/${projectId}/security-summary`).expect(404);
    await pm.post('/security/tor/sync').expect(403);
  });
});
