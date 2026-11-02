import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { MailService } from '../../src/mail/mail.service';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('Portal requests, disputes, files and invoices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let otherOrg: ReturnType<typeof api>;
  let vendorA: ReturnType<typeof api>;
  let vendorB: ReturnType<typeof api>;
  let client1: ReturnType<typeof api>;
  let client2: ReturnType<typeof api>;
  const tokens = new Map<ReturnType<typeof api>, string>();
  let orgId: string;
  let pmId: string;
  let c1: string;
  let vA: string;
  let vB: string;
  let projectId: string;
  let otherClientProject: string;
  const sent: { to: string[]; subject: string; text?: string }[] = [];
  const http = () => request(app.getHttpServer());
  const upload = (who: ReturnType<typeof api>, path: string, buf: Buffer, name: string, fields: Record<string, string> = {}) => {
    let r = http().post(`/api/v1${path}`).set('Authorization', `Bearer ${tokens.get(who)}`);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('file', buf, name);
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'req-a');
    const b = await makeOrg(prisma, 'req-b');
    orgId = a.org.id;
    pmId = a.users.PROJECT_MANAGER.id;
    const tp = await login(app, a.users.PROJECT_MANAGER.email);
    pm = api(app, tp);
    tokens.set(pm, tp);
    viewer = api(app, await login(app, a.users.VIEWER.email));
    const to = await login(app, b.users.PROJECT_MANAGER.email);
    otherOrg = api(app, to);
    tokens.set(otherOrg, to);
    app.get(MailService).transport = async (_from, m) => {
      sent.push({ to: m.to, subject: m.subject, text: m.text });
      return { messageId: 'x' };
    };

    c1 = (await pm.post('/clients', { name: 'Client One', code: 'RC1' }).expect(201)).body.id;
    const c2 = (await pm.post('/clients', { name: 'Client Two', code: 'RC2' }).expect(201)).body.id;
    vA = (await pm.post('/vendors', { name: 'Vendor A', code: 'RVA' }).expect(201)).body.id;
    vB = (await pm.post('/vendors', { name: 'Vendor B', code: 'RVB' }).expect(201)).body.id;
    const pw = 'portal-password-123';
    await pm.post('/portal-users', { kind: 'vendor', partyId: vA, name: 'Vendor A user', email: 'a@rv.test', password: pw }).expect(201);
    await pm.post('/portal-users', { kind: 'vendor', partyId: vB, name: 'Vendor B user', email: 'b@rv.test', password: pw }).expect(201);
    await pm.post('/portal-users', { kind: 'client', partyId: c1, name: 'Client One user', email: 'one@rc.test', password: pw }).expect(201);
    await pm.post('/portal-users', { kind: 'client', partyId: c2, name: 'Client Two user', email: 'two@rc.test', password: pw }).expect(201);
    const tok = async (email: string) => (await http().post('/api/v1/auth/login').send({ email, password: pw }).expect(200)).body.token as string;
    for (const [email, set] of [
      ['a@rv.test', (x: ReturnType<typeof api>) => (vendorA = x)],
      ['b@rv.test', (x: ReturnType<typeof api>) => (vendorB = x)],
      ['one@rc.test', (x: ReturnType<typeof api>) => (client1 = x)],
      ['two@rc.test', (x: ReturnType<typeof api>) => (client2 = x)],
    ] as const) {
      const t = await tok(email);
      const c = api(app, t);
      tokens.set(c, t);
      set(c);
    }

    const mk = async (clientId: string, name: string) =>
      (
        await pm
          .post('/projects', {
            name,
            category: 'B2B',
            clientId,
            defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 9, targetCompletes: 10, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
            countries: [{ countryCode: 'US' }],
          })
          .expect(201)
      ).body;
    const p = await mk(c1, 'Requests study');
    projectId = p.id;
    const countryId = p.countries[0].id;
    await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId: vA, cpi: 2.5, targetCompletes: 5 }).expect(201);
    await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);
    const other = await mk(c2, 'Other client study');
    otherClientProject = other.id;
    await prisma.project.update({ where: { id: other.id }, data: { status: 'LIVE' } });

    const code = (await pm.get(`/projects/${projectId}`).expect(200)).body.countries[0].allocations[0].entryCode;
    for (const uid of ['A-1', 'A-2', 'A-3']) {
      const entry = await http().get(`/s/${code}?uid=${uid}`).expect(302);
      const token = new URL(entry.headers.location).searchParams.get('rid')!;
      await http().get(`/r/complete?token=${token}`).expect(302);
    }
    const ids = (await prisma.respondentSession.findMany({ where: { projectId, status: 'COMPLETE' }, orderBy: { vendorRespondentId: 'asc' } })).map((s) => s.id);
    await pm.post(`/projects/${projectId}/sessions/approval`, { sessionIds: ids.slice(0, 2), approval: 'REJECTED' }).expect(201);
    await pm.post(`/projects/${projectId}/sessions/approval`, { sessionIds: ids.slice(2), approval: 'APPROVED' }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a client opens a request; staff answer; the client sees no internal notes; numbers go up', async () => {
    await client1.post('/portal/requests', { subject: 'Hi', body: 'x' }).expect(400);
    await client1.post('/portal/requests', { subject: 'Change the LOI', body: 'Can we go to 12 minutes?', projectId: otherClientProject }).expect(404);
    await client1.post('/portal/requests', { subject: 'Change the LOI', body: 'x', clientId: c1 }).expect(400);
    const r = await client1.post('/portal/requests', { subject: 'Change the LOI', body: 'Can we go to 12 minutes?', projectId }).expect(201);
    expect(r.body).toMatchObject({ ref: 'REQ-1', status: 'OPEN', kind: 'QUESTION', project: { id: projectId } });
    expect(r.body.client).toBeUndefined();
    // The project manager was emailed.
    expect(sent.find((m) => m.subject.startsWith('New request REQ-1'))?.to).toEqual(['project_manager@req-a.test']);

    const inbox = (await pm.get('/requests?status=OPEN').expect(200)).body;
    expect(inbox[0]).toMatchObject({ ref: 'REQ-1', client: { id: c1, name: 'Client One' }, assignee: { id: pmId } });
    await viewer.get(`/requests/${r.body.id}`).expect(200);
    await viewer.post(`/requests/${r.body.id}/messages`, { body: 'no' }).expect(403);
    await otherOrg.get(`/requests/${r.body.id}`).expect(404);

    await pm.post(`/requests/${r.body.id}/messages`, { body: 'Checking margin first', internal: true }).expect(201);
    expect((await pm.get(`/requests/${r.body.id}`).expect(200)).body.status).toBe('OPEN');
    const answered = await pm.post(`/requests/${r.body.id}/messages`, { body: 'Yes, from tomorrow.' }).expect(201);
    expect(answered.body.status).toBe('ANSWERED');
    expect(sent.find((m) => m.subject.startsWith('New reply on REQ-1'))?.to).toEqual(['one@rc.test']);

    const seen = (await client1.get(`/portal/requests/${r.body.id}`).expect(200)).body;
    expect(seen.messages.map((m: { body: string }) => m.body)).toEqual(['Can we go to 12 minutes?', 'Yes, from tomorrow.']);
    expect(JSON.stringify(seen)).not.toContain('margin');
    await client2.get(`/portal/requests/${r.body.id}`).expect(404);
    await vendorA.get(`/portal/requests/${r.body.id}`).expect(404);
    expect((await client2.get('/portal/requests').expect(200)).body).toEqual([]);
    await client1.post(`/portal/requests/${r.body.id}/messages`, { body: 'x', internal: true }).expect(400);

    const closed = await client1.post(`/portal/requests/${r.body.id}/close`).expect(201);
    expect(closed.body.status).toBe('CLOSED');
    // Writing again reopens it for staff.
    expect((await client1.post(`/portal/requests/${r.body.id}/messages`, { body: 'One more thing' }).expect(201)).body.status).toBe('OPEN');
    const second = await vendorA.post('/portal/requests', { subject: 'Links are slow', body: 'Entry takes 5 s', kind: 'ISSUE' }).expect(201);
    expect(second.body.ref).toBe('REQ-2');
  });

  it('a vendor disputes rejected completes; staff approve them and the vendor is told', async () => {
    const disputable = (await vendorA.get('/portal/vendor/disputable').expect(200)).body;
    expect(disputable.map((d: { uid: string }) => d.uid).sort()).toEqual(['A-1', 'A-2']);
    expect((await vendorB.get('/portal/vendor/disputable').expect(200)).body).toEqual([]);
    const approvedId = (await prisma.respondentSession.findFirstOrThrow({ where: { vendorRespondentId: 'A-3' } })).id;
    const ids = disputable.map((d: { id: string }) => d.id);

    await vendorA.post('/portal/requests', { subject: 'Dispute rejects', body: 'These passed QC', kind: 'DISPUTE', sessionIds: [...ids, approvedId] }).expect(400);
    await vendorB.post('/portal/requests', { subject: 'Dispute rejects', body: 'Not ours', kind: 'DISPUTE', sessionIds: ids }).expect(400);
    await client1.post('/portal/requests', { subject: 'Dispute rejects', body: 'x', kind: 'DISPUTE', sessionIds: ids }).expect(400);
    await vendorA.post('/portal/requests', { subject: 'Not a dispute', body: 'x', sessionIds: ids }).expect(400);
    const d = await vendorA.post('/portal/requests', { subject: 'Dispute 2 rejects', body: 'These passed our QC', kind: 'DISPUTE', sessionIds: ids }).expect(201);
    expect(d.body).toMatchObject({ kind: 'DISPUTE', disputedCompletes: 2, project: { id: projectId } });
    expect(d.body.sessions.map((s: { approval: string }) => s.approval)).toEqual(['REJECTED', 'REJECTED']);
    await vendorA.post('/portal/requests', { subject: 'Again', body: 'x', kind: 'DISPUTE', sessionIds: ids }).expect(400);
    expect((await vendorA.get('/portal/vendor/disputable').expect(200)).body).toEqual([]);

    const bell = (await pm.get('/insights').expect(200)).body.items.find((i: { id: string }) => i.id === 'requests');
    expect(bell).toMatchObject({ severity: 'warn' });
    expect(bell.detail).toMatch(/dispute/);

    await viewer.post(`/requests/${d.body.id}/dispute`, { decision: 'APPROVE' }).expect(403);
    const decided = await pm.post(`/requests/${d.body.id}/dispute`, { decision: 'APPROVE', message: 'Agreed with the client.' }).expect(201);
    expect(decided.body.status).toBe('CLOSED');
    expect(await prisma.respondentSession.count({ where: { id: { in: ids }, approval: 'APPROVED' } })).toBe(2);
    const vendorView = (await vendorA.get(`/portal/requests/${d.body.id}`).expect(200)).body;
    expect(vendorView.messages.at(-1).body).toMatch(/^Approved 2 of 2 disputed completes\.\n\nAgreed with the client\./);
    expect(await prisma.auditEvent.findFirst({ where: { organizationId: orgId, action: 'request.dispute-decision' } })).toBeTruthy();
  });

  it('shares files: clients send questionnaires, staff send deliverables, vendors keep compliance documents', async () => {
    // Types and sizes
    await upload(client1, '/portal/files', Buffer.from('<html><script>alert(1)</script></html>'), 'q.html').expect(400);
    await upload(client1, '/portal/files', Buffer.from('<svg/>'), 'q.pdf').expect(400);
    await upload(client1, '/portal/files', Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]), 'big.pdf').expect(413);
    await upload(client1, '/portal/files', PDF, 'q.pdf', { kind: 'DELIVERABLE' }).expect(400);
    await upload(client1, '/portal/files', PDF, 'q.pdf', { projectId: otherClientProject }).expect(400);

    const q = await upload(client1, '/portal/files', PDF, 'Questionnaire v3.pdf', { kind: 'QUESTIONNAIRE', projectId, note: 'Final' }).expect(201);
    expect(q.body).toMatchObject({ kind: 'QUESTIONNAIRE', name: 'Questionnaire v3.pdf', fromPortal: true, project: { id: projectId } });
    expect(q.body.sharedWith).toBeUndefined();
    const deliverable = await upload(pm, '/files', PDF, 'Topline.pdf', { kind: 'DELIVERABLE', projectId, clientId: c1 }).expect(201);
    await upload(pm, '/files', PDF, 'Wrong.pdf', { kind: 'DELIVERABLE', projectId, clientId: (await prisma.client.findFirstOrThrow({ where: { code: 'RC2' } })).id }).expect(400);
    const internal = await upload(pm, '/files', PNG, 'margin.png', { projectId }).expect(201);

    const c1Files = (await client1.get(`/portal/files?projectId=${projectId}`).expect(200)).body.map((f: { name: string }) => f.name).sort();
    expect(c1Files).toEqual(['Questionnaire v3.pdf', 'Topline.pdf']);
    expect((await client2.get('/portal/files').expect(200)).body).toEqual([]);
    expect((await vendorA.get('/portal/files').expect(200)).body).toEqual([]);
    const staffFiles = (await pm.get(`/files?projectId=${projectId}`).expect(200)).body;
    expect(staffFiles).toHaveLength(3);
    expect(staffFiles.find((f: { name: string }) => f.name === 'Topline.pdf').sharedWith).toMatchObject({ kind: 'client', id: c1 });

    const dl = await http().get(`/api/v1/portal/files/${deliverable.body.id}/download`).set('Authorization', `Bearer ${tokens.get(client1)}`).buffer(true).expect(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toContain('attachment; filename="Topline.pdf"');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(dl.body as Buffer, PDF)).toBe(0);
    await http().get(`/api/v1/portal/files/${internal.body.id}/download`).set('Authorization', `Bearer ${tokens.get(client1)}`).expect(404);
    await http().get(`/api/v1/portal/files/${q.body.id}/download`).set('Authorization', `Bearer ${tokens.get(client2)}`).expect(404);

    // Clients may remove their own uploads but not staff deliverables.
    await client1.delete(`/portal/files/${deliverable.body.id}`).expect(403);
    await client1.delete(`/portal/files/${q.body.id}`).expect(200);

    // Vendor compliance with expiry, shown in the bell when it is close.
    await upload(vendorA, '/portal/files', PDF, 'iso.pdf', { kind: 'QUESTIONNAIRE' }).expect(400);
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const iso = await upload(vendorA, '/portal/files', PDF, 'ISO 20252 certificate.pdf', { kind: 'COMPLIANCE', expiresAt: soon }).expect(201);
    expect(iso.body).toMatchObject({ kind: 'COMPLIANCE', expired: false });
    await upload(vendorA, '/portal/files', PDF, 'x.pdf', { kind: 'OTHER', expiresAt: soon }).expect(400);
    expect((await pm.get(`/files?vendorId=${vA}&kind=COMPLIANCE`).expect(200)).body).toHaveLength(1);
    expect((await vendorB.get('/portal/files').expect(200)).body).toEqual([]);
    const bell = (await pm.get('/insights').expect(200)).body.items.find((i: { id: string }) => i.id === `compliance-${iso.body.id}`);
    expect(bell).toMatchObject({ severity: 'warn', href: `/vendors/${vA}` });
    expect((await pm.get('/files/compliance/expiring').expect(200)).body[0].vendor.id).toBe(vA);

    // Files on a request take the request's company.
    const req = (await vendorA.get('/portal/requests').expect(200)).body[0];
    const att = await upload(vendorA, '/portal/files', PNG, 'screenshot.png', { ticketId: req.id }).expect(201);
    expect((await pm.get(`/requests/${req.id}`).expect(200)).body.files.map((f: { id: string }) => f.id)).toContain(att.body.id);
    await upload(vendorB, '/portal/files', PNG, 's.png', { ticketId: req.id }).expect(404);
    await viewer.delete(`/files/${att.body.id}`).expect(403);
    await upload(otherOrg, '/files', PDF, 'x.pdf', { projectId }).expect(400);
    expect(await prisma.auditEvent.count({ where: { organizationId: orgId, action: 'file.download' } })).toBe(1);
  });

  it('clients see their sent and paid invoices with the PDF, never drafts or other clients’', async () => {
    const inv = await prisma.invoice.create({
      data: { organizationId: orgId, projectId, clientId: c1, number: 'INV-9001', status: 'SENT', completes: 2, currency: 'USD', subtotal: 18, taxAmount: 0, total: 18, issuedAt: new Date(), dueAt: new Date(Date.now() - 86_400_000), lines: [{ description: 'Completes US', countryCode: 'US', quantity: 2, unitPrice: 9, amount: 18 }] },
    });
    const draft = await prisma.invoice.create({ data: { organizationId: orgId, projectId, clientId: c1, number: 'INV-9002', status: 'DRAFT', completes: 1, currency: 'USD', subtotal: 9, taxAmount: 0, total: 9, lines: [] } });
    const list = (await client1.get('/portal/client/invoices').expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: 'INV-9001', status: 'SENT', completes: 2, total: 18, overdue: true });
    expect((await client2.get('/portal/client/invoices').expect(200)).body).toEqual([]);
    await vendorA.get('/portal/client/invoices').expect(403);
    const pdf = await http().get(`/api/v1/portal/client/invoices/${inv.id}/pdf`).set('Authorization', `Bearer ${tokens.get(client1)}`).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await http().get(`/api/v1/portal/client/invoices/${draft.id}/pdf`).set('Authorization', `Bearer ${tokens.get(client1)}`).expect(404);
    await http().get(`/api/v1/portal/client/invoices/${inv.id}/pdf`).set('Authorization', `Bearer ${tokens.get(client2)}`).expect(404);
  });
});
