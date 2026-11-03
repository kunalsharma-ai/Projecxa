import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MailService } from '../../src/mail/mail.service';
import { SchedulesService } from '../../src/schedules/schedules.service';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const binary = (res: { on: (e: string, cb: (c?: Buffer) => void) => void }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c) => chunks.push(c!));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Saved report views and PDFs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: ReturnType<typeof api>;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let org: string;
  let clientId: string;
  let invoiceId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'rv');
    const b = await makeOrg(prisma, 'rv-other');
    org = a.org.id;
    admin = api(app, await login(app, a.users.ADMIN.email));
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.ADMIN.email));
    clientId = (await pm.post('/clients', { name: 'Acme Insights', code: 'ACME', billingAddress: '12 Market St\nLondon', taxId: 'GB123' }).expect(201)).body.id;
    const project = (
      await pm.post('/projects', { name: 'Brand study', category: 'B2C', clientId, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 10, targetCompletes: 50, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' }, countries: [{ countryCode: 'US', currency: 'USD' }] }).expect(201)
    ).body;
    invoiceId = (
      await prisma.invoice.create({ data: { organizationId: org, projectId: project.id, clientId, number: 'INV-2026-00301', status: 'PAID', currency: 'USD', lines: [{ countryCode: 'US', description: 'Completes US — 東京 panel', quantity: 10, unitPrice: 12.5, amount: 125 }], completes: 10, subtotal: 125, taxName: 'VAT', taxPercent: 20, taxAmount: 25, total: 150, issuedAt: new Date('2026-10-05T10:00:00Z'), dueAt: new Date('2026-11-04T10:00:00Z'), paidAt: new Date('2026-10-20T10:00:00Z'), paymentReference: 'UTR-1' } })
    ).id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('saves private and shared views; only the owner or an admin changes them', async () => {
    const mine = (await pm.post('/reports/views', { name: 'Acme last 30 days', tab: 'Clients', period: '30', filters: { clientId, from: '2026-10-01', to: '2026-10-31' } }).expect(201)).body;
    expect(mine).toMatchObject({ name: 'Acme last 30 days', shared: false, mine: true, canEdit: true });
    expect(mine.filters).toEqual({ clientId }); // relative periods keep no dates
    const custom = (await pm.post('/reports/views', { name: 'October', tab: 'Overall', period: 'custom', filters: { from: '2026-10-01', to: '2026-10-31' }, shared: true }).expect(201)).body;
    expect(custom.filters).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    await pm.post('/reports/views', { name: 'Bad', tab: 'Overall', period: 'custom', filters: {} }).expect(400);
    await pm.post('/reports/views', { name: 'Bad', tab: 'Answers', period: '30' }).expect(400);
    const foreign = (await other.post('/clients', { name: 'Other', code: 'OTH' }).expect(201)).body.id;
    await pm.post('/reports/views', { name: 'Sneaky', tab: 'Clients', period: '30', filters: { clientId: foreign } }).expect(400);

    const seen = (await viewer.get('/reports/views').expect(200)).body;
    expect(seen.map((v: { name: string }) => v.name)).toEqual(['October']);
    expect(seen[0]).toMatchObject({ owner: 'PROJECT_MANAGER', mine: false, canEdit: false });
    await viewer.patch(`/reports/views/${custom.id}`, { name: 'Mine now' }).expect(403);
    await viewer.delete(`/reports/views/${mine.id}`).expect(404);
    await admin.patch(`/reports/views/${custom.id}`, { name: 'October (all)' }).expect(200);
    await pm.patch(`/reports/views/${mine.id}`, { shared: true }).expect(200);
    expect((await other.get('/reports/views').expect(200)).body).toEqual([]);
    await admin.delete(`/reports/views/${mine.id}`).expect(200);
    expect((await pm.get('/reports/views').expect(200)).body.map((v: { name: string }) => v.name)).toEqual(['October (all)']);
  });

  it('downloads a report as a PDF with the same filters as the screen', async () => {
    const r = await pm.get(`/reports/pdf?report=client&from=2026-10-01&to=2026-10-31&clientId=${clientId}&title=Monthly%20client%20report&tz=Asia/Kolkata`).buffer(true).parse(binary).expect(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toBe('attachment; filename="monthly-client-report-2026-10-01-to-2026-10-31.pdf"');
    const body = r.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.toString('latin1')).toContain('DejaVuSans');
    await pm.get('/reports/pdf?report=nope').expect(400);
  });

  it('prints invoices with the seller details and the client billing address', async () => {
    await pm.put('/organization/invoice-profile', { legalName: 'X' }).expect(403);
    const p = (await admin.put('/organization/invoice-profile', { legalName: ' Demo Research Ltd ', address: '1 High St', taxId: 'GB999', bankDetails: 'IBAN GB00 0000', footer: '' }).expect(200)).body;
    expect(p).toMatchObject({ legalName: 'Demo Research Ltd', footer: null });
    expect((await viewer.get('/organization/invoice-profile').expect(200)).body.taxId).toBe('GB999');
    const r = await viewer.get(`/invoices/${invoiceId}/pdf`).buffer(true).parse(binary).expect(200);
    expect(r.headers['content-disposition']).toBe('attachment; filename="INV-2026-00301.pdf"');
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await other.get(`/invoices/${invoiceId}/pdf`).expect(404);
    const c = (await pm.patch(`/clients/${clientId}`, { billingAddress: 'New address', taxId: null }).expect(200)).body;
    expect(c).toMatchObject({ billingAddress: 'New address', taxId: null });
  });

  it('attaches a PDF to scheduled report emails when asked', async () => {
    const mail = app.get(MailService);
    const sent: { attachments?: { filename: string; contentType: string; content: unknown }[] }[] = [];
    const orig = mail.send.bind(mail);
    mail.send = async (m: Parameters<typeof mail.send>[0]) => {
      sent.push(m);
      return { messageId: 'x' } as never;
    };
    const s = (await pm.post('/report-schedules', { name: 'Weekly clients', report: 'client', period: 'last_7_days', frequency: 'weekly', dayOfWeek: 1, hour: 9, recipients: ['ops@example.com'], attachPdf: true }).expect(201)).body;
    expect(s.attachPdf).toBe(true);
    const row = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: s.id } });
    await app.get(SchedulesService).run(row, 'manual');
    expect(sent[0].attachments!.map((a) => a.contentType)).toEqual(['text/csv', 'application/pdf']);
    expect(sent[0].attachments![1].filename).toMatch(/^weekly-clients-.+\.pdf$/);
    expect((sent[0].attachments![1].content as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    mail.send = orig;
  });
});
