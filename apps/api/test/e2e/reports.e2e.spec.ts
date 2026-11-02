import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

describe('Fieldwork reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let otherPm: ReturnType<typeof api>;
  let clientId: string;
  let vA: string;
  let vB: string;
  let projectId: string;
  const http = () => request(app.getHttpServer());

  /** Builds a live project with US (USD) and DE (EUR) markets and both vendors on US, vendor A on DE. */
  async function seedProject(p: ReturnType<typeof api>, client: string, vendors: string[]) {
    const proj = (
      await p
        .post('/projects', {
          name: 'Report study',
          category: 'B2C',
          clientId: client,
          defaults: { language: 'en', loiMinutes: 10, irPercent: 50, cpi: 9, targetCompletes: 50, liveSurveyUrl: 'https://client.example.com/s?rid={session_token}' },
          countries: [{ countryCode: 'US' }, { countryCode: 'DE', language: 'de', currency: 'EUR', cpi: 8 }],
        })
        .expect(201)
    ).body;
    for (const c of proj.countries) {
      const vs = c.countryCode === 'US' ? vendors : vendors.slice(0, 1);
      for (const v of vs) await p.post(`/projects/${proj.id}/countries/${c.id}/allocations`, { vendorId: v, cpi: 3, targetCompletes: 20 }).expect(201);
      await p.patch(`/projects/${proj.id}/countries/${c.id}`, { status: 'LIVE' }).expect(200);
    }
    await p.patch(`/projects/${proj.id}`, { status: 'LIVE' }).expect(200);
    const detail = (await p.get(`/projects/${proj.id}`).expect(200)).body;
    const code = (country: string, vendorId: string, test = false) => {
      const a = detail.countries.find((c: { countryCode: string }) => c.countryCode === country).allocations.find((x: { vendorId: string }) => x.vendorId === vendorId);
      return test ? a.testEntryCode : a.entryCode;
    };
    return { id: proj.id as string, code };
  }

  async function run(code: string, uid: string, status?: string) {
    const entry = await http().get(`/s/${code}?uid=${uid}`).expect(302);
    if (!status) return;
    const token = new URL(entry.headers.location).searchParams.get('rid')!;
    await http().get(`/r/${status}?token=${token}`).expect(302);
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'rep-a');
    const b = await makeOrg(prisma, 'rep-b');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    otherPm = api(app, await login(app, b.users.PROJECT_MANAGER.email));

    clientId = (await pm.post('/clients', { name: 'Client R', code: 'CR' }).expect(201)).body.id;
    vA = (await pm.post('/vendors', { name: 'Vendor A', code: 'VA' }).expect(201)).body.id;
    vB = (await pm.post('/vendors', { name: 'Vendor B', code: 'VB' }).expect(201)).body.id;
    const p = await seedProject(pm, clientId, [vA, vB]);
    projectId = p.id;

    await run(p.code('US', vA), 'A-1', 'complete');
    await run(p.code('US', vA), 'A-2', 'complete');
    await run(p.code('US', vA), 'A-3', 'terminate');
    await run(p.code('US', vA), 'A-4'); // still in the survey
    await run(p.code('US', vB), 'B-1', 'complete');
    await run(p.code('US', vB), 'B-2', 'quotafull');
    await run(p.code('DE', vA), 'D-1', 'complete');
    await run(p.code('US', vA, true), 'T-1', 'complete'); // test link: never in reports

    // Reject B-1, and move A-1 into January for the date filter checks.
    const b1 = await prisma.respondentSession.findFirstOrThrow({ where: { vendorRespondentId: 'B-1' } });
    await pm.post(`/projects/${projectId}/sessions/approval`, { sessionIds: [b1.id], approval: 'REJECTED' }).expect(201);
    await prisma.respondentSession.updateMany({
      where: { vendorRespondentId: 'A-1' },
      data: { startedAt: new Date('2026-01-15T10:00:00Z'), outcomeAt: new Date('2026-01-15T10:12:00Z') },
    });
    await prisma.respondentEvent.updateMany({ where: { session: { vendorRespondentId: 'A-1' } }, data: { createdAt: new Date('2026-01-15T10:05:00Z') } });

    // Traffic in another tenant must never leak in.
    const oc = (await otherPm.post('/clients', { name: 'Other client', code: 'OC' }).expect(201)).body.id;
    const ov = (await otherPm.post('/vendors', { name: 'Other vendor', code: 'OV' }).expect(201)).body.id;
    const op = await seedProject(otherPm, oc, [ov]);
    await run(op.code('US', ov), 'O-1', 'complete');
  });

  afterAll(async () => {
    await app.close();
  });

  it('overall report: totals exclude tests, other tenants and rejected money', async () => {
    const r = (await viewer.get('/reports/overall').expect(200)).body;
    expect(r.totals).toMatchObject({ clicks: 7, completes: 4, terminates: 1, quotaFull: 1, inProgress: 1, rejected: 1, pending: 3 });
    // Billable: A-1, A-2 (US 9 USD), D-1 (DE 8 EUR); B-1 is rejected.
    expect(r.totals.revenue).toBe(26);
    expect(r.totals.payout).toBe(9);
    expect(r.totals.profit).toBe(17);
    expect(r.totals.conversion).toBeCloseTo(57.1);
    expect(r.totals.currencies).toEqual(['EUR', 'USD']);
    expect(r.totals.money).toEqual([
      { currency: 'EUR', revenue: 8, payout: 3, profit: 5 },
      { currency: 'USD', revenue: 18, payout: 6, profit: 12 },
    ]);
    expect(r.counts).toEqual({ clients: 1, vendors: 2, projects: 1 });
    expect(r.topVendors[0]).toMatchObject({ label: 'Vendor A', completes: 3 });
    expect(JSON.stringify(r)).not.toMatch(/Other/);
  });

  it('money is also converted into the reporting currency with the manual rates', async () => {
    // No EUR rate yet: EUR money is left out of the converted figures and named.
    const before = (await viewer.get('/reports/overall').expect(200)).body;
    expect(before.totals.reporting).toEqual({ currency: 'USD', revenue: 18, payout: 6, profit: 12, margin: 66.7, missing: ['EUR'] });
    expect(before.fx).toMatchObject({ currency: 'USD', rates: [] });

    const orgId = (await prisma.organization.findUniqueOrThrow({ where: { slug: 'rep-a' } })).id;
    await prisma.exchangeRate.create({ data: { organizationId: orgId, currency: 'EUR', rate: 1.1 } });
    const r = (await viewer.get('/reports/overall').expect(200)).body;
    // 18 USD + 8 EUR × 1.1 = 26.80; payout 6 + 3 × 1.1 = 9.30.
    expect(r.totals.reporting).toEqual({ currency: 'USD', revenue: 26.8, payout: 9.3, profit: 17.5, margin: 65.3, missing: [] });
    expect(r.totals.margin).toBeNull(); // the unconverted margin still refuses to mix currencies
    expect(r.fx.rates).toEqual([{ currency: 'EUR', rate: 1.1 }]);

    const byVendor = (await viewer.get('/reports/summary?groupBy=vendor').expect(200)).body;
    const a = byVendor.rows.find((x: { label: string }) => x.label === 'Vendor A');
    expect(a.reporting).toMatchObject({ currency: 'USD', revenue: 26.8, missing: [] });
    expect(byVendor.fx.currency).toBe('USD');
    // Rejected money stays out of converted figures too (vendor B's only complete is rejected).
    expect(byVendor.rows.find((x: { label: string }) => x.label === 'Vendor B').reporting).toMatchObject({ revenue: 0, payout: 0, margin: null });

    const pdf = await viewer.get('/reports/pdf?report=vendor&money=reporting').expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    await viewer.get('/reports/pdf?report=vendor&money=sideways').expect(400);
    await prisma.exchangeRate.deleteMany({ where: { organizationId: orgId } });
  });

  it('date range is by UTC day, inclusive, and fills empty days', async () => {
    const jan = (await pm.get('/reports/overall?from=2026-01-14&to=2026-01-16').expect(200)).body;
    expect(jan.totals).toMatchObject({ clicks: 1, completes: 1, medianLoiMinutes: 12 });
    expect(jan.byDay.map((d: { key: string; clicks: number }) => [d.key, d.clicks])).toEqual([
      ['2026-01-14', 0],
      ['2026-01-15', 1],
      ['2026-01-16', 0],
    ]);
    const after = (await pm.get('/reports/overall?from=2026-01-16').expect(200)).body;
    expect(after.totals.clicks).toBe(6);
    await pm.get('/reports/overall?from=2026-02-01&to=2026-01-01').expect(400);
    await pm.get('/reports/overall?from=yesterday').expect(400);
  });

  it('client and vendor reports group correctly and honour filters', async () => {
    const clients = (await pm.get('/reports/summary?groupBy=client').expect(200)).body;
    expect(clients.rows).toHaveLength(1);
    expect(clients.rows[0]).toMatchObject({ label: 'Client R', sublabel: 'CR', clicks: 7, completes: 4, revenue: 26 });

    const vendors = (await pm.get('/reports/summary?groupBy=vendor').expect(200)).body.rows;
    const byName = Object.fromEntries(vendors.map((v: { label: string }) => [v.label, v]));
    expect(byName['Vendor A']).toMatchObject({ clicks: 5, completes: 3, terminates: 1, inProgress: 1, payout: 9, revenue: 26, profit: 17 });
    expect(byName['Vendor B']).toMatchObject({ clicks: 2, completes: 1, quotaFull: 1, rejected: 1, revenue: 0, payout: 0, margin: null, money: [] });
    expect(byName['Vendor A'].money.map((m: { currency: string }) => m.currency)).toEqual(['EUR', 'USD']);

    const vc = (await pm.get('/reports/summary?groupBy=vendor_country').expect(200)).body.rows;
    expect(vc.map((r: { label: string; sublabel: string }) => `${r.label}/${r.sublabel}`).sort()).toEqual(['Vendor A/DE', 'Vendor A/US', 'Vendor B/US']);

    const de = (await pm.get(`/reports/summary?groupBy=vendor&countryCode=DE`).expect(200)).body;
    expect(de.rows).toHaveLength(1);
    expect(de.totals).toMatchObject({ clicks: 1, revenue: 8, currencies: ['EUR'] });
    const onlyB = (await pm.get(`/reports/summary?groupBy=project&vendorId=${vB}`).expect(200)).body;
    expect(onlyB.totals.clicks).toBe(2);
    await pm.get('/reports/summary?groupBy=planet').expect(400);
  });

  it('conversion report lists respondents with paging, status filter and export', async () => {
    const page1 = (await pm.get('/reports/conversion?pageSize=5').expect(200)).body;
    expect(page1.total).toBe(7);
    expect(page1.rows).toHaveLength(5);
    const page2 = (await pm.get('/reports/conversion?pageSize=5&page=2').expect(200)).body;
    expect(page2.rows).toHaveLength(2);
    const ids = new Set([...page1.rows, ...page2.rows].map((r: { id: string }) => r.id));
    expect(ids.size).toBe(7);
    expect([...page1.rows, ...page2.rows].map((r: { uid: string }) => r.uid)).not.toContain('T-1');

    const completes = (await pm.get('/reports/conversion?status=COMPLETE&export=1').expect(200)).body;
    expect(completes.rows.map((r: { uid: string }) => r.uid).sort()).toEqual(['A-1', 'A-2', 'B-1', 'D-1']);
    const a1 = completes.rows.find((r: { uid: string }) => r.uid === 'A-1');
    expect(a1).toMatchObject({ client: 'Client R', vendor: 'Vendor A', countryCode: 'US', revenue: 9, payout: 3, loiMinutes: 12, approval: 'PENDING' });
    expect(completes.rows.find((r: { uid: string }) => r.uid === 'B-1').approval).toBe('REJECTED');
    await pm.get('/reports/conversion?pageSize=5000').expect(400);
  });

  it('clicks report is the event log', async () => {
    const r = (await pm.get('/reports/clicks').expect(200)).body;
    expect(r.byType.ENTRY).toBe(7);
    expect(r.rows.every((e: { uid: string }) => e.uid !== 'T-1' && e.uid !== 'O-1')).toBe(true);
    const jan = (await pm.get('/reports/clicks?from=2026-01-15&to=2026-01-15').expect(200)).body;
    expect(jan.rows.every((e: { uid: string }) => e.uid === 'A-1')).toBe(true);
    expect(jan.total).toBeGreaterThan(0);
  });

  it('filter options and tenant isolation', async () => {
    const o = (await pm.get('/reports/options').expect(200)).body;
    expect(o.countries).toEqual(['DE', 'US']);
    expect(o.vendors.map((v: { name: string }) => v.name)).toEqual(['Vendor A', 'Vendor B']);
    // Another tenant filtering by this tenant's project sees nothing.
    const leak = (await otherPm.get(`/reports/overall?projectId=${projectId}`).expect(200)).body;
    expect(leak.totals.clicks).toBe(0);
  });

  it('portal users cannot open staff reports', async () => {
    const pw = 'portal-password-123';
    await pm.post('/portal-users', { kind: 'vendor', partyId: vA, name: 'A', email: 'a@rep.test', password: pw }).expect(201);
    const tok = (await http().post('/api/v1/auth/login').send({ email: 'a@rep.test', password: pw }).expect(200)).body.token;
    await api(app, tok).get('/reports/overall').expect(403);
    await api(app, tok).get('/reports/conversion').expect(403);
  });
});
