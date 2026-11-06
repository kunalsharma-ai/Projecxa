import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { newKey } from '../../src/unique-links/unique-links';
import { api, createApp, login, makeOrg, PASSWORD, resetDb } from './helpers';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

describe('One-time unique links (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let vendorUser: ReturnType<typeof api>;
  let projectId: string;
  let countryId: string;
  let alloc: { id: string; entryCode: string; testEntryCode: string };
  const http = () => request(app.getHttpServer());
  const enter = (key: string, ip = 1) => http().get(`/u/${key}`).set('User-Agent', UA).set('X-Forwarded-For', `198.51.100.${ip}`).expect(302);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'uniq');
    const b = await makeOrg(prisma, 'uniq-other');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.PROJECT_MANAGER.email));
    const clientId = (await pm.post('/clients', { name: 'Client', code: 'CL' }).expect(201)).body.id;
    const vendorId = (await pm.post('/vendors', { name: 'Panel', code: 'PN' }).expect(201)).body.id;
    const p = (
      await pm
        .post('/projects', {
          name: 'Unique study',
          category: 'B2C',
          clientId,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 3, targetCompletes: 50, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }],
        })
        .expect(201)
    ).body;
    projectId = p.id;
    countryId = p.countries[0].id;
    await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId, cpi: 1, targetCompletes: 50 }).expect(201);
    alloc = (await pm.get(`/projects/${projectId}`).expect(200)).body.countries[0].allocations[0];
    await pm.post('/portal-users', { kind: 'vendor', partyId: vendorId, name: 'Panel user', email: 'panel@vendor.test', password: PASSWORD }).expect(201);
    vendorUser = api(app, await login(app, 'panel@vendor.test'));
  });

  afterAll(async () => {
    await app.close();
  });

  const goLive = async () => {
    await pm.patch(`/projects/${projectId}/countries/${countryId}`, { status: 'LIVE' }).expect(200);
    await pm.patch(`/projects/${projectId}`, { status: 'LIVE' }).expect(200);
  };

  it('makes random, distinct, letters-and-digits keys', () => {
    const keys = new Set(Array.from({ length: 5000 }, newKey));
    expect(keys.size).toBe(5000);
    for (const k of [...keys].slice(0, 50)) expect(k).toMatch(/^[A-HJ-NP-Za-km-z2-9]{24}$/);
  });

  it('generates N links with different keys; only editors can, and only in their organization', async () => {
    await viewer.post(`/projects/${projectId}/unique-links`, { allocationId: alloc.id, count: 3 }).expect(403);
    await other.post(`/projects/${projectId}/unique-links`, { allocationId: alloc.id, count: 3 }).expect(404);
    await pm.post(`/projects/${projectId}/unique-links`, { allocationId: 'nope', count: 3 }).expect(404);
    await pm.post(`/projects/${projectId}/unique-links`, { allocationId: alloc.id, count: 0 }).expect(400);
    await pm.post(`/projects/${projectId}/unique-links`, { allocationId: alloc.id, count: 50_001 }).expect(400);

    const r = await pm.post(`/projects/${projectId}/unique-links`, { allocationId: alloc.id, count: 1200, label: 'Wave 1' }).expect(201);
    expect(r.body.created).toBe(1200);
    const keys = await prisma.uniqueLink.findMany({ where: { batchId: r.body.batch.id }, select: { key: true } });
    expect(new Set(keys.map((k) => k.key)).size).toBe(1200);

    const s = (await viewer.get(`/projects/${projectId}/unique-links/summary`).expect(200)).body;
    expect(s.allocations[0]).toMatchObject({ total: 1200, unused: 1200, used: 0 });
    expect(s.batches[0]).toMatchObject({ label: 'Wave 1', count: 1200, unused: 1200 });
    await other.get(`/projects/${projectId}/unique-links/summary`).expect(404);

    const list = (await viewer.get(`/projects/${projectId}/unique-links?take=10`).expect(200)).body;
    expect(list.total).toBe(1200);
    expect(list.rows).toHaveLength(10);
    expect(list.rows[0].url).toBe(`http://api.samptrek.test/u/${list.rows[0].key}`);
  });

  it('does not use up a link while the project is not live', async () => {
    const link = await prisma.uniqueLink.findFirstOrThrow({ where: { projectId, status: 'UNUSED' } });
    const res = await enter(link.key);
    expect(res.headers.location).toBe('http://api.samptrek.test/end/quota_full');
    expect((await prisma.uniqueLink.findUniqueOrThrow({ where: { id: link.id } })).status).toBe('UNUSED');
    expect(await prisma.respondentSession.count({ where: { projectId } })).toBe(0);
  });

  it('lets the first respondent in and turns every later visit away as a duplicate', async () => {
    await goLive();
    const link = await prisma.uniqueLink.findFirstOrThrow({ where: { projectId, status: 'UNUSED' } });
    const first = await enter(link.key);
    expect(first.headers.location).toMatch(/^https:\/\/client\.example\.com\/s\?rid=/);
    const session = await prisma.respondentSession.findUniqueOrThrow({ where: { uniqueLinkId: link.id } });
    expect(session.vendorRespondentId).toBe(link.key);
    expect(session.status).toBe('STARTED');
    const used = await prisma.uniqueLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(used.status).toBe('USED');
    expect(used.usedAt).toBeTruthy();

    // Again from another device: no new session, the Duplicate page.
    const again = await enter(link.key, 2);
    expect(again.headers.location).not.toMatch(/client\.example\.com/);
    expect(await prisma.respondentSession.count({ where: { projectId } })).toBe(1);
    expect((await prisma.uniqueLink.findUniqueOrThrow({ where: { id: link.id } })).blockedAttempts).toBe(1);
    expect((await prisma.respondentSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe('STARTED');

    // Even after finishing the survey the link stays closed.
    await http().get(`/r/complete?token=${session.token}`).expect(302);
    const third = await enter(link.key, 3);
    expect(third.headers.location).not.toMatch(/client\.example\.com/);
    expect(await prisma.respondentSession.count({ where: { projectId } })).toBe(1);
  });

  it('lets exactly one of many simultaneous clicks in', async () => {
    const link = await prisma.uniqueLink.findFirstOrThrow({ where: { projectId, status: 'UNUSED' } });
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => enter(link.key, 10 + i)));
    const intoSurvey = results.filter((r) => /client\.example\.com/.test(r.headers.location));
    expect(intoSurvey).toHaveLength(1);
    expect(await prisma.respondentSession.count({ where: { uniqueLinkId: link.id } })).toBe(1);
  });

  it('keeps a vendor UID when the vendor passes one', async () => {
    const link = await prisma.uniqueLink.findFirstOrThrow({ where: { projectId, status: 'UNUSED' } });
    await http().get(`/u/${link.key}?uid=PANEL-77`).set('User-Agent', UA).expect(302);
    expect((await prisma.respondentSession.findUniqueOrThrow({ where: { uniqueLinkId: link.id } })).vendorRespondentId).toBe('PANEL-77');
  });

  it('rejects unknown, malformed, revoked and expired keys', async () => {
    expect((await enter(newKey())).headers.location).toBe('http://api.samptrek.test/end/security_reject');
    expect((await enter('bad key!')).headers.location).toBe('http://api.samptrek.test/end/security_reject');

    const one = await prisma.uniqueLink.findFirstOrThrow({ where: { projectId, status: 'UNUSED' } });
    await viewer.post(`/projects/${projectId}/unique-links/revoke`, { linkIds: [one.id] }).expect(403);
    expect((await pm.post(`/projects/${projectId}/unique-links/revoke`, { linkIds: [one.id] }).expect(201)).body.revoked).toBe(1);
    expect((await enter(one.key)).headers.location).toBe('http://api.samptrek.test/end/security_reject');

    const soon = new Date(Date.now() + 60_000).toISOString();
    const b = (await pm.post(`/projects/${projectId}/unique-links`, { allocationId: alloc.id, count: 2, label: 'Short', expiresAt: soon }).expect(201)).body.batch;
    await prisma.uniqueLinkBatch.update({ where: { id: b.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const exp = await prisma.uniqueLink.findFirstOrThrow({ where: { batchId: b.id } });
    expect((await enter(exp.key)).headers.location).toBe('http://api.samptrek.test/end/security_reject');
    expect((await prisma.uniqueLink.findUniqueOrThrow({ where: { id: exp.id } })).status).toBe('UNUSED');
    const expired = (await pm.get(`/projects/${projectId}/unique-links?status=EXPIRED`).expect(200)).body;
    expect(expired.total).toBe(2);
    expect(expired.rows[0].shownStatus).toBe('EXPIRED');
    await pm.post(`/projects/${projectId}/unique-links`, { allocationId: alloc.id, count: 2, expiresAt: new Date(Date.now() - 1000).toISOString() }).expect(400);
  });

  it('revokes the unused links of a batch but keeps used ones', async () => {
    const b = (await pm.post(`/projects/${projectId}/unique-links`, { allocationId: alloc.id, count: 5, label: 'To revoke' }).expect(201)).body.batch;
    const first = await prisma.uniqueLink.findFirstOrThrow({ where: { batchId: b.id } });
    await enter(first.key, 40);
    const r = (await pm.post(`/projects/${projectId}/unique-links/revoke`, { batchId: b.id }).expect(201)).body;
    expect(r.revoked).toBe(4);
    expect((await prisma.uniqueLink.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('USED');
    await pm.post(`/projects/${projectId}/unique-links/revoke`, {}).expect(400);
  });

  it('can close the shared vendor link so only unique links work; the test link still works', async () => {
    await viewer.post(`/projects/${projectId}/unique-links/allocations/${alloc.id}/only`, { uniqueLinksOnly: true }).expect(403);
    await pm.post(`/projects/${projectId}/unique-links/allocations/${alloc.id}/only`, { uniqueLinksOnly: true }).expect(201);
    const shared = await http().get(`/s/${alloc.entryCode}?uid=SHARED1`).set('User-Agent', UA).expect(302);
    expect(shared.headers.location).toBe('http://api.samptrek.test/end/security_reject');
    expect(await prisma.respondentSession.count({ where: { vendorRespondentId: 'SHARED1' } })).toBe(0);
    const test = await http().get(`/s/${alloc.testEntryCode}?uid=TEST1`).set('User-Agent', UA).expect(302);
    expect(test.headers.location).toMatch(/client\.example\.com/);
    const link = await prisma.uniqueLink.findFirstOrThrow({ where: { projectId, status: 'UNUSED', batch: { expiresAt: null } } });
    expect((await enter(link.key, 50)).headers.location).toMatch(/client\.example\.com/);
    const s = (await pm.get(`/projects/${projectId}/unique-links/summary`).expect(200)).body;
    expect(s.allocations[0].uniqueLinksOnly).toBe(true);
    expect(s.allocations[0].completes).toBe(1);
    await pm.post(`/projects/${projectId}/unique-links/allocations/${alloc.id}/only`, { uniqueLinksOnly: false }).expect(201);
    expect((await http().get(`/s/${alloc.entryCode}?uid=SHARED2`).set('User-Agent', UA).expect(302)).headers.location).toMatch(/client\.example\.com/);
  });

  it('exports links as CSV with status per key, filtered', async () => {
    const res = await pm.get(`/projects/${projectId}/unique-links/export.csv?status=USED`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toContain('"Key","Link","Vendor","Market","Batch","Link status"');
    const used = await prisma.uniqueLink.count({ where: { projectId, status: 'USED' } });
    expect(lines).toHaveLength(used + 1);
    expect(lines.slice(1).every((l) => l.includes('"USED"'))).toBe(true);
    expect(res.text).toContain('"COMPLETE"');
    await other.get(`/projects/${projectId}/unique-links/export.csv`).expect(404);

    const all = await pm.get(`/projects/${projectId}/unique-links/export.csv`).expect(200);
    expect(all.text.trim().split('\r\n')).toHaveLength((await prisma.uniqueLink.count({ where: { projectId } })) + 1);
  });

  it('lets the vendor download its own unused links from the portal', async () => {
    const allocs = (await vendorUser.get('/portal/vendor/allocations').expect(200)).body;
    expect(allocs[0].uniqueLinks.total).toBeGreaterThan(0);
    const unused = await prisma.uniqueLink.count({ where: { vendorAllocationId: alloc.id, status: 'UNUSED', batch: { OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] } } });
    expect(allocs[0].uniqueLinks.unused).toBe(unused);
    const csv = await vendorUser.get(`/portal/vendor/allocations/${alloc.id}/unique-links.csv`).expect(200);
    expect(csv.text.trim().split('\r\n')).toHaveLength(unused + 1);
    await vendorUser.get(`/projects/${projectId}/unique-links/summary`).expect(403);
  });
});
