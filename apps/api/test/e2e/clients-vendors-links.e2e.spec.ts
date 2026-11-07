import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { linksFromText } from '../../src/client-links/client-links';
import { sniffLogo, svgProblem } from '../../src/parties/logos';
import { api, createApp, login, makeOrg, resetDb, tokenFrom } from './helpers';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const GIF = Buffer.from('47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b', 'hex');
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#7B4DFF"/></svg>');

describe('Clients and vendors: status, logos, numbering, UID prefix and client unique links (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let pmToken: string;
  let otherToken: string;
  let clientId: string;
  let vendorId: string;
  const http = () => request(app.getHttpServer());
  const upload = (path: string, file: Buffer, name: string, token = pmToken) => http().post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).attach('file', file, name);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'cvl');
    const b = await makeOrg(prisma, 'cvl-other');
    pmToken = await login(app, a.users.PROJECT_MANAGER.email);
    otherToken = await login(app, b.users.PROJECT_MANAGER.email);
    pm = api(app, pmToken);
    admin = api(app, await login(app, a.users.ADMIN.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, otherToken);
    clientId = (await pm.post('/clients', { name: 'Ace Research', code: 'ACE', contacts: [{ name: 'Pat Lee', email: 'pat.lee@aceresearch.com' }] }).expect(201)).body.id;
    vendorId = (await pm.post('/vendors', { name: 'Panel One', code: 'P1', contactName: 'Liv', contactEmail: 'liv@panelone.com' }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
  });

  const project = (body: Record<string, unknown> = {}) =>
    pm.post('/projects', {
      name: 'Study',
      category: 'B2C',
      clientId,
      defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 3, targetCompletes: 50, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
      countries: [{ countryCode: 'US' }],
      ...body,
    });

  it('switches clients and vendors active or inactive; inactive ones cannot be used on projects', async () => {
    await viewer.patch(`/clients/${clientId}/status`, { status: 'INACTIVE' }).expect(403);
    await other.patch(`/clients/${clientId}/status`, { status: 'INACTIVE' }).expect(404);
    await pm.patch(`/clients/${clientId}/status`, { status: 'INACTIVE' }).expect(200);
    expect((await pm.get('/clients?status=ACTIVE').expect(200)).body).toHaveLength(0);
    expect((await pm.get('/clients').expect(200)).body).toHaveLength(1);
    const refused = await project().expect(400);
    expect(refused.body.code ?? refused.body.message?.code).toBe('CLIENT_INACTIVE');
    await pm.patch(`/clients/${clientId}/status`, { status: 'ACTIVE' }).expect(200);

    await pm.patch(`/vendors/${vendorId}/status`, { status: 'INACTIVE' }).expect(200);
    expect((await pm.get('/vendors?status=ACTIVE').expect(200)).body).toHaveLength(0);
    await project({ vendors: [{ vendorId, cpi: 1, uidParam: 'vid' }] }).expect(400);
    const p = (await project().expect(201)).body;
    await pm.post(`/projects/${p.id}/countries/${p.countries[0].id}/allocations`, { vendorId, cpi: 1, targetCompletes: 10 }).expect(400);
    await pm.patch(`/vendors/${vendorId}/status`, { status: 'ACTIVE' }).expect(200);
    await pm.post(`/projects/${p.id}/countries/${p.countries[0].id}/allocations`, { vendorId, cpi: 1, targetCompletes: 10 }).expect(201);
  });

  it('recognises image formats by their bytes and refuses active SVGs', () => {
    expect(sniffLogo(PNG)).toBe('image/png');
    expect(sniffLogo(GIF)).toBe('image/gif');
    expect(sniffLogo(SVG)).toBe('image/svg+xml');
    expect(sniffLogo(Buffer.from('BM\x00\x00\x00\x00', 'latin1'))).toBe('image/bmp');
    expect(sniffLogo(Buffer.from('hello world'))).toBeNull();
    expect(svgProblem(SVG)).toBeNull();
    expect(svgProblem(Buffer.from('<svg onload="alert(1)"></svg>'))).toMatch(/scripts/);
    expect(svgProblem(Buffer.from('<svg><script>x</script></svg>'))).toMatch(/scripts/);
    expect(svgProblem(Buffer.from('<svg><image href="https://evil.example.com/x.png"/></svg>'))).toMatch(/internet/);
  });

  it('uploads, serves and removes client and vendor logos (small images only)', async () => {
    await upload(`/clients/${clientId}/logo`, Buffer.from('not an image'), 'x.png').expect(400);
    await upload(`/clients/${clientId}/logo`, Buffer.concat([PNG, Buffer.alloc(201 * 1024)]), 'big.png').expect((r) => expect([400, 413]).toContain(r.status));
    await upload(`/clients/${clientId}/logo`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'), 'evil.svg').expect(400);
    await upload(`/clients/${clientId}/logo`, PNG, 'logo.png', otherToken).expect(404);
    const up = (await upload(`/clients/${clientId}/logo`, PNG, 'logo.png').expect(201)).body;
    expect(up).toMatchObject({ contentType: 'image/png', bytes: PNG.length });
    expect(up.logoUrl).toMatch(new RegExp(`^/clients/${clientId}/logo\\?v=`));

    const list = (await pm.get('/clients').expect(200)).body;
    expect(list[0].logoUrl).toBe(up.logoUrl);
    expect(list[0].logo).toBeUndefined();
    const img = await pm.get(`/clients/${clientId}/logo`).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(img.headers['content-security-policy']).toMatch(/sandbox/);
    await other.get(`/clients/${clientId}/logo`).expect(404);

    // Vendors: SVG and GIF are fine too.
    await upload(`/vendors/${vendorId}/logo`, SVG, 'logo.svg').expect(201);
    expect((await pm.get(`/vendors/${vendorId}/logo`).expect(200)).headers['content-type']).toBe('image/svg+xml');
    await upload(`/vendors/${vendorId}/logo`, GIF, 'logo.gif').expect(201);
    expect((await pm.get(`/vendors/${vendorId}`).expect(200)).body.logoUrl).toMatch(/^\/vendors\/.+\/logo\?v=/);

    // Project shows the client with logo and contacts, and vendor logos.
    const p = (await project({ clientContactId: list[0].contacts[0].id, vendors: [{ vendorId, cpi: 1, uidParam: 'vid' }] }).expect(201)).body;
    const got = (await pm.get(`/projects/${p.id}`).expect(200)).body;
    expect(got.client.logoUrl).toBe(up.logoUrl);
    expect(got.clientContact).toMatchObject({ name: 'Pat Lee', email: 'pat.lee@aceresearch.com' });
    expect(got.countries[0].allocations[0].vendor.logoUrl).toMatch(/^\/vendors\//);

    await pm.delete(`/clients/${clientId}/logo`).expect(200);
    await pm.get(`/clients/${clientId}/logo`).expect(404);
  });

  it('numbers work orders with the prefix, takes typed ones and never uses one twice', async () => {
    const n0 = (await viewer.get('/numbering').expect(200)).body;
    expect(n0).toMatchObject({ workOrderPrefix: 'WO', nextWorkOrderNo: 'WO9001', lastWorkOrderNo: null });
    await pm.put('/numbering', { workOrderPrefix: 'FR', nextWorkOrderNumber: 9131, uidPrefix: null }).expect(403);
    await admin.put('/numbering', { workOrderPrefix: 'F R', nextWorkOrderNumber: 9131, uidPrefix: null }).expect(400);
    const n1 = (await admin.put('/numbering', { workOrderPrefix: 'FR', nextWorkOrderNumber: 9131, uidPrefix: '' }).expect(200)).body;
    expect(n1).toMatchObject({ nextWorkOrderNo: 'FR9131', uidPrefix: null });

    const a = (await project({ generateWorkOrder: true }).expect(201)).body;
    expect(a.workOrderNo).toBe('FR9131');
    expect((await pm.get('/numbering').expect(200)).body).toMatchObject({ lastWorkOrderNo: 'FR9131', nextWorkOrderNo: 'FR9132' });

    // Typed by hand past the counter: the counter follows.
    const b = (await project({ workOrderNo: 'FR9140' }).expect(201)).body;
    expect(b.workOrderNo).toBe('FR9140');
    expect((await pm.get('/numbering').expect(200)).body).toMatchObject({ lastWorkOrderNo: 'FR9140', nextWorkOrderNo: 'FR9141' });
    await project({ workOrderNo: 'fr9140' }).expect(409);

    // Generated numbers skip ones typed by hand.
    await project({ workOrderNo: 'FR9141' }).expect(201);
    await admin.put('/numbering', { workOrderPrefix: 'FR', nextWorkOrderNumber: 9141, uidPrefix: null }).expect(409);
    await admin.put('/numbering', { workOrderPrefix: 'FR', nextWorkOrderNumber: 9139, uidPrefix: null }).expect(200);
    const c = (await project({ generateWorkOrder: true }).expect(201)).body;
    expect(c.workOrderNo).toBe('FR9139');
    const d = (await project({ generateWorkOrder: true }).expect(201)).body;
    expect(d.workOrderNo).toBe('FR9142');

    // Edit later; still unique.
    await pm.patch(`/projects/${d.id}`, { workOrderNo: 'FR9131' }).expect(409);
    expect((await pm.patch(`/projects/${d.id}`, { workOrderNo: 'FR-SPECIAL-1' }).expect(200)).body.workOrderNo).toBe('FR-SPECIAL-1');
  });

  it('checks that a project contact belongs to its client when changed later', async () => {
    const p = (await project().expect(201)).body;
    const stranger = (await pm.post('/clients', { name: 'Other client', code: 'OTH', contacts: [{ name: 'Sam', email: 'sam@other.example.com' }] }).expect(201)).body;
    await pm.patch(`/projects/${p.id}`, { clientContactId: stranger.contacts[0].id }).expect(400);
  });

  describe('client unique links and the UID prefix', () => {
    let projectId: string;
    let countryId: string;
    let entryCode: string;
    let testEntryCode: string;
    const enter = (code: string, uid: string) => http().get(`/s/${code}?vid=${uid}`).set('User-Agent', UA).set('X-Forwarded-For', '198.51.100.7').expect(302);

    beforeAll(async () => {
      await admin.put('/numbering', { workOrderPrefix: 'FR', nextWorkOrderNumber: 9200, uidPrefix: 'SMP-' }).expect(200);
      const p = (await project({ name: 'Client links study', vendors: [{ vendorId, cpi: 1, uidParam: 'vid' }] }).expect(201)).body;
      projectId = p.id;
      countryId = p.countries[0].id;
      const got = (await pm.get(`/projects/${projectId}`).expect(200)).body;
      ({ entryCode, testEntryCode } = got.countries[0].allocations[0]);
    });

    it('reads links from text and CSV files', () => {
      expect(linksFromText('url\nhttps://a.example.com/s?id=1\n"https://a.example.com/s?id=2",x\n\nnot a link\n')).toEqual(['https://a.example.com/s?id=1', 'https://a.example.com/s?id=2', 'not a link']);
    });

    it('uploads links per market, skipping bad lines and repeats, with a dry run first', async () => {
      const urls = ['https://c.example.com/s?id=1', 'https://c.example.com/s?id=2', 'https://c.example.com/s?id=2', 'ftp://nope', 'https://c.example.com/s?id=3'];
      await viewer.post(`/projects/${projectId}/client-links`, { countryId, urls }).expect(403);
      await other.post(`/projects/${projectId}/client-links`, { countryId, urls }).expect(404);
      const dry = (await pm.post(`/projects/${projectId}/client-links`, { countryId, urls, dryRun: true }).expect(201)).body;
      expect(dry).toMatchObject({ dryRun: true, valid: 3, added: 0, invalid: 1, repeatedInFile: 1, alreadyUploaded: 0 });
      expect(await prisma.clientUniqueLink.count({ where: { projectId } })).toBe(0);
      const real = (await pm.post(`/projects/${projectId}/client-links`, { countryId, urls, label: 'Batch A' }).expect(201)).body;
      expect(real.added).toBe(3);
      const again = (await pm.post(`/projects/${projectId}/client-links`, { countryId, urls: ['https://c.example.com/s?id=3'] }).expect(201)).body;
      expect(again).toMatchObject({ added: 0, alreadyUploaded: 1 });

      // A file (CSV/text) works the same.
      const file = await http()
        .post(`/api/v1/projects/${projectId}/client-links/file`)
        .set('Authorization', `Bearer ${pmToken}`)
        .field('countryId', countryId)
        .field('label', 'links.csv')
        .attach('file', Buffer.from('link\nhttps://c.example.com/s?id=4\nhttps://c.example.com/s?id=1\n'), 'links.csv')
        .expect(201);
      expect(file.body).toMatchObject({ added: 1, alreadyUploaded: 1 });
      const s = (await viewer.get(`/projects/${projectId}/client-links/summary`).expect(200)).body;
      expect(s.markets[0]).toMatchObject({ total: 4, unused: 4, assigned: 0, useClientLinks: false });
      expect(s.uploads.map((u: { label: string }) => u.label).sort()).toEqual(['Batch A', 'links.csv']);
    });

    it('gives each live respondent their own client link, never twice, and adds the UID prefix', async () => {
      await pm.post(`/projects/${projectId}/client-links/countries/${countryId}/mode`, { useClientLinks: true }).expect(201);
      // The live survey link is not needed any more.
      await pm.patch(`/projects/${projectId}/countries/${countryId}`, { liveSurveyUrl: null }).expect((r) => expect([200, 400]).toContain(r.status));
      await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
      await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);

      // Test links borrow a link without using it up.
      const t = await enter(testEntryCode, 'tester-1');
      expect(t.headers.location).toMatch(/^https:\/\/c\.example\.com\/s\?id=1/);
      expect((await pm.get(`/projects/${projectId}/client-links/summary`).expect(200)).body.markets[0].unused).toBe(4);

      const r1 = await enter(entryCode, 'resp-1');
      const r2 = await enter(entryCode, 'resp-2');
      expect(r1.headers.location).toMatch(/^https:\/\/c\.example\.com\/s\?id=1&token=SMP-/);
      expect(r2.headers.location).toMatch(/^https:\/\/c\.example\.com\/s\?id=2&token=SMP-/);
      const token1 = tokenFrom(r1.headers.location);
      expect(token1.startsWith('SMP-')).toBe(true);
      const link1 = await prisma.clientUniqueLink.findFirstOrThrow({ where: { url: 'https://c.example.com/s?id=1', projectId } });
      expect(link1.status).toBe('ASSIGNED');
      expect((await prisma.respondentSession.findUniqueOrThrow({ where: { id: link1.sessionId! } })).token).toBe(token1);

      // The outcome comes back with the prefixed token as usual.
      const done = await http().get(`/r/complete?token=${encodeURIComponent(token1)}`).expect(302);
      expect(done.headers.location).toBeTruthy();
      expect((await prisma.respondentSession.findUniqueOrThrow({ where: { token: token1 } })).status).toBe('COMPLETE');

      // Many at once: every link goes to one respondent only.
      const rs = await Promise.all(['resp-3', 'resp-4', 'resp-5', 'resp-6'].map((u) => enter(entryCode, u)));
      const given = rs.map((r) => r.headers.location as string).filter((l) => l.startsWith('https://c.example.com/'));
      expect(given).toHaveLength(2);
      expect(new Set(given.map((l) => l.split('&')[0])).size).toBe(2);
      const none = await prisma.respondentSession.findMany({ where: { projectId, statusDetail: 'NO_CLIENT_LINK' } });
      expect(none).toHaveLength(2);
      expect(none.every((x) => x.status === 'TECHNICAL_ERROR')).toBe(true);

      const list = (await pm.get(`/projects/${projectId}/client-links?status=ASSIGNED`).expect(200)).body;
      expect(list.total).toBe(4);
      expect(list.rows[0].session.token).toMatch(/^SMP-/);
      const csv = await pm.get(`/projects/${projectId}/client-links/export.csv`).expect(200);
      expect(csv.text).toContain('https://c.example.com/s?id=1');
      expect(csv.text).toContain('Given out');
    });

    it('gives the link after the gate page, and the same one again on reload', async () => {
      await pm.post(`/projects/${projectId}/client-links`, { countryId, urls: ['https://c.example.com/s?id=gate1', 'https://c.example.com/s?id=gate2'] }).expect(201);
      await pm.patch(`/projects/${projectId}`, { security: { browserFingerprinting: true } }).expect(200);
      const entry = await enter(entryCode, 'resp-gate');
      expect(entry.headers.location).toMatch(/\/g\/SMP-/);
      const token = decodeURIComponent(entry.headers.location.split('/g/')[1]);
      // Nothing is given out before the gate is passed.
      expect(await prisma.clientUniqueLink.count({ where: { projectId, url: { contains: 'gate' }, status: 'ASSIGNED' } })).toBe(0);
      const passed = await http().post(`/g/${encodeURIComponent(token)}`).send({ fingerprint: 'a'.repeat(64) }).expect(200);
      expect(passed.body.location).toMatch(/^https:\/\/c\.example\.com\/s\?id=gate1&token=SMP-/);
      const again = await http().get(`/g/${encodeURIComponent(token)}`).expect(302);
      expect(again.headers.location).toBe(passed.body.location);
      expect(await prisma.clientUniqueLink.count({ where: { projectId, url: { contains: 'gate' }, status: 'ASSIGNED' } })).toBe(1);
      await pm.patch(`/projects/${projectId}`, { security: {} }).expect(200);
      await pm.post(`/projects/${projectId}/client-links/remove`, { countryId }).expect(201);
    });

    it('lists a market with no links left as not ready, and removes only unused links', async () => {
      const s = (await pm.get(`/projects/${projectId}/client-links/summary`).expect(200)).body;
      expect(s.markets[0]).toMatchObject({ unused: 0, assigned: 5, low: true });
      await pm.post(`/projects/${projectId}/client-links`, { countryId, urls: ['https://c.example.com/s?id=9'] }).expect(201);
      expect((await pm.post(`/projects/${projectId}/client-links/remove`, { countryId }).expect(201)).body.removed).toBe(1);
      expect(await prisma.clientUniqueLink.count({ where: { projectId } })).toBe(5);
      await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'HOLD' }).expect(200);
      const bad = await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'LIVE' }).expect(400);
      expect(JSON.stringify(bad.body)).toMatch(/client unique links/i);
      await pm.post(`/projects/${projectId}/client-links/countries/${countryId}/mode`, { useClientLinks: false }).expect(201);
    });
  });

  it('takes a full bulk import of 1000 rows in one request', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ name: `Bulk client ${i}`, website: `bulk${i}.example.com`, contact_name: `Contact ${i}`, contact_email: `contact${i}@bulk${i}.example.com`, billing_address: `${i} Long Street, Some Town, Some County, AB1 2CD, United Kingdom`.padEnd(150, '.') }));
    expect(JSON.stringify({ rows }).length).toBeGreaterThan(200_000);
    const r = (await pm.post('/clients/import', { rows, dryRun: true }).expect(201)).body;
    expect(r.valid).toBe(1000);
  });

  it('renames an option someone added with Add +', async () => {
    const a = (await pm.post('/custom-options', { field: 'category', value: 'Helthcare' }).expect(201)).body;
    await pm.post('/custom-options', { field: 'category', value: 'Automotive' }).expect(201);
    await viewer.patch(`/custom-options/${a.id}`, { value: 'Healthcare' }).expect(403);
    await pm.patch(`/custom-options/${a.id}`, { value: 'automotive' }).expect(409);
    expect((await pm.patch(`/custom-options/${a.id}`, { value: 'Healthcare' }).expect(200)).body.value).toBe('Healthcare');
  });
});
