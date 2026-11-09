import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import request from 'supertest';
import { config } from '../../src/common/config';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const DESIGN = {
  template: 'aurora',
  colors: { primary: '#2563eb', accent: '#06b6d4', background: '#eef4ff', surface: '#ffffff', text: '#0f172a' },
  font: 'system',
  radius: 'soft',
  confetti: false,
  texts: {},
  interstitial: { enabled: false, seconds: 5 },
};

describe('Sampledge logo on respondent pages, notification reads, audience question sets (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let orgId: string;
  let otherOrgId: string;
  let projectId: string;
  let entryCode: string;
  let n = 0;
  const http = () => request(app.getHttpServer());
  const BASE = config.publicBaseUrl;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'brandsets');
    const b = await makeOrg(prisma, 'brandsets-other');
    orgId = a.org.id;
    otherOrgId = b.org.id;
    admin = api(app, await login(app, a.users.ADMIN.email));
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Client BS', code: 'CBS' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Vendor BS', code: 'VBS' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'Brand sets',
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 2, targetCompletes: 100, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    const c = p.countries[0];
    await pm.post(`/projects/${p.id}/countries/${c.id}/allocations`, { vendorId, cpi: 1, targetCompletes: 100 }).expect(201);
    await pm.patch(`/projects/${p.id}/countries/${c.id}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${p.id}`, { status: 'LIVE' }).expect(200);
    projectId = p.id;
    entryCode = (await pm.get(`/projects/${p.id}`).expect(200)).body.countries[0].allocations[0].entryCode;
  });
  afterAll(async () => {
    await app.close();
  });

  async function endPage() {
    const res = await http().get(`/s/${entryCode}?uid=B${++n}`).set('User-Agent', DESKTOP).set('X-Forwarded-For', `198.51.100.${n}`).expect(302);
    const token = new URL(res.headers.location).searchParams.get('rid')!;
    const done = await http().get(`/r/complete?token=${token}`).expect(302);
    const u = new URL(done.headers.location);
    return (await http().get(u.pathname + u.search).expect(200)).text;
  }

  describe('Sampledge logo', () => {
    it('serves only the listed logo files', async () => {
      const icon = await http().get('/brand/sampledge-icon-64.png').expect(200);
      expect(icon.headers['content-type']).toBe('image/png');
      expect(icon.body.subarray(1, 4).toString('latin1')).toBe('PNG');
      for (const f of ['sampledge-logo-on-light.png', 'sampledge-logo-on-dark.png', 'samptrek-logo-light.png', 'samptrek-logo-dark.png']) await http().get(`/brand/${f}`).expect(200);
      const svg = await http().get('/brand/sampledge-logo-on-light.svg').expect(200);
      expect(svg.headers['content-type']).toContain('image/svg+xml');
      expect(svg.headers['content-security-policy']).not.toContain('script');
      await http().get('/brand/secret.env').expect(404);
      await http().get('/brand/..%2F..%2Fpackage.json').expect(404);
    });

    it('shows the logo and tab icon on end pages by default, also without a session', async () => {
      const anon = await http().get('/end/quota_full').expect(200);
      expect(anon.text).toContain(`<link rel="icon" href="${BASE}/brand/sampledge-mark.svg">`);
      expect(anon.text).toContain(`${BASE}/brand/sampledge-logo-on-light.svg`);
      expect(anon.text).toContain('alt="Sampledge"');
      const page = await endPage();
      expect(page).toContain('sampledge-logo-on-light.svg');
      expect(page).not.toContain('Powered by');
    });

    it('moves to a Powered by line when the project has its own brand, and can be turned off', async () => {
      await pm.put(`/projects/${projectId}/page-design`).send({ ...DESIGN, brandName: 'Opinion Circle' }).expect(200);
      let page = await endPage();
      expect(page).toContain('Opinion Circle');
      expect(page).toContain('Powered by');
      expect(page).toContain('sampledge-logo-on-light.svg');
      // Dark palette: the logo for dark backgrounds.
      await pm.put(`/projects/${projectId}/page-design`).send({ ...DESIGN, colors: { primary: '#818cf8', accent: '#22d3ee', background: '#0b1020', surface: '#151c33', text: '#e5e7eb' } }).expect(200);
      expect(await endPage()).toContain('sampledge-logo-on-dark.svg');
      await pm.put(`/projects/${projectId}/page-design`).send({ ...DESIGN, brandName: 'Opinion Circle', platformLogo: false }).expect(200);
      page = await endPage();
      expect(page).not.toContain('sampledge-logo');
      expect(page).not.toContain('rel="icon"');
      expect((await pm.get(`/projects/${projectId}/page-design`).expect(200)).body.design.platformLogo).toBe(false);
    });

    it('shows on the gate page and in the preview', async () => {
      await pm.put(`/projects/${projectId}/page-design`).send(DESIGN).expect(200);
      for (const page of ['gate', 'complete']) {
        const r = await pm.post(`/projects/${projectId}/page-design/preview`, { design: DESIGN, page }).expect(201);
        expect(r.body.html).toContain('sampledge-logo-on-light.svg');
        expect(r.body.html).toContain('rel="icon"');
      }
    });

    it("uses the organisation's white-label name instead of SampTrek", async () => {
      await admin.put('/branding', { appName: 'Acme Research', hidePoweredBy: true }).expect(200);
      const page = await endPage();
      expect(page).toContain('Acme Research');
      expect(page).not.toContain('sampledge-logo');
      await admin.put('/branding', { appName: null }).expect(200);
      expect(await endPage()).toContain('sampledge-logo-on-light.svg');
    });
  });

  describe('Notification reads', () => {
    async function addAlert(org: string, title: string) {
      return prisma.alert.create({ data: { organizationId: org, rule: 'stalled', severity: 'warn', title, detail: 'No completes for 2 hours', dedupeKey: `t-${title}` } });
    }

    it('counts only unread alerts per person, and marks them read', async () => {
      // The live market with no traffic is already an alert; read it first so the counts below are exact.
      for (const who of [pm, viewer]) {
        const before = (await who.get('/insights').expect(200)).body.items.map((i: { id: string; title: string }) => ({ id: i.id, title: i.title }));
        if (before.length) await who.post('/insights/read', { items: before }).expect(201);
        expect((await who.get('/insights').expect(200)).body.alerts).toBe(0);
      }
      const a1 = await addAlert(orgId, 'US stalled');
      await addAlert(orgId, 'DE behind pace');
      let r = (await pm.get('/insights').expect(200)).body;
      expect(r.alerts).toBe(2);
      expect(r.unread).toBe(2);
      expect(r.items.find((i: { id: string }) => i.id === `alert-${a1.id}`).read).toBe(false);

      await pm.post('/insights/read', { items: [{ id: `alert-${a1.id}`, title: 'US stalled' }] }).expect(201);
      r = (await pm.get('/insights').expect(200)).body;
      expect(r.alerts).toBe(1);
      expect(r.alertsTotal).toBe(3);
      expect(r.items.find((i: { id: string }) => i.id === `alert-${a1.id}`).read).toBe(true);

      // A colleague still sees both as new.
      expect((await viewer.get('/insights').expect(200)).body.alerts).toBe(2);

      // Changed wording counts as new again.
      await prisma.alert.update({ where: { id: a1.id }, data: { title: 'US stalled for 4 hours' } });
      expect((await pm.get('/insights').expect(200)).body.alerts).toBe(2);

      // Marking twice is fine.
      const all = (await pm.get('/insights').expect(200)).body.items.map((i: { id: string; title: string }) => ({ id: i.id, title: i.title }));
      await pm.post('/insights/read', { items: all }).expect(201);
      await pm.post('/insights/read', { items: all }).expect(201);
      expect((await pm.get('/insights').expect(200)).body.alerts).toBe(0);
    });

    it('validates input and never touches another organisation', async () => {
      await pm.post('/insights/read', { items: [] }).expect(400);
      await pm.post('/insights/read', { items: [{ id: 'x' }] }).expect(400);
      await pm.post('/insights/read', { items: [{ id: 'x', title: 'y', extra: 1 }] }).expect(400);
      await addAlert(otherOrgId, 'Other org alert');
      expect((await other.get('/insights').expect(200)).body.alerts).toBe(1);
      const reads = await prisma.notificationRead.findMany({ where: { organizationId: otherOrgId } });
      expect(reads).toHaveLength(0);
    });
  });

  describe('Audience question sets', () => {
    it('lists the seven built-in sets with valid questions in the project currency', async () => {
      const sets = (await viewer.get('/question-templates/sets?currency=INR').expect(200)).body;
      expect(sets.map((s: { key: string }) => s.key)).toEqual(['b2b', 'b2c', 'parents', 'teens', 'hc_consumer', 'hc_patient', 'hc_caregiver']);
      for (const s of sets) {
        expect(s.questions.length).toBeGreaterThan(3);
        // Every built-in set saves cleanly as a project's gate questions.
        await pm.patch(`/projects/${projectId}`, { gateQuestions: s.questions }).expect(200);
      }
      const b2c = sets.find((s: { key: string }) => s.key === 'b2c');
      expect(JSON.stringify(b2c.questions)).toContain('lakh');
      const teens = sets.find((s: { key: string }) => s.key === 'teens');
      expect(teens.questions.find((q: { id: string }) => q.id === 'age').qualify).toEqual({ min: 13, max: 17 });
    });

    it("saves the organisation's version of a set, resets it, and keeps custom sets", async () => {
      const sets = (await pm.get('/question-templates/sets').expect(200)).body;
      const b2b = sets.find((s: { key: string }) => s.key === 'b2b');
      const edited = [...b2b.questions.slice(0, 2), { id: 'seniority_years', type: 'number', text: 'How many years have you worked in your field?', required: true, validation: { min: 0, max: 60, integer: true } }];
      await viewer.put('/question-templates/sets/b2b', { name: 'B2B', questions: edited }).expect(403);
      await pm.put('/question-templates/sets/b2b', { name: 'B2B (our version)', questions: edited }).expect(200);
      let list = (await pm.get('/question-templates/sets').expect(200)).body;
      let mine = list.find((s: { key: string }) => s.key === 'b2b');
      expect(mine).toMatchObject({ name: 'B2B (our version)', edited: true, builtIn: true, updatedBy: 'PROJECT_MANAGER' });
      expect(mine.questions.map((q: { id: string }) => q.id)).toEqual(['employment', 'job_level', 'seniority_years']);
      // Other organisations still get the standard set.
      expect((await other.get('/question-templates/sets').expect(200)).body.find((s: { key: string }) => s.key === 'b2b').edited).toBe(false);

      const created = (await pm.put('/question-templates/sets/new', { name: 'IT decision makers', description: 'Our usual IT DM screener', questions: edited }).expect(200)).body;
      expect(created.key).toMatch(/^custom-[a-f0-9]{12}$/);
      list = (await pm.get('/question-templates/sets').expect(200)).body;
      expect(list.at(-1)).toMatchObject({ key: created.key, name: 'IT decision makers', builtIn: false });
      expect((await other.get('/question-templates/sets').expect(200)).body).toHaveLength(7);

      // Bad input.
      await pm.put('/question-templates/sets/b2b', { name: 'x', questions: edited }).expect(400);
      await pm.put('/question-templates/sets/b2b', { name: 'Empty', questions: [] }).expect(400);
      await pm.put('/question-templates/sets/b2b', { name: 'Dupes', questions: [edited[0], edited[0]] }).expect(400);
      await pm.put('/question-templates/sets/hacker', { name: 'Nope', questions: edited }).expect(400);
      await other.delete(`/question-templates/sets/${created.key}`).expect(404);

      await pm.delete('/question-templates/sets/b2b').expect(200);
      mine = (await pm.get('/question-templates/sets').expect(200)).body.find((s: { key: string }) => s.key === 'b2b');
      expect(mine.edited).toBe(false);
      expect(mine.questions.length).toBe(6);
      await pm.delete(`/question-templates/sets/${created.key}`).expect(200);
      expect((await pm.get('/question-templates/sets').expect(200)).body).toHaveLength(7);
    });
  });
});
