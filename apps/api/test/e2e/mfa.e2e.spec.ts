import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { decryptSecret, totp } from '../../src/auth/totp';
import { config } from '../../src/common/config';
import { api, createApp, login, makeOrg, PASSWORD, resetDb } from './helpers';

describe('Two-step sign-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let users: Record<string, { id: string; email: string }>;
  let admin: ReturnType<typeof api>;
  let pmToken: string;
  const http = () => request(app.getHttpServer());
  const password = (email: string) => http().post('/api/v1/auth/login').send({ email, password: PASSWORD });
  /** Allow the current step again (each code works once, and tests run inside one 30 s step). */
  const freshStep = (id: string) => prisma.user.update({ where: { id }, data: { mfaLastStep: null } });

  async function turnOn(token: string) {
    const me = api(app, token);
    const s = (await me.post('/auth/mfa/setup').expect(200)).body;
    const codes = (await me.post('/auth/mfa/enable', { code: totp(s.secret) }).expect(200)).body.recoveryCodes as string[];
    return { secret: s.secret as string, codes, setup: s };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    ({ users } = await makeOrg(prisma, 'mfa'));
    await makeOrg(prisma, 'mfa-other');
    admin = api(app, await login(app, users.ADMIN.email));
    pmToken = await login(app, users.PROJECT_MANAGER.email);
  });
  afterAll(async () => {
    await app.close();
  });

  it('sets up with a QR code, needs a correct first code and stores the secret encrypted', async () => {
    const pm = api(app, pmToken);
    expect((await pm.get('/auth/mfa').expect(200)).body).toMatchObject({ enabled: false, required: false, setupRequired: false });
    const s = (await pm.post('/auth/mfa/setup').expect(200)).body;
    expect(s.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(s.otpauthUrl).toMatch(/^otpauth:\/\/totp\/.+secret=/);
    expect(s.qrSvg).toContain('<svg');
    await pm.post('/auth/mfa/enable', { code: '000000' === totp(s.secret) ? '111111' : '000000' }).expect(400);
    const r = (await pm.post('/auth/mfa/enable', { code: totp(s.secret) }).expect(200)).body;
    expect(r.recoveryCodes).toHaveLength(10);
    expect(r.recoveryCodes[0]).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{2}$/);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: users.PROJECT_MANAGER.id } });
    expect(row.mfaSecret).toMatch(/^v1\./);
    expect(row.mfaSecret).not.toContain(s.secret);
    expect(row.mfaRecoveryCodes).not.toContain(r.recoveryCodes[0]);
    await pm.post('/auth/mfa/setup').expect(400);
    // Existing sessions keep working.
    await pm.get('/projects').expect(200);
  });

  it('asks for a code after the password, and each code works once', async () => {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: users.PROJECT_MANAGER.id } });
    const first = (await password(users.PROJECT_MANAGER.email).expect(200)).body;
    expect(first).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
    // The in-between token is not a session.
    await http().get('/api/v1/projects').set('Authorization', `Bearer ${first.mfaToken}`).expect(401);
    await http().post('/api/v1/auth/login/mfa').send({ mfaToken: first.mfaToken }).expect(400);
    await http().post('/api/v1/auth/login/mfa').send({ mfaToken: 'x'.repeat(40), code: '123456' }).expect(401);
    await freshStep(row.id);
    // The code a phone would show, from the secret set up in the previous test.
    const plain = decryptSecret(row.mfaSecret!, config.mfaEncryptionKey);
    const ok = (await http().post('/api/v1/auth/login/mfa').send({ mfaToken: first.mfaToken, code: totp(plain) }).expect(200)).body;
    expect(ok.token).toBeTruthy();
    expect(ok.home).toBe('/');
    await api(app, ok.token).get('/projects').expect(200);
    // Replaying the same code fails.
    const again = (await password(users.PROJECT_MANAGER.email).expect(200)).body;
    await http().post('/api/v1/auth/login/mfa').send({ mfaToken: again.mfaToken, code: totp(plain) }).expect(401);
  });

  it('accepts each recovery code once, and locks after ten wrong codes', async () => {
    const vtoken = await login(app, users.VIEWER.email);
    const { codes } = await turnOn(vtoken);
    const t = (await password(users.VIEWER.email).expect(200)).body.mfaToken;
    const r = (await http().post('/api/v1/auth/login/mfa').send({ mfaToken: t, recoveryCode: codes[0].toUpperCase().replace(/-/g, ' ') }).expect(200)).body;
    expect(r.recoveryCodesLeft).toBe(9);
    await http().post('/api/v1/auth/login/mfa').send({ mfaToken: t, recoveryCode: codes[0] }).expect(401);
    expect((await prisma.auditEvent.count({ where: { action: 'mfa.recovery_code_used', entityId: users.VIEWER.id } }))).toBe(1);

    for (let i = 0; i < 9; i++) await http().post('/api/v1/auth/login/mfa').send({ mfaToken: t, code: '000001' }).expect(401);
    const locked = await http().post('/api/v1/auth/login/mfa').send({ mfaToken: t, recoveryCode: codes[1] }).expect(401);
    expect(locked.body.message).toMatch(/Too many wrong codes/);
    // An admin reset clears the lock and the factor.
    await admin.post(`/users/${users.VIEWER.id}/mfa/reset`).expect(200);
    expect((await password(users.VIEWER.email).expect(200)).body.token).toBeTruthy();
  });

  it('lets people turn it off with password and code, and regenerate recovery codes', async () => {
    const t = await login(app, users.VIEWER.email);
    const me = api(app, t);
    const { secret, codes } = await turnOn(t);
    await freshStep(users.VIEWER.id);
    const fresh = (await me.post('/auth/mfa/recovery-codes', { code: totp(secret) }).expect(200)).body.recoveryCodes;
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toEqual(codes);
    await me.post('/auth/mfa/disable', { password: 'wrong', recoveryCode: fresh[0] }).expect(401);
    await me.post('/auth/mfa/disable', { password: PASSWORD, recoveryCode: codes[0] }).expect(401);
    expect((await me.post('/auth/mfa/disable', { password: PASSWORD, recoveryCode: fresh[1] }).expect(200)).body.enabled).toBe(false);
  });

  it('admins can require it for staff; staff without it can only reach setup', async () => {
    const adminRow = users.ADMIN;
    await admin.put('/organization/security', { mfaRequired: true }).expect(400);
    const adminToken = await login(app, adminRow.email);
    await turnOn(adminToken);
    const sec = (await admin.put('/organization/security', { mfaRequired: true }).expect(200)).body;
    expect(sec.mfaRequired).toBe(true);
    expect(sec.users.find((u: { email: string }) => u.email === users.PROJECT_MANAGER.email)).toMatchObject({ mfaEnabled: true, staff: true });
    await api(app, pmToken).put('/organization/security', { mfaRequired: false }).expect(403);

    // The viewer has no second factor: blocked everywhere except the setup routes.
    const v = api(app, await login(app, users.VIEWER.email));
    const blocked = await v.get('/projects').expect(403);
    expect(blocked.body.code).toBe('MFA_SETUP_REQUIRED');
    expect((await v.get('/auth/me').expect(200)).body.mfa).toMatchObject({ required: true, setupRequired: true });
    const s = (await v.post('/auth/mfa/setup').expect(200)).body;
    await v.post('/auth/mfa/enable', { code: totp(s.secret) }).expect(200);
    await v.get('/projects').expect(200);
    // Required: it cannot be switched off by the person, only reset by an admin.
    await freshStep(users.VIEWER.id);
    await v.post('/auth/mfa/disable', { password: PASSWORD, code: totp(s.secret) }).expect(400);

    // Portal users are not forced, and the other organization is unaffected.
    const vendorId = (await admin.post('/vendors', { name: 'Panel', code: 'PNL' }).expect(201)).body.id;
    await admin.post('/portal-users', { kind: 'vendor', partyId: vendorId, name: 'Vendor', email: 'v@mfa.test', password: 'vendor-password-1' }).expect(201);
    const vt = (await http().post('/api/v1/auth/login').send({ email: 'v@mfa.test', password: 'vendor-password-1' }).expect(200)).body.token;
    await api(app, vt).get('/portal/vendor/summary').expect(200);
    await api(app, await login(app, 'project_manager@mfa-other.test')).get('/projects').expect(200);
    await api(app, adminToken).post(`/users/${adminRow.id}/mfa/reset`).expect(403);
    await api(app, await login(app, 'admin@mfa-other.test')).post(`/users/${users.VIEWER.id}/mfa/reset`).expect(404);
    await admin.put('/organization/security', { mfaRequired: false }).expect(200);
  });
});
