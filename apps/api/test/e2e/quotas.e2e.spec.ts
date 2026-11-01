import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { config } from '../../src/common/config';
import { leadingZeroBits, powChallenge, POW_BITS } from '../../src/survey/respondent-checks';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

function solve(token: string) {
  const challenge = powChallenge(config.jwtSecret, token);
  for (let n = 0; ; n++) if (leadingZeroBits(createHash('sha256').update(`${challenge}:${n}`).digest()) >= POW_BITS) return n;
}

const GATE = [
  { id: 'age', type: 'number', text: 'How old are you?', validation: { min: 1, max: 120, integer: true } },
  { id: 'gender', type: 'single', text: 'Gender?', options: [{ id: 'm', label: 'Male' }, { id: 'f', label: 'Female' }] },
  { id: 'zip', type: 'text', text: 'ZIP?', required: false },
];

describe('Quota cells (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let projectId: string;
  let countryId: string;
  let alloc: { entryCode: string };
  let n = 0;
  const http = () => request(app.getHttpServer());
  const uid = () => `Q${++n}`;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'quota');
    const b = await makeOrg(prisma, 'quota-other');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Client', code: 'CL1' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Vendor', code: 'VQ' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'Quota study',
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 2, targetCompletes: 100, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    projectId = p.id;
    countryId = p.countries[0].id;
    await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId, cpi: 1, targetCompletes: 100 }).expect(201);
    await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE', security: { gateSurvey: true }, captchaStyle: 'invisible', gateQuestions: GATE }).expect(200);
    alloc = (await pm.get(`/projects/${projectId}`).expect(200)).body.countries[0].allocations[0];
  });

  afterAll(async () => {
    await app.close();
  });

  const session = (id: string) => prisma.respondentSession.findFirstOrThrow({ where: { projectId, vendorRespondentId: id } });
  const enter = (id: string, ua = DESKTOP) => http().get(`/s/${alloc.entryCode}?uid=${id}`).set('User-Agent', ua).set('X-Forwarded-For', `198.51.100.${n % 250}`).expect(302);
  const cellsUrl = () => `/projects/${projectId}/countries/${countryId}/quotas`;
  const cell = async (name: string) => (await prisma.quotaCell.findFirstOrThrow({ where: { projectCountryId: countryId, name } }));

  /** Enter and answer the gate page. Returns where the respondent was sent and the session. */
  async function qualify(id: string, answers: Record<string, unknown>, ua = DESKTOP) {
    const entry = await enter(id, ua);
    if (!entry.headers.location.includes('/g/')) return { location: entry.headers.location as string, session: await session(id) };
    const token = decodeURIComponent(entry.headers.location.split('/g/')[1]);
    await http().get(`/g/${encodeURIComponent(token)}`).expect(200);
    const res = await http().post(`/g/${encodeURIComponent(token)}`).send({ nonce: solve(token), answers: { gate: answers } }).expect(200);
    return { location: res.body.location as string, session: await session(id), token };
  }
  const complete = (token: string) => http().get(`/r/complete?token=${token}`).expect(302);

  it('saves cells, checks them against the gate questions and guards access', async () => {
    await pm.put(cellsUrl(), { cells: [{ name: 'Zip', target: 5, conditions: [{ source: 'gate', questionId: 'zip', values: ['1'] }] }] }).expect(400)
      .then((r) => expect(r.body.issues.join()).toContain('text question'));
    await pm.put(cellsUrl(), { cells: [{ name: 'X', target: 5, conditions: [] }] }).expect(400);
    await pm.put(cellsUrl(), { cells: [{ name: 'A', target: 5, conditions: [{ source: 'device', values: ['mobile'] }] }, { name: 'a', target: 1, conditions: [{ source: 'device', values: ['tablet'] }] }] }).expect(400);
    const body = {
      cells: [
        { group: 'Gender', name: 'Female', target: 2, conditions: [{ source: 'gate', questionId: 'gender', values: ['f'] }] },
        { group: 'Gender', name: 'Male', target: 1, conditions: [{ source: 'gate', questionId: 'gender', values: ['m'] }] },
        { group: 'Age', name: '18-34', target: 50, conditions: [{ source: 'gate', questionId: 'age', min: 18, max: 34 }] },
        { group: 'Device', name: 'Phones', target: 50, conditions: [{ source: 'device', values: ['mobile'] }] },
      ],
    };
    await viewer.put(cellsUrl(), body).expect(403);
    await other.put(cellsUrl(), body).expect(404);
    await other.get(`/projects/${projectId}/quotas`).expect(404);
    const saved = (await pm.put(cellsUrl(), body).expect(200)).body;
    expect(saved.map((c: { name: string }) => c.name)).toEqual(['Female', 'Male', '18-34', 'Phones']);

    // Saving again by id keeps the cells (and their counts); leaving one out removes it.
    const again = (await pm.put(cellsUrl(), { cells: saved.slice(0, 3).map(({ id, group, name, target, conditions }: Record<string, unknown>) => ({ id, group, name, target, conditions })) }).expect(200)).body;
    expect(again.map((c: { id: string }) => c.id)).toEqual(saved.slice(0, 3).map((c: { id: string }) => c.id));
    await pm.put(cellsUrl(), body).expect(200);

    const view = (await viewer.get(`/projects/${projectId}/quotas`).expect(200)).body;
    expect(view).toMatchObject({ gateSurvey: true, prescreening: false });
    expect(view.questions.gate.map((q: { id: string }) => q.id)).toEqual(['age', 'gender']);
    expect(view.countries[0].quotas).toHaveLength(4);
  });

  it('counts completes per cell and sends respondents to quota full once their cell is full', async () => {
    const f1 = await qualify(uid(), { age: 25, gender: 'f' });
    expect(f1.location).toMatch(/^https:\/\/client\.example\.com/);
    expect(f1.session.quotaCellIds.sort()).toEqual([(await cell('Female')).id, (await cell('18-34')).id].sort());
    await complete(f1.token!);
    expect((await cell('Female')).completes).toBe(1);
    expect((await cell('18-34')).completes).toBe(1);
    expect((await cell('Male')).completes).toBe(0);

    // Two men qualify while the Male cell (target 1) still has room; only the first complete counts.
    const m1 = await qualify(uid(), { age: 40, gender: 'm' });
    const m2 = await qualify(uid(), { age: 41, gender: 'm' });
    expect(m2.session.status).toBe('STARTED');
    const view = (await pm.get(`/projects/${projectId}/quotas`).expect(200)).body;
    expect(view.countries[0].quotas.find((q: { name: string }) => q.name === 'Male').inProgress).toBe(2);
    await complete(m1.token!);
    await complete(m2.token!);
    expect(await session(m1.session.vendorRespondentId)).toMatchObject({ status: 'COMPLETE' });
    expect(await session(m2.session.vendorRespondentId)).toMatchObject({ status: 'QUOTA_FULL', statusDetail: 'OVERQUOTA' });
    expect((await cell('Male')).completes).toBe(1);
    const country = await prisma.projectCountry.findUniqueOrThrow({ where: { id: countryId } });
    expect(country.completes).toBe(2);

    // A new man is stopped on the gate page, and the check is logged.
    const m3 = await qualify(uid(), { age: 30, gender: 'm' });
    expect(m3.session).toMatchObject({ status: 'QUOTA_FULL', statusDetail: 'CELL_FULL' });
    const ev = await prisma.respondentEvent.findFirstOrThrow({ where: { sessionId: m3.session.id, type: 'SECURITY_CHECK', detail: { path: ['stage'], equals: 'gate' } } });
    expect(JSON.stringify(ev.detail)).toContain('"check":"quota"');
    expect((await cell('18-34')).completes).toBe(1);

    // Women still get through.
    expect((await qualify(uid(), { age: 50, gender: 'f' })).location).toMatch(/^https:\/\/client\.example\.com/);
  });

  it('a closed cell stops matching respondents at entry, and reopening lets them in', async () => {
    const phones = await cell('Phones');
    await viewer.patch(`${cellsUrl()}/${phones.id}`, { isOpen: false }).expect(403);
    await pm.patch(`${cellsUrl()}/${phones.id}`, { isOpen: false }).expect(200);
    const p1 = uid();
    await enter(p1, PHONE);
    expect(await session(p1)).toMatchObject({ status: 'QUOTA_FULL', statusDetail: 'CELL_FULL', deviceType: 'mobile' });
    await pm.patch(`${cellsUrl()}/${phones.id}`, { isOpen: true, target: 60 }).expect(200);
    const p2 = await qualify(uid(), { age: 22, gender: 'f' }, PHONE);
    expect(p2.session.status).toBe('STARTED');
    expect(p2.session.quotaCellIds).toContain(phones.id);
    await other.patch(`${cellsUrl()}/${phones.id}`, { isOpen: false }).expect(404);
  });

  it('the monitor shows the cells and raises an alert for a full one', async () => {
    const m = (await pm.get(`/monitor?projectId=${projectId}`).expect(200)).body.markets[0];
    expect(m.cells.find((c: { name: string }) => c.name === 'Male')).toMatchObject({ completes: 1, target: 1, isOpen: true });
    await pm.post('/monitor/run').expect(201);
    const alerts = (await pm.get(`/alerts?projectId=${projectId}`).expect(200)).body;
    expect(alerts.find((a: { rule: string }) => a.rule === 'cell_full')).toMatchObject({ title: expect.stringContaining('Gender: Male is full') });
  });
});
