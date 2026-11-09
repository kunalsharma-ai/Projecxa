import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClient } from '../../src/prisma/client';
import request from 'supertest';
import { MailService, Mail } from '../../src/mail/mail.service';
import { api, createApp, login, makeOrg, PASSWORD, resetDb } from './helpers';

describe('Team and password reset (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let users: Record<string, { id: string; email: string }>;
  let admin: ReturnType<typeof api>;
  let otherAdmin: ReturnType<typeof api>;
  let mail: MailService;
  const sent: Mail[] = [];
  const http = () => request(app.getHttpServer());
  const tokenIn = (m: Mail) => new URL(m.text.match(/https?:\/\/\S+set-password\?token=\S+/)![0]).searchParams.get('token')!;
  const signIn = (email: string, password: string) => http().post('/api/v1/auth/login').send({ email, password });
  const later = () => new Promise((r) => setTimeout(r, 1100)); // older tokens are compared to the second

  beforeAll(async () => {
    process.env.WEB_ORIGIN = 'http://web.samptrek.test';
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    ({ users } = await makeOrg(prisma, 'team'));
    const o = await makeOrg(prisma, 'team-other');
    admin = api(app, await login(app, users.ADMIN.email));
    otherAdmin = api(app, await login(app, o.users.ADMIN.email));
    mail = app.get(MailService);
    mail.transport = async (_from, m) => { sent.push(m); return { messageId: 'x' }; };
  });
  afterAll(async () => {
    await app.close();
  });

  it('invites a staff member by email, who then chooses a password', async () => {
    const r = (await admin.post('/team', { email: 'New.Person@team.test', name: 'New Person', role: 'PROJECT_MANAGER' }).expect(201)).body;
    expect(r).toMatchObject({ emailed: true, inviteUrl: expect.stringMatching(/^http:\/\/web\.samptrek\.test\/set-password\?token=/) });
    const m = sent.pop()!;
    expect(m.to).toEqual(['new.person@team.test']);
    expect(m.subject).toBe("You're invited to team on SampTrek");
    expect(m.text).toContain('as Project manager');
    const token = tokenIn(m);
    expect(token).toBe(new URL(r.inviteUrl).searchParams.get('token'));
    expect(await prisma.passwordToken.count({ where: { tokenHash: token } })).toBe(0); // only the hash is stored

    const list = (await admin.get('/team').expect(200)).body;
    expect(list.users.find((x: { email: string }) => x.email === 'new.person@team.test')).toMatchObject({ status: 'invited', role: 'PROJECT_MANAGER', inviteExpiresAt: expect.any(String) });
    await admin.post('/team', { email: 'new.person@team.test', name: 'Again', role: 'VIEWER' }).expect(400);

    expect((await http().get(`/api/v1/auth/password/token?token=${token}`).expect(200)).body).toMatchObject({ purpose: 'invite', name: 'New Person', organization: 'team' });
    await http().post('/api/v1/auth/password/set').send({ token, password: '1234567890123' }).expect(400);
    await http().post('/api/v1/auth/password/set').send({ token, password: 'short' }).expect(400);
    await http().post('/api/v1/auth/password/set').send({ token, password: 'a-good-long-passphrase' }).expect(200);
    await http().post('/api/v1/auth/password/set').send({ token, password: 'a-good-long-passphrase-2' }).expect(400);
    await signIn('new.person@team.test', 'a-good-long-passphrase').expect(200);
    expect((await admin.get('/team').expect(200)).body.users.find((x: { email: string }) => x.email === 'new.person@team.test')).toMatchObject({ status: 'active', lastLoginAt: expect.any(String) });
  });

  it('is for admins only, in their own organization', async () => {
    await api(app, await login(app, users.PROJECT_MANAGER.email)).get('/team').expect(403);
    await otherAdmin.patch(`/team/${users.VIEWER.id}`, { role: 'ADMIN' }).expect(404);
    await otherAdmin.post(`/team/${users.VIEWER.id}/link`).expect(404);
    expect((await otherAdmin.get('/team').expect(200)).body.users.map((x: { email: string }) => x.email)).not.toContain(users.VIEWER.email);
  });

  it('forgot password: same answer for everyone, a 30-minute single-use link, and old sessions end', async () => {
    const before = sent.length;
    const unknown = (await http().post('/api/v1/auth/password/forgot').send({ email: 'nobody@team.test' }).expect(200)).body;
    const known = (await http().post('/api/v1/auth/password/forgot').send({ email: users.VIEWER.email }).expect(200)).body;
    expect(unknown).toEqual(known);
    expect(sent.length).toBe(before + 1);
    const m = sent.pop()!;
    expect(m.subject).toBe('Reset your SampTrek password');
    const t = await prisma.passwordToken.findFirstOrThrow({ where: { userId: users.VIEWER.id, purpose: 'reset' } });
    expect(t.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);

    const oldSession = await login(app, users.VIEWER.email);
    await later();
    expect((await http().post('/api/v1/auth/password/set').send({ token: tokenIn(m), password: 'my-viewer-password' }).expect(400)).body.message).toMatch(/email/);
    await http().post('/api/v1/auth/password/set').send({ token: tokenIn(m), password: 'brand-new-secret-pass' }).expect(200);
    await api(app, oldSession).get('/auth/me').expect(401);
    await signIn(users.VIEWER.email, PASSWORD).expect(401);
    await signIn(users.VIEWER.email, 'brand-new-secret-pass').expect(200);
  });

  it('limits reset emails and refuses expired links', async () => {
    await prisma.passwordToken.deleteMany({ where: { userId: users.PROJECT_MANAGER.id } });
    const before = sent.length;
    for (let i = 0; i < 5; i++) await http().post('/api/v1/auth/password/forgot').send({ email: users.PROJECT_MANAGER.email }).expect(200);
    expect(sent.length - before).toBe(3);
    // Only the latest link works.
    const links = sent.slice(-3).map(tokenIn);
    await http().get(`/api/v1/auth/password/token?token=${links[0]}`).expect(400);
    await prisma.passwordToken.updateMany({ where: { userId: users.PROJECT_MANAGER.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http().get(`/api/v1/auth/password/token?token=${links[2]}`).expect(400);
  });

  it('no reset email for someone who must use single sign-on', async () => {
    await prisma.organization.update({ where: { id: (await prisma.user.findUniqueOrThrow({ where: { id: users.ADMIN.id } })).organizationId }, data: { ssoConfig: { providers: { google: true }, domains: ['team.test'], ssoOnly: true } } });
    await prisma.passwordToken.deleteMany({});
    const before = sent.length;
    await http().post('/api/v1/auth/password/forgot').send({ email: users.PROJECT_MANAGER.email }).expect(200);
    expect(sent.length).toBe(before);
    await http().post('/api/v1/auth/password/forgot').send({ email: users.ADMIN.email }).expect(200); // admins keep passwords
    expect(sent.length).toBe(before + 1);
    sent.pop();
    await prisma.organization.updateMany({ data: { ssoConfig: null } });
  });

  it('changes roles, deactivates (signed out at once), and protects your own admin access', async () => {
    const vt = await login(app, users.VIEWER.email).catch(() => null);
    const viewerToken = vt ?? (await signIn(users.VIEWER.email, 'brand-new-secret-pass').expect(200)).body.token;
    await admin.patch(`/team/${users.VIEWER.id}`, { role: 'SALES', name: 'Vee Sales' }).expect(200);
    expect((await api(app, viewerToken).get('/auth/me').expect(200)).body.user.role).toBe('SALES');
    await admin.patch(`/team/${users.VIEWER.id}`, { active: false }).expect(200);
    await api(app, viewerToken).get('/auth/me').expect(401);
    expect((await admin.get('/team').expect(200)).body.users.find((x: { id: string }) => x.id === users.VIEWER.id).status).toBe('deactivated');
    await admin.post(`/team/${users.VIEWER.id}/link`).expect(400);
    await admin.patch(`/team/${users.VIEWER.id}`, { active: true }).expect(200);
    await admin.patch(`/team/${users.ADMIN.id}`, { role: 'VIEWER' }).expect(403);
    await admin.patch(`/team/${users.ADMIN.id}`, { active: false }).expect(403);
    await admin.patch(`/team/${users.ADMIN.id}`, {}).expect(400);
    expect(await prisma.auditEvent.count({ where: { action: { in: ['user.update', 'user.deactivate', 'user.reactivate'] } } })).toBe(3);
  });

  it('sends a fresh invite or reset link, also without email set up, and signs someone out everywhere', async () => {
    const r = (await admin.post(`/team/${users.PROJECT_MANAGER.id}/link`).expect(201)).body;
    expect(r).toMatchObject({ purpose: 'reset', emailed: true });
    sent.pop();
    mail.transport = null; // no SMTP in tests
    const inv = (await admin.post('/team', { email: 'offline@team.test', name: 'Offline', role: 'VIEWER' }).expect(201)).body;
    expect(inv.emailed).toBe(false);
    expect((await admin.get('/team').expect(200)).body.emailConfigured).toBe(false);
    await http().post('/api/v1/auth/password/set').send({ token: new URL(inv.inviteUrl).searchParams.get('token'), password: 'quiet-harbour-1234' }).expect(200);
    mail.transport = async (_from, m) => { sent.push(m); return { messageId: 'x' }; };

    const pmToken = (await signIn(users.PROJECT_MANAGER.email, PASSWORD).expect(200)).body.token;
    await later();
    await admin.post(`/team/${users.PROJECT_MANAGER.id}/sign-out`).expect(200);
    await api(app, pmToken).get('/auth/me').expect(401);
    await signIn(users.PROJECT_MANAGER.email, PASSWORD).expect(200);

    // A session started a moment before, in the same second, also ends (sessions carry milliseconds).
    const fresh = (await signIn(users.PROJECT_MANAGER.email, PASSWORD).expect(200)).body.token;
    await admin.post(`/team/${users.PROJECT_MANAGER.id}/sign-out`).expect(200);
    await api(app, fresh).get('/auth/me').expect(401);
    const after = (await signIn(users.PROJECT_MANAGER.email, PASSWORD).expect(200)).body.token;
    await api(app, after).get('/auth/me').expect(200);
  });

  it('changes your own password: checks the current one and keeps you signed in', async () => {
    const t = (await signIn(users.PROJECT_MANAGER.email, PASSWORD).expect(200)).body.token;
    const other = (await signIn(users.PROJECT_MANAGER.email, PASSWORD).expect(200)).body.token;
    await later();
    await api(app, t).post('/auth/password/change', { currentPassword: 'wrong', newPassword: 'another-good-passphrase' }).expect(400);
    const r = (await api(app, t).post('/auth/password/change', { currentPassword: PASSWORD, newPassword: 'another-good-passphrase' }).expect(200)).body;
    await api(app, r.token).get('/auth/me').expect(200);
    await api(app, other).get('/auth/me').expect(401);
    await signIn(users.PROJECT_MANAGER.email, 'another-good-passphrase').expect(200);
  });
});
