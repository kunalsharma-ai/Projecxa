import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { deflateSync } from 'zlib';
import { BrandingService } from '../../src/branding/branding';
import { Mail, MailService } from '../../src/mail/mail.service';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

/** A valid PNG of the given size (solid colour), built by hand so the test needs no image library. */
function png(w: number, h: number) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x55)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

describe('White-label branding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: ReturnType<typeof api>;
  let adminToken: string;
  let pm: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let txt: string[][] = [];
  const sent: { from: string; mail: Mail }[] = [];
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'brand');
    const b = await makeOrg(prisma, 'brand-other');
    adminToken = await login(app, a.users.ADMIN.email);
    admin = api(app, adminToken);
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    other = api(app, await login(app, b.users.ADMIN.email));
    app.get(MailService).transport = async (from, mail) => { sent.push({ from, mail }); return { messageId: 'x' }; };
    app.get(BrandingService).resolveTxt = async () => txt;
  });

  afterAll(async () => {
    app.get(MailService).transport = null;
    await app.close();
  });

  it('starts with the default brand and lets only admins change it', async () => {
    const start = (await pm.get('/branding').expect(200)).body;
    expect(start.brand).toMatchObject({ appName: 'PROJEXA', custom: false, logoUrl: null });
    const body = { appName: 'Acme Insight Hub', tagline: 'Fieldwork by Acme', brandColor: '#0f766e', theme: 'emerald', hidePoweredBy: true, supportEmail: 'help@acme.example', emailFromName: 'Acme Fieldwork', emailReplyTo: 'ops@acme.example', loginMessage: 'Staff and partners only.' };
    await pm.put('/branding', body).expect(403);
    await admin.put('/branding', { ...body, brandColor: 'teal' }).expect(400);
    await admin.put('/branding', { ...body, appName: '<b>x</b>' }).expect(400);
    await admin.put('/branding', { ...body, theme: 'vaporwave' }).expect(400);
    const saved = (await admin.put('/branding', body).expect(200)).body;
    expect(saved.brand).toMatchObject({ appName: 'Acme Insight Hub', custom: true, brandColor: '#0f766e', theme: 'emerald', hidePoweredBy: true });
    const me = (await pm.get('/auth/me').expect(200)).body;
    expect(me.branding).toMatchObject({ appName: 'Acme Insight Hub', hidePoweredBy: true });
    expect((await other.get('/auth/me').expect(200)).body.branding.appName).toBe('PROJEXA');
  });

  it('accepts PNG, JPEG and WebP logos only, and serves them publicly with a locked-down policy', async () => {
    const up = (kind: string, buf: Buffer, name = 'logo.png') => http().post(`/api/v1/branding/assets/${kind}`).set('Authorization', `Bearer ${adminToken}`).attach('file', buf, name);
    await up('logo', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'logo.svg').expect(400);
    await up('logo', Buffer.from('GIF89a....'), 'logo.gif').expect(400);
    await up('banner', png(4, 4)).expect(404);
    await up('icon', png(64, 32)).expect(400).then((r) => expect(r.body.message).toContain('square'));
    await up('logo', Buffer.alloc(600 * 1024, 1)).expect(413);
    const after = (await up('logo', png(240, 60)).expect(201)).body;
    await up('icon', png(64, 64)).expect(201);
    expect(after.brand.logoUrl).toMatch(/\/api\/v1\/public\/branding\/brand\/logo\?v=[0-9a-f]{12}$/);
    const asset = await http().get('/api/v1/public/branding/brand/logo').expect(200);
    expect(asset.headers['content-type']).toBe('image/png');
    expect(asset.headers['content-security-policy']).toContain("default-src 'none'");
    expect(asset.headers['x-content-type-options']).toBe('nosniff');
    await http().get('/api/v1/public/branding/brand-other/logo').expect(404);
    await http().get('/api/v1/public/branding/brand/secrets').expect(404);
    await pm.delete('/branding/assets/icon').expect(403);
    expect((await admin.delete('/branding/assets/icon').expect(200)).body.brand.iconUrl).toBeNull();
  });

  it('verifies a custom domain by DNS before using it', async () => {
    await admin.put('/branding/domain', { domain: 'not a domain' }).expect(400);
    await pm.put('/branding/domain', { domain: 'research.acme.example' }).expect(403);
    const set = (await admin.put('/branding/domain', { domain: 'https://Research.Acme.example/login' }).expect(200)).body;
    expect(set.domain).toMatchObject({ name: 'research.acme.example', verified: false, record: { type: 'TXT', name: '_projexa.research.acme.example' } });
    await other.put('/branding/domain', { domain: 'research.acme.example' }).expect(409);

    // Not used before it is verified.
    expect((await http().get('/api/v1/public/branding?host=research.acme.example').expect(200)).body).toMatchObject({ default: true, appName: 'PROJEXA' });
    txt = [['projexa-verify=wrong']];
    expect((await admin.post('/branding/domain/verify').expect(200)).body).toMatchObject({ verified: false, found: 1 });
    txt = [['unrelated'], [set.domain.record.value.slice(0, 20), set.domain.record.value.slice(20)]];
    expect((await admin.post('/branding/domain/verify').expect(200)).body).toMatchObject({ verified: true, domain: { verified: true } });

    const pub = (await http().get('/api/v1/public/branding?host=RESEARCH.acme.example:443').expect(200)).body;
    expect(pub).toMatchObject({ default: false, appName: 'Acme Insight Hub', organization: { slug: 'brand' }, loginMessage: 'Staff and partners only.' });
    expect(pub).not.toHaveProperty('emailReplyTo');
    expect(pub.logoUrl).toContain('/public/branding/brand/logo');

    // Changing the domain needs a new check.
    const moved = (await admin.put('/branding/domain', { domain: 'hub.acme.example' }).expect(200)).body;
    expect(moved.domain.verified).toBe(false);
    expect(moved.domain.record.value).not.toBe(set.domain.record.value);
    txt = [[moved.domain.record.value]];
    await admin.post('/branding/domain/verify').expect(200);
  });

  it('brands emails: sender name, reply-to, product name, logo and links on the custom domain', async () => {
    sent.length = 0;
    await admin.post('/team', { email: 'new.person@brand.test', name: 'New Person', role: 'VIEWER' }).expect(201);
    expect(sent).toHaveLength(1);
    const { from, mail } = sent[0];
    expect(from).toBe('"Acme Fieldwork" <reports@projexa.test>');
    expect(mail.replyTo).toBe('ops@acme.example');
    expect(mail.subject).toBe('You’re invited to brand on Acme Insight Hub'.replace('’', "'"));
    expect(mail.html).toContain('/api/v1/public/branding/brand/logo');
    expect(mail.html).toContain('background:#0f766e');
    expect(mail.html).not.toContain('PROJEXA');
    expect(mail.text).toContain('https://hub.acme.example/set-password?token=');
    expect(mail.html).toContain('help@acme.example');

    // Removing the domain sends links to the main app address again.
    await admin.delete('/branding/domain').expect(200);
    sent.length = 0;
    await admin.post('/team', { email: 'second@brand.test', name: 'Second', role: 'VIEWER' }).expect(201);
    expect(sent[0].mail.text).not.toContain('hub.acme.example');
    expect((await http().get('/api/v1/public/branding?host=hub.acme.example').expect(200)).body.default).toBe(true);
    expect(await prisma.auditEvent.count({ where: { action: { startsWith: 'branding.' } } })).toBeGreaterThanOrEqual(7);
  });
});
