import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '../../src/prisma/client';
import request from 'supertest';
import { Mail, MailService } from '../../src/mail/mail.service';
import { SchedulesService } from '../../src/schedules/schedules.service';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Scheduled report emails (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let mail: MailService;
  let schedules: SchedulesService;
  let clientId: string;
  let entryCode: string;
  const outbox: Mail[] = [];
  let fail: Error | null = null;
  let n = 0;
  const http = () => request(app.getHttpServer());
  const base = { name: 'Weekly client report', report: 'client', period: 'last_7_days', frequency: 'weekly', dayOfWeek: 1, hour: 9, timezone: 'Asia/Kolkata', recipients: ['ops@example.com', 'Lead@Example.com'] };

  async function complete() {
    const res = await http().get(`/s/${entryCode}?uid=R${++n}`).set('X-Forwarded-For', `203.0.113.${n % 250}`).expect(302);
    await http().get(`/r/complete?token=${new URL(res.headers.location).searchParams.get('rid')}`).expect(302);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'sched');
    const b = await makeOrg(prisma, 'sched-other');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    admin = api(app, await login(app, a.users.ADMIN.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    mail = app.get(MailService);
    schedules = app.get(SchedulesService);
    mail.transport = async (_from, m) => {
      if (fail) throw fail;
      outbox.push(m);
      return { messageId: `m${outbox.length}` };
    };
    clientId = (await pm.post('/clients', { name: '=Acme Insights', code: 'ACME' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Panel A', code: 'PA' }).expect(201)).body.id;
    const p = (await pm.post('/projects', { name: 'Tracker', category: 'B2C', clientId, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 5, targetCompletes: 50, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' }, countries: [{ countryCode: 'US' }] }).expect(201)).body;
    await pm.post(`/projects/${p.id}/countries/${p.countries[0].id}/allocations`, { vendorId, cpi: 2, targetCompletes: 50 }).expect(201);
    await pm.patch(`/projects/${p.id}/countries/${p.countries[0].id}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${p.id}`, { status: 'LIVE' }).expect(200);
    entryCode = (await pm.get(`/projects/${p.id}`).expect(200)).body.countries[0].allocations[0].entryCode;
    await complete();
    await complete();
  });
  beforeEach(() => {
    outbox.length = 0;
    fail = null;
  });
  afterAll(async () => {
    await app.close();
  });

  it('editors create schedules; viewers only read; filters stay in the organization', async () => {
    await viewer.post('/report-schedules', base).expect(403);
    await pm.post('/report-schedules', { ...base, dayOfWeek: undefined }).expect(400);
    await pm.post('/report-schedules', { ...base, filters: { clientId: 'nope' } }).expect(400);
    const s = (await pm.post('/report-schedules', { ...base, filters: { clientId } }).expect(201)).body;
    expect(s).toMatchObject({ schedule: 'Every Monday at 09:00 (Asia/Kolkata)', recipients: ['ops@example.com', 'lead@example.com'], active: true });
    const next = new Date(s.nextRunAt);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(next.getUTCDay()).toBe(1);
    expect(next.toISOString().slice(11, 16)).toBe('03:30');
    const list = (await viewer.get('/report-schedules').expect(200)).body;
    expect(list.schedules).toHaveLength(1);
    expect(list.mail).toMatchObject({ configured: true });
    expect((await other.get('/report-schedules').expect(200)).body.schedules).toHaveLength(0);
    await other.post(`/report-schedules/${s.id}/send`).expect(404);
    await other.put(`/report-schedules/${s.id}`, base).expect(404);
  });

  it('sends due schedules once, with a summary and a CSV, and moves to the next send', async () => {
    const s = await prisma.reportSchedule.findFirstOrThrow();
    await prisma.reportSchedule.update({ where: { id: s.id }, data: { period: 'last_30_days', nextRunAt: new Date(Date.now() - 60_000) } });
    // Two workers at once: only one email.
    const [a, b] = await Promise.all([schedules.runDue(new Date(Date.now() + 86_400_000)), schedules.runDue(new Date(Date.now() + 86_400_000))]);
    expect(a + b).toBe(1);
    expect(outbox).toHaveLength(1);
    const m = outbox[0];
    expect(m.to).toEqual(['ops@example.com', 'lead@example.com']);
    expect(m.subject).toMatch(/^Weekly client report: \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/);
    expect(m.html).toContain('=Acme Insights');
    expect(m.html).toContain('By client');
    expect(m.text).toContain('2 completes');
    const csv = m.attachments![0] as { filename: string; content: string };
    expect(csv.filename).toMatch(/^weekly-client-report-.+\.csv$/);
    expect(csv.content.split('\r\n')[0]).toContain('Clicks,Completes');
    // Spreadsheet formulas are defused.
    expect(csv.content).toContain("'=Acme Insights");
    const after = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 86_400_000);
    const runs = (await viewer.get(`/report-schedules/${s.id}/runs`).expect(200)).body;
    expect(runs[0]).toMatchObject({ status: 'SENT', trigger: 'scheduled', rows: 1 });
    expect((await viewer.get('/report-schedules').expect(200)).body.schedules[0].lastRun.status).toBe('SENT');
  });

  it('records failures, skips empty periods when asked, and sends now on request', async () => {
    const s = await prisma.reportSchedule.findFirstOrThrow();
    fail = new Error('535 Authentication Failed');
    const r = (await pm.post(`/report-schedules/${s.id}/send`).expect(200)).body;
    expect(r).toMatchObject({ status: 'FAILED', trigger: 'manual' });
    expect(r.error).toContain('535');
    fail = null;
    await pm.put(`/report-schedules/${s.id}`, { ...base, period: 'last_month', skipEmpty: true }).expect(200);
    expect((await pm.post(`/report-schedules/${s.id}/send`).expect(200)).body.status).toBe('SKIPPED');
    expect(outbox).toHaveLength(0);
    await pm.put(`/report-schedules/${s.id}`, { ...base, report: 'day', period: 'month_to_date' }).expect(200);
    expect((await pm.post(`/report-schedules/${s.id}/send`).expect(200)).body.status).toBe('SENT');
    expect(outbox[0].html).toContain('By day');
    const preview = (await viewer.get(`/report-schedules/${s.id}/preview`).expect(200)).body;
    expect(preview.html).toContain('<html>');
    expect(preview.subject).toContain('Weekly client report');
  });

  it('pauses, resumes without catching up, deletes, and reports missing mail settings', async () => {
    const s = await prisma.reportSchedule.findFirstOrThrow();
    await pm.patch(`/report-schedules/${s.id}`, { active: false }).expect(200);
    await prisma.reportSchedule.update({ where: { id: s.id }, data: { nextRunAt: new Date(Date.now() - 7 * 86_400_000) } });
    expect(await schedules.runDue()).toBe(0);
    const resumed = (await pm.patch(`/report-schedules/${s.id}`, { active: true }).expect(200)).body;
    expect(new Date(resumed.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(await schedules.runDue()).toBe(0);

    const saved = mail.transport;
    mail.transport = null;
    try {
      expect((await viewer.get('/report-schedules').expect(200)).body.mail.configured).toBe(false);
      const r = (await pm.post(`/report-schedules/${s.id}/send`).expect(200)).body;
      expect(r).toMatchObject({ status: 'FAILED' });
      expect(r.error).toMatch(/not set up/);
      await pm.post('/report-schedules/test-email').expect(403);
      expect((await admin.post('/report-schedules/test-email').expect(400)).body.message).toMatch(/Settings → Integrations/);
    } finally {
      mail.transport = saved;
    }
    expect((await admin.post('/report-schedules/test-email').expect(200)).body).toEqual({ ok: true, to: 'admin@sched.test' });
    await viewer.delete(`/report-schedules/${s.id}`).expect(403);
    await pm.delete(`/report-schedules/${s.id}`).expect(200);
    expect(await prisma.reportRun.count()).toBe(0);
  });
});
