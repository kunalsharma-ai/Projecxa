import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import request from 'supertest';
import { config } from '../../src/common/config';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
// Smallest valid PNG (1x1).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const DESIGN = {
  template: 'split',
  colors: { primary: '#7c3aed', accent: '#ec4899', background: '#f6f0ff', surface: '#ffffff', text: '#1b1029' },
  font: 'serif',
  radius: 'round',
  brandName: 'Acme Panel',
  footer: 'Thanks from the Acme team',
  confetti: true,
  texts: { complete: { title: 'Brilliant, thank you!', message: 'Points are on their way.', buttonLabel: 'Back to Acme', buttonUrl: 'https://acme.example.com/' } },
  interstitial: { enabled: false, seconds: 3 },
};

describe('Respondent pages (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let projectId: string;
  let entryCode: string;
  let otherProjectId: string;
  let n = 0;
  const http = () => request(app.getHttpServer());
  const BASE = config.publicBaseUrl;

  async function makeProject(client: ReturnType<typeof api>, code: string) {
    const clientId = (await client.post('/clients', { name: `Client ${code}`, code: `C${code}` }).expect(201)).body.id;
    const vendorId = (await client.post('/vendors', { name: `Vendor ${code}`, code: `V${code}` }).expect(201)).body.id;
    const p = (
      await client
        .post('/projects', {
          name: `Pages ${code}`,
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 2, targetCompletes: 100, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    const c = p.countries[0];
    await client.post(`/projects/${p.id}/countries/${c.id}/allocations`, { vendorId, cpi: 1, targetCompletes: 100 }).expect(201);
    await client.patch(`/projects/${p.id}/countries/${c.id}`, { status: 'LIVE' }).expect(200);
    await client.patch(`/projects/${p.id}`, { status: 'LIVE' }).expect(200);
    const alloc = (await client.get(`/projects/${p.id}`).expect(200)).body.countries[0].allocations[0];
    return { id: p.id as string, entryCode: alloc.entryCode as string };
  }

  /** Starts a session and returns its token (security off, so entry goes straight to the client survey). */
  async function start() {
    const res = await http().get(`/s/${entryCode}?uid=P${++n}`).set('User-Agent', DESKTOP).set('X-Forwarded-For', `198.51.100.${n}`).expect(302);
    return new URL(res.headers.location).searchParams.get('rid')!;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'pages');
    const b = await makeOrg(prisma, 'pages-other');
    const [tp, tv, to] = [await login(app, a.users.PROJECT_MANAGER.email), await login(app, a.users.VIEWER.email), await login(app, b.users.PROJECT_MANAGER.email)];
    pm = api(app, tp);
    viewer = api(app, tv);
    other = api(app, to);
    tokens.set(pm, tp).set(viewer, tv).set(other, to);
    ({ id: projectId, entryCode } = await makeProject(pm, 'A'));
    otherProjectId = (await makeProject(other, 'B')).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const tokens = new Map<ReturnType<typeof api>, string>();
  const upload = (client: ReturnType<typeof api>, id: string, buf: Buffer, name = 'logo.png') =>
    http().post(`/api/v1/projects/${id}/page-assets`).set('Authorization', `Bearer ${tokens.get(client)}`).attach('file', buf, name);

  it('returns the default design, templates and palettes', async () => {
    const r = await pm.get(`/projects/${projectId}/page-design`).expect(200);
    expect(r.body.custom).toBe(false);
    expect(r.body.design.template).toBe('aurora');
    expect(r.body.templates).toHaveLength(6);
    expect(r.body.palettes.length).toBeGreaterThanOrEqual(6);
    expect(r.body.statuses).toContain('quota_full');
    expect(r.body.assetBase).toBe(`${BASE}/pa/`);
  });

  it('validates and saves a design; viewers and other tenants cannot', async () => {
    await pm.put(`/projects/${projectId}/page-design`).send({ ...DESIGN, colors: { ...DESIGN.colors, primary: 'purple' } }).expect(400);
    await pm.put(`/projects/${projectId}/page-design`).send({ ...DESIGN, template: 'neon' }).expect(400);
    await pm.put(`/projects/${projectId}/page-design`).send({ ...DESIGN, texts: { complete: { buttonUrl: 'javascript:alert(1)' } } }).expect(400);
    await pm.put(`/projects/${projectId}/page-design`).send({ ...DESIGN, texts: { complete: { buttonUrl: 'http://acme.example.com' } } }).expect(400);
    await pm.put(`/projects/${projectId}/page-design`).send({ ...DESIGN, extra: 1 }).expect(400);
    await viewer.put(`/projects/${projectId}/page-design`).send(DESIGN).expect(403);
    await other.put(`/projects/${projectId}/page-design`).send(DESIGN).expect(404);
    const r = await pm.put(`/projects/${projectId}/page-design`).send(DESIGN).expect(200);
    expect(r.body.custom).toBe(true);
    expect(r.body.design).toMatchObject({ template: 'split', font: 'serif', brandName: 'Acme Panel' });
    const audit = await prisma.auditEvent.findFirst({ where: { action: 'project.page-design', entityId: projectId } });
    expect(audit).toBeTruthy();
  });

  it('uploads images: checks the bytes, the size and the tenant', async () => {
    await upload(pm, projectId, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'logo.png').expect(400);
    await upload(pm, projectId, Buffer.from('GIF89a').subarray(0, 3), 'x.gif').expect(400);
    await upload(pm, projectId, Buffer.concat([PNG, Buffer.alloc(1_600_000)]), 'big.png').expect(413);
    await upload(viewer, projectId, PNG).expect(403);
    await upload(other, projectId, PNG).expect(404);
    const up = await upload(pm, projectId, PNG).expect(201);
    expect(up.body).toMatchObject({ contentType: 'image/png', size: PNG.length, url: `${BASE}/pa/${up.body.id}` });

    const served = await http().get(`/pa/${up.body.id}`).expect(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-security-policy']).toBe("default-src 'none'");
    expect(served.headers['cache-control']).toContain('immutable');
    expect(Buffer.compare(served.body, PNG)).toBe(0);
    await http().get('/pa/doesnotexist0000000000000').expect(404);
    await http().get('/pa/..%2F..%2Fetc').expect(404);

    // Another tenant's image cannot be used in a design.
    const foreign = await upload(other, otherProjectId, PNG).expect(201);
    await pm.put(`/projects/${projectId}/page-design`).send({ ...DESIGN, logoAssetId: foreign.body.id }).expect(400);
    await pm.put(`/projects/${projectId}/page-design`).send({ ...DESIGN, logoAssetId: up.body.id, heroAssetId: up.body.id }).expect(200);
  });

  it('previews unsaved designs for every page, including the gate', async () => {
    for (const page of ['complete', 'terminate', 'quota_full', 'security_reject', 'gate']) {
      const r = await pm.post(`/projects/${projectId}/page-design/preview`, { design: { ...DESIGN, template: 'bold' }, page }).expect(201);
      expect(r.body.html).toContain('<!doctype html>');
      expect(r.body.html).toContain('Acme Panel');
    }
    const c = await pm.post(`/projects/${projectId}/page-design/preview`, { design: DESIGN, page: 'complete' }).expect(201);
    expect(c.body.html).toContain('Brilliant, thank you!');
    const i = await pm.post(`/projects/${projectId}/page-design/preview`, { design: DESIGN, page: 'terminate', interstitial: true }).expect(201);
    expect(i.body.html).toContain('vendor.example.com/return');
    await pm.post(`/projects/${projectId}/page-design/preview`, { design: DESIGN, page: 'nope' }).expect(400);
    await other.post(`/projects/${projectId}/page-design/preview`, { design: DESIGN, page: 'complete' }).expect(404);
  });

  it("renders the internal end page in the project's design, with a strict CSP", async () => {
    const token = await start();
    const done = await http().get(`/r/complete?token=${token}`).expect(302);
    expect(done.headers.location).toBe(`${BASE}/end/complete?t=${encodeURIComponent(token)}`);
    const page = await http().get(new URL(done.headers.location).pathname + new URL(done.headers.location).search).expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toMatch(/default-src 'none'; script-src 'nonce-[^']+'; style-src 'nonce-[^']+'; img-src 'self' data:/);
    expect(page.text).toContain('Brilliant, thank you!');
    expect(page.text).toContain('Acme Panel');
    expect(page.text).toContain('/pa/');
    expect(page.text).not.toMatch(/ style="/);
  });

  it('shows the real outcome, not the one typed in the URL, and falls back to the default design', async () => {
    const token = await start();
    await http().get(`/r/terminate?token=${token}`).expect(302);
    const forged = await http().get(`/end/complete?t=${encodeURIComponent(token)}`).expect(200);
    expect(forged.text).not.toContain('Brilliant, thank you!');
    expect(forged.text).toContain('Thanks for your interest');
    const anon = await http().get('/end/quota_full').expect(200);
    expect(anon.text).toContain('This survey is now full');
    expect(anon.text).not.toContain('Acme Panel');
    const junk = await http().get('/end/%3Cscript%3E').expect(200);
    expect(junk.text).not.toContain('<script>alert');
  });

  it('interstitial: shows the designed page first, then continues to the vendor link', async () => {
    const vendorRules = {
      mode: 'HYBRID',
      config: {
        rules: [{ status: 'COMPLETE', type: 'STATIC', url: 'https://vendor.example.com/complete', enabled: true, callbackRequired: false }],
        params: [],
      },
      changeReason: 'test',
    };
    const draft = await pm.post(`/projects/${projectId}/redirects/versions`, vendorRules).expect(201);
    await pm.post(`/projects/${projectId}/redirects/versions/${draft.body.version.id}/activate`).expect(201);

    // Off: straight to the vendor.
    const t1 = await start();
    expect((await http().get(`/r/complete?token=${t1}`).expect(302)).headers.location).toMatch(/^https:\/\/vendor\.example\.com\/complete/);

    await pm.put(`/projects/${projectId}/page-design`).send({ ...DESIGN, interstitial: { enabled: true, seconds: 4 } }).expect(200);
    const t2 = await start();
    const r = await http().get(`/r/complete?token=${t2}`).expect(302);
    expect(r.headers.location).toBe(`${BASE}/end/complete?t=${encodeURIComponent(t2)}`);
    const page = await http().get(`/end/complete?t=${encodeURIComponent(t2)}`).expect(200);
    expect(page.text).toContain('https://vendor.example.com/complete');
    expect(page.text).toContain('Brilliant, thank you!');
    // Outcome was recorded once, with the vendor link as destination.
    const s = await prisma.respondentSession.findUniqueOrThrow({ where: { token: t2 } });
    expect(s.status).toBe('COMPLETE');
    const execs = await prisma.redirectExecution.findMany({ where: { sessionId: s.id } });
    expect(execs).toHaveLength(1);
    expect(execs[0].destination).toMatch(/^https:\/\/vendor\.example\.com\/complete/);
  });

  it('the gate page uses the project design', async () => {
    await pm.patch(`/projects/${projectId}`, { security: { gateSurvey: true } }).expect(200);
    const res = await http().get(`/s/${entryCode}?uid=G${++n}`).set('User-Agent', DESKTOP).set('X-Forwarded-For', '198.51.100.200').expect(302);
    expect(res.headers.location).toMatch(/\/g\//);
    const gate = await http().get(new URL(res.headers.location).pathname).expect(200);
    expect(gate.text).toContain('Acme Panel');
    expect(gate.text).toContain('#7c3aed');
    expect(gate.text).not.toMatch(/ style="/);
  });
});
