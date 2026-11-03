import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { ZohoBooksService } from '../../src/accounting/zoho-books.service';
import { IntegrationsHttp, IntegrationsService, isPrivateAddress } from '../../src/integrations/integrations.service';
import { MailService } from '../../src/mail/mail.service';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const ENV_KEYS = ['SMTP_USER', 'SMTP_PASS', 'SMTP_HOST', 'MAIL_FROM', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'GEMINI_API_KEY', 'ZOHO_BOOKS_CLIENT_ID', 'ZOHO_BOOKS_CLIENT_SECRET', 'ZOHO_BOOKS_REFRESH_TOKEN', 'ZOHO_BOOKS_ORGANIZATION_ID', 'ZOHO_BOOKS_TENANT', 'XERO_CLIENT_ID', 'XERO_CLIENT_SECRET', 'QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'TALLY_URL', 'TALLY_TENANT'];

type Reply = { status: number; body: unknown };
const reply = (status: number, body: unknown) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

describe('Settings → Integrations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let svc: IntegrationsService;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let otherAdmin: ReturnType<typeof api>;
  let ownerOrgId: string;
  const env = { ...process.env };
  const calls: { url: string; body?: string; headers?: Record<string, string> }[] = [];
  let route: (url: string, body?: string) => Reply = () => ({ status: 404, body: {} });

  beforeAll(async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'owner');
    ownerOrgId = a.org.id;
    await prisma.organization.update({ where: { id: a.org.id }, data: { platformOwner: true } });
    await makeOrg(prisma, 'tenant');
    admin = api(app, await login(app, 'admin@owner.test'));
    pm = api(app, await login(app, 'project_manager@owner.test'));
    otherAdmin = api(app, await login(app, 'admin@tenant.test'));
    svc = app.get(IntegrationsService);
    const http: IntegrationsHttp = async (url, init) => {
      calls.push({ url, body: init?.body, headers: init?.headers });
      const r = route(url, init?.body);
      return reply(r.status, r.body);
    };
    svc.http = http;
  });

  afterAll(async () => {
    process.env = env;
    await app.close();
  });

  const item = async (as: ReturnType<typeof api>, kind: string) => (await as.get('/integrations/settings').expect(200)).body.integrations.find((i: { kind: string }) => i.kind === kind);

  it('lists every integration with help steps; only admins see it', async () => {
    await pm.get('/integrations/settings').expect(403);
    const r = (await admin.get('/integrations/settings').expect(200)).body;
    expect(r.owner).toBe(true);
    expect(r.integrations.map((i: { kind: string }) => i.kind)).toEqual(['smtp', 'sso_google', 'sso_microsoft', 'sso_zoho', 'gemini', 'zoho_books', 'xero', 'quickbooks', 'tally', 'bidzo']);
    const google = r.integrations.find((i: { kind: string }) => i.kind === 'sso_google');
    expect(google.redirectUri).toBe('http://api.projexa.test/api/v1/auth/sso/google/callback');
    expect(google.steps.join(' ')).toContain('http://api.projexa.test/api/v1/auth/sso/google/callback');
    expect(google.status.state).toBe('off');
    expect(r.bootstrap.map((b: { name: string }) => b.name)).toContain('DATABASE_URL');
  });

  it('saves email settings encrypted, never returns the password, keeps it when left empty and tests it', async () => {
    await pm.put('/integrations/settings/smtp', { values: {} }).expect(403);
    expect((await admin.put('/integrations/settings/smtp', { values: { SMTP_USER: 'reports@owner.test' } }).expect(400)).body.message).toMatch(/App password/);
    const saved = (await admin.put('/integrations/settings/smtp', { values: { SMTP_HOST: 'smtp.zoho.in', SMTP_USER: 'reports@owner.test', SMTP_PASS: 'app-pass-123', MAIL_FROM: 'Reports <reports@owner.test>' } }).expect(200)).body;
    expect(saved.status.state).toBe('connected');
    expect(saved.values.SMTP_HOST).toBe('smtp.zoho.in');
    expect(saved.values.SMTP_PASS).toBeUndefined();
    expect(saved.secretsSet.SMTP_PASS).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('app-pass-123');

    const row = await prisma.integrationSetting.findFirstOrThrow({ where: { organizationId: ownerOrgId, kind: 'smtp' } });
    expect(row.secrets).toMatch(/^v1\./);
    expect(row.secrets).not.toContain('app-pass-123');
    expect(JSON.stringify(row.values)).not.toContain('app-pass-123');
    const logs = await prisma.auditEvent.findMany({ where: { organizationId: ownerOrgId, action: { startsWith: 'integration.' } } });
    expect(JSON.stringify(logs)).not.toContain('app-pass-123');

    // Empty password keeps the saved one.
    await admin.put('/integrations/settings/smtp', { values: { SMTP_HOST: 'smtp.zoho.in', SMTP_USER: 'reports@owner.test', SMTP_PASS: '', MAIL_FROM: '' } }).expect(200);
    const mail = app.get(MailService);
    expect(await mail.status(ownerOrgId)).toMatchObject({ configured: true, host: 'smtp.zoho.in', from: 'reports@owner.test' });
    // The other organisation has its own (none).
    const other = await prisma.organization.findUniqueOrThrow({ where: { slug: 'tenant' } });
    expect((await mail.status(other.id)).host).toBeNull();

    const sent: { to: string; pass: string }[] = [];
    svc.smtpCheck = async (c, to) => {
      sent.push({ to, pass: c.pass });
      if (c.pass !== 'app-pass-123') throw new Error('535 Authentication failed');
    };
    const t = (await admin.post('/integrations/settings/smtp/test').expect(200)).body;
    expect(t.ok).toBe(true);
    expect(t.message).toMatch(/admin@owner.test/);
    expect(sent).toEqual([{ to: 'admin@owner.test', pass: 'app-pass-123' }]);
    expect(t.integration.status.lastTestOk).toBe(true);

    await admin.put('/integrations/settings/smtp', { values: { SMTP_PASS: 'wrong' } }).expect(200);
    const bad = (await admin.post('/integrations/settings/smtp/test').expect(200)).body;
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/app password/);
  });

  it('falls back to the server env until an organisation saves its own, and removing goes back to env', async () => {
    process.env.SMTP_USER = 'env@server.test';
    process.env.SMTP_PASS = 'env-pass';
    const t = await item(otherAdmin, 'smtp');
    expect(t.status.state).toBe('env');
    expect(t.values.SMTP_USER).toBe('env@server.test');
    expect(t.secretsSet.SMTP_PASS).toBe(true);
    const owner = await item(admin, 'smtp');
    expect(owner.status.source).toBe('app');
    await admin.delete('/integrations/settings/smtp').expect(200);
    expect((await item(admin, 'smtp')).status.source).toBe('env');
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    expect((await item(admin, 'smtp')).status.state).toBe('off');
  });

  it('sign-in apps are one per server: only the owner organisation sets them, and the sign-in page picks them up', async () => {
    const providers = async () => (await request(app.getHttpServer()).get('/api/v1/auth/sso/providers').expect(200)).body.map((p: { id: string }) => p.id);
    expect(await providers()).toEqual([]);
    expect((await otherAdmin.put('/integrations/settings/sso_google', { values: { GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' } }).expect(403)).body.message).toMatch(/runs this PROJEXA server/);
    const other = await item(otherAdmin, 'sso_google');
    expect(other.editable).toBe(false);
    expect(other.managedByServerOwner).toBe(true);

    await admin.put('/integrations/settings/sso_google', { values: { GOOGLE_CLIENT_ID: 'google-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'g-secret' } }).expect(200);
    expect(await providers()).toEqual(['google']);
    // Visible to every organisation's SSO settings as available.
    const sso = (await otherAdmin.get('/organization/sso').expect(200)).body;
    expect(sso.available.find((p: { id: string }) => p.id === 'google').configured).toBe(true);

    route = (url, body) => {
      if (url.includes('openid-configuration')) return { status: 200, body: { token_endpoint: 'https://oauth2.example/token' } };
      if (url === 'https://oauth2.example/token') {
        const f = new URLSearchParams(body);
        return f.get('client_secret') === 'g-secret' ? { status: 400, body: { error: 'invalid_grant' } } : { status: 401, body: { error: 'invalid_client', error_description: 'The OAuth client was not found.' } };
      }
      return { status: 404, body: {} };
    };
    expect((await admin.post('/integrations/settings/sso_google/test').expect(200)).body).toMatchObject({ ok: true });
    await admin.put('/integrations/settings/sso_google', { values: { GOOGLE_CLIENT_SECRET: 'nope' } }).expect(200);
    const bad = (await admin.post('/integrations/settings/sso_google/test').expect(200)).body;
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/did not accept the client ID and secret/);
    await otherAdmin.post('/integrations/settings/sso_google/test').expect(403);
  });

  it('Gemini is per organisation and turns the copilot on only there', async () => {
    expect((await admin.get('/ai/status').expect(200)).body.configured).toBe(false);
    await admin.put('/integrations/settings/gemini', { values: { GEMINI_API_KEY: 'AIza-test', AI_MODEL: '' } }).expect(200);
    const s = (await admin.get('/ai/status').expect(200)).body;
    expect(s).toMatchObject({ configured: true, model: 'gemini-3.8-flash' });
    expect((await otherAdmin.get('/ai/status').expect(200)).body.configured).toBe(false);

    route = (url) => (url.includes('/v1beta/models') ? { status: 200, body: { models: [{ name: 'models/gemini-3.8-flash' }, { name: 'models/gemini-3.5-flash-lite' }, { name: 'models/gemini-3.8-live' }] } } : { status: 404, body: {} });
    expect((await admin.post('/integrations/settings/gemini/test').expect(200)).body.ok).toBe(true);
    expect(calls.at(-1)!.headers!['x-goog-api-key']).toBe('AIza-test');
    expect(calls.at(-1)!.url).not.toContain('AIza-test');
    route = () => ({ status: 400, body: { error: { message: 'API key not valid.' } } });
    expect((await admin.post('/integrations/settings/gemini/test').expect(200)).body).toMatchObject({ ok: false, message: expect.stringMatching(/API key not valid/) });
  });

  it('Zoho Books: swaps a grant code for a refresh token, finds the organisation and needs no tenant slug', async () => {
    route = (url, body) => {
      if (url === 'https://accounts.zoho.in/oauth/v2/token') {
        const f = new URLSearchParams(body);
        if (f.get('grant_type') === 'authorization_code') return f.get('code') === '1000.good' ? { status: 200, body: { access_token: 'acc-1', refresh_token: 'refresh-xyz' } } : { status: 400, body: { error: 'invalid_code' } };
        return f.get('refresh_token') === 'refresh-xyz' ? { status: 200, body: { access_token: 'acc-2' } } : { status: 400, body: { error: 'invalid_code' } };
      }
      if (url === 'https://www.zohoapis.in/books/v3/organizations') return { status: 200, body: { organizations: [{ organization_id: '600000999', name: 'Owner Books' }] } };
      return { status: 404, body: {} };
    };
    const base = { ZOHO_BOOKS_DC: 'in', ZOHO_BOOKS_CLIENT_ID: '1000.ID', ZOHO_BOOKS_CLIENT_SECRET: 'zb-secret' };
    expect((await admin.put('/integrations/settings/zoho_books', { values: { ...base, ZOHO_BOOKS_GRANT_CODE: '1000.old' } }).expect(400)).body.message).toMatch(/already used or has expired/);
    expect((await admin.put('/integrations/settings/zoho_books', { values: base }).expect(400)).body.message).toMatch(/Grant code/);
    const saved = (await admin.put('/integrations/settings/zoho_books', { values: { ...base, ZOHO_BOOKS_GRANT_CODE: '1000.good' } }).expect(200)).body;
    expect(saved.values.ZOHO_BOOKS_ORGANIZATION_ID).toBe('600000999');
    expect(saved.secretsSet.ZOHO_BOOKS_REFRESH_TOKEN).toBe(true);
    expect(saved.values.ZOHO_BOOKS_GRANT_CODE).toBeUndefined();
    const status = (await admin.get('/accounting/zoho-books').expect(200)).body;
    expect(status).toMatchObject({ configured: true, boundHere: true, otherTenant: false, dataCentre: 'in', zohoOrganizationId: '600000999', source: 'app' });
    expect((await otherAdmin.get('/accounting/zoho-books').expect(200)).body.boundHere).toBe(false);
    expect((await admin.post('/integrations/settings/zoho_books/test').expect(200)).body).toMatchObject({ ok: true, message: expect.stringMatching(/Owner Books/) });
    expect(await svc.zohoBooksOrgs()).toEqual([ownerOrgId]);
    expect(app.get(ZohoBooksService)).toBeDefined();
  });

  it('Xero and QuickBooks apps come from the owner, and each organisation still connects its own company', async () => {
    await admin.put('/integrations/settings/xero', { values: { XERO_CLIENT_ID: 'xero-id', XERO_CLIENT_SECRET: 'xero-secret' } }).expect(200);
    const ledgers = (await otherAdmin.get('/accounting/ledgers').expect(200)).body;
    expect(ledgers.find((l: { provider: string }) => l.provider === 'xero')).toMatchObject({ configured: true, connected: false });
    const token = await login(app, 'admin@tenant.test');
    const r = await request(app.getHttpServer()).get('/api/v1/accounting/ledgers/xero/connect').set('Authorization', `Bearer ${token}`).expect(302);
    expect(r.headers.location).toContain('client_id=xero-id');
    route = (url) => (url.includes('identity.xero.com') ? { status: 400, body: { error: 'invalid_grant' } } : { status: 404, body: {} });
    expect((await admin.post('/integrations/settings/xero/test').expect(200)).body.ok).toBe(true);
    expect(calls.at(-1)!.headers!.Authorization).toBe(`Basic ${Buffer.from('xero-id:xero-secret').toString('base64')}`);
  });

  it('Tally reaches a private network, so only the server owner may set it', async () => {
    expect((await otherAdmin.put('/integrations/settings/tally', { values: { TALLY_URL: 'http://10.0.0.5:9000' } }).expect(403)).body.message).toMatch(/runs this PROJEXA server/);
    await admin.put('/integrations/settings/tally', { values: { TALLY_URL: 'ftp://10.0.0.5' } }).expect(400);
    await admin.put('/integrations/settings/tally', { values: { TALLY_URL: 'http://10.0.0.5:9000' } }).expect(200);
    expect((await admin.get('/accounting/ledgers').expect(200)).body.find((l: { provider: string }) => l.provider === 'tally')).toMatchObject({ configured: true, connected: true, company: '10.0.0.5:9000' });
    route = (url) => (url === 'http://10.0.0.5:9000' ? { status: 200, body: '<ENVELOPE><COMPANY NAME="Frequent Research"></COMPANY></ENVELOPE>' } : { status: 404, body: {} });
    expect((await admin.post('/integrations/settings/tally/test').expect(200)).body.message).toMatch(/Frequent Research/);
    expect(await svc.tallyOrgs()).toEqual([ownerOrgId]);
  });

  it('the Bidzo address shows in the staff session for the New bid link', async () => {
    await admin.put('/integrations/settings/bidzo', { values: { BIDZO_URL: 'javascript:alert(1)' } }).expect(400);
    await admin.put('/integrations/settings/bidzo', { values: { BIDZO_URL: 'https://bidzo.example.com' } }).expect(200);
    expect((await pm.get('/auth/me').expect(200)).body.links.bidzoUrl).toBe('https://bidzo.example.com');
    expect((await otherAdmin.get('/auth/me').expect(200)).body.links.bidzoUrl).toBeNull();
  });

  it('rejects unknown kinds and spots private addresses', async () => {
    await admin.put('/integrations/settings/nope', { values: {} }).expect(404);
    expect(['10.1.2.3', '127.0.0.1', '192.168.0.1', '172.20.0.1', '169.254.1.1', '::1', 'fd00::1', '::ffff:10.0.0.1'].every(isPrivateAddress)).toBe(true);
    expect(['8.8.8.8', '2a00:1450::1'].some(isPrivateAddress)).toBe(false);
  });
});
