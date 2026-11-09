import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import { createHash, generateKeyPairSync, sign } from 'crypto';
import request from 'supertest';
import { b64url } from '../../src/auth/oidc';
import { SsoService } from '../../src/auth/sso.service';
import { totp } from '../../src/auth/totp';
import { api, createApp, login, makeOrg, PASSWORD, resetDb } from './helpers';

const TENANT = '11111111-2222-3333-4444-555555555555';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
const idToken = (claims: object) => {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
  const p = b64url(JSON.stringify(claims));
  return `${h}.${p}.${b64url(sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey))}`;
};
const ISS = { google: 'https://accounts.google.com', microsoft: 'https://login.microsoftonline.com/{tenantid}/v2.0', zoho: 'https://accounts.zoho.com' } as const;
type P = keyof typeof ISS;

describe('Single sign-on (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let users: Record<string, { id: string; email: string }>;
  let other: Record<string, { id: string; email: string }>;
  let admin: ReturnType<typeof api>;
  /** What the fake provider puts in the next id_token, and what it saw. */
  let next: Record<string, unknown> = {};
  let seen: { verifier?: string; nonce?: string; challenge?: string } = {};
  const http = () => request(app.getHttpServer());
  const env = { GOOGLE: 'g', MICROSOFT: 'm', ZOHO: 'z' } as const;

  beforeAll(async () => {
    for (const [k, v] of Object.entries(env)) {
      process.env[`${k}_CLIENT_ID`] = `${v}-client`;
      process.env[`${k}_CLIENT_SECRET`] = `${v}-secret`;
    }
    process.env.WEB_ORIGIN = 'http://web.samptrek.test';
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    ({ users } = await makeOrg(prisma, 'acme'));
    ({ users: other } = await makeOrg(prisma, 'other'));
    // Same people, on the company's domain.
    const short: Record<string, string> = { ADMIN: 'admin', PROJECT_MANAGER: 'pm', VIEWER: 'viewer' };
    for (const [role, u] of Object.entries(users)) await prisma.user.update({ where: { id: u.id }, data: { email: `${short[role]}@acme.com` } });
    for (const u of Object.values(users)) u.email = (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).email;
    admin = api(app, await login(app, users.ADMIN.email));

    app.get(SsoService).http = async (url, init) => {
      const u = new URL(url);
      const p = (Object.keys(ISS) as P[]).find((k) => u.host === new URL(ISS[k].replace('{tenantid}', 'x')).host || (k === 'zoho' && u.host.startsWith('accounts.zoho')))!;
      const json = (status: number, body: unknown) => ({ status, json: async () => body });
      if (u.pathname.endsWith('/.well-known/openid-configuration')) {
        const iss = p === 'zoho' ? `https://${u.host}` : ISS[p];
        return json(200, { issuer: iss, authorization_endpoint: `https://${u.host}/authorize`, token_endpoint: `https://${u.host}/token`, jwks_uri: `https://${u.host}/keys`, userinfo_endpoint: `https://${u.host}/userinfo` });
      }
      if (u.pathname === '/keys') return json(200, { keys: [jwk] });
      if (u.pathname === '/userinfo') return json(200, { email: 'pm@acme.com', email_verified: true });
      if (u.pathname === '/token') {
        const form = new URLSearchParams(init?.body ?? '');
        seen.verifier = form.get('code_verifier') ?? undefined;
        if (form.get('code') === 'bad') return json(400, { error: 'invalid_grant' });
        const now = Math.floor(Date.now() / 1000);
        const claims = { iss: p === 'zoho' ? `https://${u.host}` : ISS[p].replace('{tenantid}', TENANT), aud: form.get('client_id'), exp: now + 600, iat: now, nonce: seen.nonce, tid: TENANT, ...next };
        return json(200, { id_token: idToken(claims), access_token: 'at' });
      }
      return json(404, {});
    };
  });
  afterAll(async () => {
    for (const k of Object.keys(env)) {
      delete process.env[`${k}_CLIENT_ID`];
      delete process.env[`${k}_CLIENT_SECRET`];
    }
    await app.close();
  });

  const settings = (s: object) => admin.put('/organization/sso', { providers: { google: true, microsoft: false, zoho: false }, domains: ['acme.com'], microsoftTenantId: null, ssoOnly: false, ...s });

  /** Runs the whole browser round trip and returns the final redirect and cookies. */
  async function signIn(p: P, claims: Record<string, unknown>, o: { org?: string; code?: string; tamper?: boolean; extra?: Record<string, string> } = {}) {
    const start = await http().get(`/api/v1/auth/sso/${p}/start${o.org ? `?org=${o.org}` : ''}`).expect(302);
    const to = new URL(start.headers.location);
    seen = { nonce: to.searchParams.get('nonce')!, challenge: to.searchParams.get('code_challenge')! };
    next = claims;
    const cookie = (start.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('projexa_sso='))!.split(';')[0];
    const q = new URLSearchParams({ code: o.code ?? 'c', state: o.tamper ? 'other' : to.searchParams.get('state')!, ...o.extra });
    const back = await http().get(`/api/v1/auth/sso/${p}/callback?${q}`).set('Cookie', cookie).expect(302);
    return { to, location: back.headers.location as string, cookies: (back.headers['set-cookie'] as unknown as string[]) ?? [] };
  }
  const session = (cookies: string[]) => cookies.find((c) => c.startsWith('projexa_token=') && !c.startsWith('projexa_token=;'))?.split(';')[0];
  const error = (location: string) => new URL(location).searchParams.get('sso_error');

  it('lists configured providers and admin settings with redirect URIs', async () => {
    expect((await http().get('/api/v1/auth/sso/providers').expect(200)).body.map((p: { id: string }) => p.id)).toEqual(['google', 'microsoft', 'zoho']);
    const s = (await admin.get('/organization/sso').expect(200)).body;
    expect(s.settings).toEqual({ providers: { google: false, microsoft: false, zoho: false }, domains: [], microsoftTenantId: null, ssoOnly: false });
    expect(s.available[0]).toMatchObject({ id: 'google', configured: true, redirectUri: 'http://api.samptrek.test/api/v1/auth/sso/google/callback' });
    await api(app, await login(app, users.PROJECT_MANAGER.email)).get('/organization/sso').expect(403);
  });

  it('validates settings', async () => {
    await settings({ domains: [] }).expect(400);
    await settings({ providers: { google: false, microsoft: true, zoho: false } }).expect(400);
    await settings({ domains: ['not a domain'] }).expect(400);
    await settings({ providers: { google: false, microsoft: false, zoho: false }, domains: [], ssoOnly: true }).expect(400);
    delete process.env.ZOHO_CLIENT_ID;
    await settings({ providers: { google: false, microsoft: false, zoho: true } }).expect(400);
    process.env.ZOHO_CLIENT_ID = 'z-client';
  });

  it('refuses sign-in while the provider is off for the organization', async () => {
    const r = await signIn('google', { sub: 'g-pm', email: 'pm@acme.com', email_verified: true });
    expect(error(r.location)).toMatch(/No SampTrek account/);
    expect(session(r.cookies)).toBeUndefined();
  });

  it('signs in with Google using state, nonce and PKCE, links the account, then matches by subject', async () => {
    await settings({}).expect(200);
    const r = await signIn('google', { sub: 'g-pm', email: 'PM@acme.com', email_verified: true });
    expect(r.to.origin + r.to.pathname).toBe('https://accounts.google.com/authorize');
    expect(r.to.searchParams.get('redirect_uri')).toBe('http://api.samptrek.test/api/v1/auth/sso/google/callback');
    expect(r.to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(createHash('sha256').update(seen.verifier!).digest('base64url')).toBe(seen.challenge);
    expect(r.location).toBe('http://web.samptrek.test/');
    const tok = session(r.cookies)!;
    expect((await http().get('/api/v1/auth/me').set('Cookie', tok).expect(200)).body.user.id).toBe(users.PROJECT_MANAGER.id);
    const linked = await prisma.ssoIdentity.findMany({ where: { userId: users.PROJECT_MANAGER.id } });
    expect(linked).toMatchObject([{ provider: 'google', subject: 'g-pm', email: 'pm@acme.com' }]);
    expect(await prisma.auditEvent.count({ where: { action: 'sso.link' } })).toBe(1);

    // Later sign-ins go by the subject, even if the email changed at Google.
    const again = await signIn('google', { sub: 'g-pm', email: 'renamed@acme.com', email_verified: true });
    expect(session(again.cookies)).toBeDefined();
    expect(await prisma.ssoIdentity.count()).toBe(1);
  });

  it('rejects unverified email, other domains, a bad state, a failed code exchange and a wrong nonce', async () => {
    expect(error((await signIn('google', { sub: 'g2', email: 'viewer@acme.com', email_verified: false })).location)).toMatch(/verified email/);
    expect(error((await signIn('google', { sub: 'g3', email: 'admin@other.test', email_verified: true })).location)).toMatch(/No SampTrek account/);
    expect(error((await signIn('google', { sub: 'g4', email: 'viewer@acme.com', email_verified: true }, { tamper: true })).location)).toMatch(/could not be checked/);
    expect(error((await signIn('google', { sub: 'g4', email: 'viewer@acme.com', email_verified: true }, { code: 'bad' })).location)).toMatch(/invalid_grant/);
    expect(error((await signIn('google', { sub: 'g4', email: 'viewer@acme.com', email_verified: true, nonce: 'replayed' })).location)).toMatch(/could not be verified/);
    const noCookie = await http().get('/api/v1/auth/sso/google/callback?code=c&state=s').expect(302);
    expect(error(noCookie.headers.location)).toMatch(/took too long/);
    expect(await prisma.ssoIdentity.count({ where: { subject: { in: ['g2', 'g3', 'g4'] } } })).toBe(0);
  });

  it('Microsoft needs the organization tenant', async () => {
    await settings({ providers: { google: true, microsoft: true, zoho: false }, microsoftTenantId: TENANT.toUpperCase() }).expect(200);
    const wrong = await signIn('microsoft', { sub: 'x', oid: 'o-v', email: 'viewer@acme.com', tid: '99999999-2222-3333-4444-555555555555', iss: 'https://login.microsoftonline.com/99999999-2222-3333-4444-555555555555/v2.0' });
    expect(error(wrong.location)).toMatch(/No SampTrek account/);
    const ok = await signIn('microsoft', { sub: 'x', oid: 'o-v', preferred_username: 'Viewer@acme.com' });
    expect(session(ok.cookies)).toBeDefined();
    expect(await prisma.ssoIdentity.findFirst({ where: { provider: 'microsoft' } })).toMatchObject({ subject: `${TENANT}:o-v`, userId: users.VIEWER.id });
  });

  it('Zoho uses the account data centre and only real Zoho hosts', async () => {
    await settings({ providers: { google: true, microsoft: false, zoho: true } }).expect(200);
    const bad = await signIn('zoho', { sub: 'z1', email: 'admin@acme.com' }, { extra: { 'accounts-server': 'https://evil.example' } });
    expect(error(bad.location)).toMatch(/Unknown Zoho/);
    const ok = await signIn('zoho', { sub: 'z1', email: 'admin@acme.com' }, { extra: { 'accounts-server': 'https://accounts.zoho.in' } });
    expect(session(ok.cookies)).toBeDefined();
    // No email in the id_token: read from userinfo.
    const info = await signIn('zoho', { sub: 'z2' });
    expect(session(info.cookies)).toBeDefined();
    expect(await prisma.ssoIdentity.findFirst({ where: { subject: 'z2' } })).toMatchObject({ userId: users.PROJECT_MANAGER.id });
  });

  it('turning the provider off stops linked accounts too', async () => {
    await settings({ providers: { google: false, microsoft: false, zoho: true } }).expect(200);
    expect(error((await signIn('google', { sub: 'g-pm', email: 'pm@acme.com', email_verified: true })).location)).toMatch(/not turned on/);
    await settings({}).expect(200);
  });

  it('SSO-only blocks staff passwords but not admins', async () => {
    await settings({ ssoOnly: true }).expect(200);
    const r = await http().post('/api/v1/auth/login').send({ email: users.PROJECT_MANAGER.email, password: PASSWORD }).expect(401);
    expect(r.body.message).toMatch(/signs in with Google/);
    await http().post('/api/v1/auth/login').send({ email: users.ADMIN.email, password: PASSWORD }).expect(200);
    // Another organization is unaffected.
    await http().post('/api/v1/auth/login').send({ email: other.PROJECT_MANAGER.email, password: PASSWORD }).expect(200);
    await settings({ ssoOnly: false }).expect(200);
  });

  it('asks for the authenticator code after SSO when the person uses two-step sign-in', async () => {
    const vt = await login(app, users.VIEWER.email);
    const v = api(app, vt);
    const s = (await v.post('/auth/mfa/setup').expect(200)).body;
    await v.post('/auth/mfa/enable', { code: totp(s.secret) }).expect(200);
    await prisma.user.update({ where: { id: users.VIEWER.id }, data: { mfaLastStep: null } });
    await settings({ providers: { google: true, microsoft: true, zoho: false }, microsoftTenantId: TENANT }).expect(200);
    const r = await signIn('microsoft', { sub: 'x', oid: 'o-v', email: 'viewer@acme.com' });
    expect(r.location).toBe('http://web.samptrek.test/login?step=code');
    expect(session(r.cookies)).toBeUndefined();
    const mfa = r.cookies.find((c) => c.startsWith('projexa_mfa='))!.split(';')[0];
    await http().post('/api/v1/auth/login/mfa').send({ code: totp(s.secret) }).expect(401);
    const done = await http().post('/api/v1/auth/login/mfa').set('Cookie', mfa).send({ code: totp(s.secret) }).expect(200);
    expect(done.body.user.id).toBe(users.VIEWER.id);
  });

  it('lets admins see and unlink accounts, only in their own organization', async () => {
    const s = (await admin.get('/organization/sso').expect(200)).body;
    expect(s.identities.length).toBeGreaterThanOrEqual(3);
    const target = s.identities.find((i: { provider: string; user: { id: string } }) => i.provider === 'google');
    const otherAdmin = api(app, await login(app, other.ADMIN.email));
    await otherAdmin.delete(`/sso-identities/${target.id}`).expect(404);
    expect((await otherAdmin.get('/organization/sso').expect(200)).body.identities).toEqual([]);
    await admin.delete(`/sso-identities/${target.id}`).expect(200);
    expect(await prisma.ssoIdentity.findUnique({ where: { id: target.id } })).toBeNull();
  });
  describe('phone app', () => {
    const verifier = 'v'.repeat(20) + 'erifier-for-the-phone-app-1234';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    async function phone(p: P, claims: Record<string, unknown>, o: { redirect?: string; challenge?: string } = {}) {
      const q = new URLSearchParams({ client: 'mobile', redirect: o.redirect ?? 'projexa://sso', challenge: o.challenge ?? challenge });
      const start = await http().get(`/api/v1/auth/sso/${p}/start?${q}`).expect(302);
      const to = new URL(start.headers.location);
      expect(to.searchParams.get('redirect_uri')).toBe(`http://api.samptrek.test/api/v1/auth/sso/${p}/callback`);
      seen = { nonce: to.searchParams.get('nonce')!, challenge: to.searchParams.get('code_challenge')! };
      next = claims;
      const cookie = (start.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('projexa_sso='))!.split(';')[0];
      const back = await http().get(`/api/v1/auth/sso/${p}/callback?${new URLSearchParams({ code: 'c', state: to.searchParams.get('state')! })}`).set('Cookie', cookie).expect(200);
      expect(back.headers['content-type']).toMatch(/html/);
      expect(back.headers['set-cookie']?.toString() ?? '').not.toMatch(/projexa_token=[^;]/);
      const url = /location\.replace\("([^"]+)"\)/.exec(back.text)![1];
      return new URL(url.replace(/\\u003c/g, '<'));
    }

    it('only sends the browser back to the app with a PKCE challenge', async () => {
      await settings({}).expect(200);
      await http().get(`/api/v1/auth/sso/google/start?client=mobile&redirect=${encodeURIComponent('https://evil.test/x')}&challenge=${challenge}`).expect(400);
      await http().get(`/api/v1/auth/sso/google/start?client=mobile&redirect=${encodeURIComponent('projexa://sso')}&challenge=short`).expect(400);
      await http().get(`/api/v1/auth/sso/google/start?client=mobile&redirect=${encodeURIComponent('projexa://sso?x=1')}&challenge=${challenge}`).expect(400);
    });

    it('hands a one-time code to the app that only works with the verifier', async () => {
      const back = await phone('google', { sub: 'g-pm', email: 'pm@acme.com', email_verified: true });
      expect(back.protocol).toBe('projexa:');
      const code = back.searchParams.get('code')!;
      expect(code.length).toBeGreaterThan(30);
      await http().post('/api/v1/auth/sso/mobile/exchange').send({ code, verifier: 'w'.repeat(43) }).expect(401);
      const ok = await http().post('/api/v1/auth/sso/mobile/exchange').send({ code, verifier }).expect(200);
      expect(ok.body.user.id).toBe(users.PROJECT_MANAGER.id);
      await http().get('/api/v1/auth/me').set('Authorization', `Bearer ${ok.body.token}`).expect(200);
      // Once only.
      await http().post('/api/v1/auth/sso/mobile/exchange').send({ code, verifier }).expect(401);
      // Expired codes do not work either.
      const late = (await phone('google', { sub: 'g-pm', email: 'pm@acme.com', email_verified: true })).searchParams.get('code')!;
      await prisma.mobileSsoCode.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().post('/api/v1/auth/sso/mobile/exchange').send({ code: late, verifier }).expect(401);
    });

    it('returns errors to the app, accepts Expo Go outside production, and asks for the code with two-step sign-in', async () => {
      const err = await phone('google', { sub: 'nobody', email: 'nobody@acme.com', email_verified: true });
      expect(err.searchParams.get('error')).toMatch(/No SampTrek account/);
      expect(err.searchParams.get('code')).toBeNull();
      const dev = await phone('google', { sub: 'g-pm', email: 'pm@acme.com', email_verified: true }, { redirect: 'exp://192.168.1.5:8081/--/sso' });
      expect(dev.host).toBe('192.168.1.5:8081');
      // The viewer turned on two-step sign-in in an earlier test.
      const v = await phone('google', { sub: 'g-viewer', email: 'viewer@acme.com', email_verified: true });
      const out = await http().post('/api/v1/auth/sso/mobile/exchange').send({ code: v.searchParams.get('code'), verifier }).expect(200);
      expect(out.body).toMatchObject({ mfaRequired: true });
      expect(out.body.token).toBeUndefined();
      expect(out.body.mfaToken).toBeTruthy();
    });
  });
});
