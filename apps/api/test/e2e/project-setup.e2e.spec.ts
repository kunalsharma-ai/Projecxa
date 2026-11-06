import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, createApp, login, makeOrg, resetDb } from './helpers';

/** Project setup feedback (2026-11-06): markets, go-live rules, payouts, bulk edits, clone, custom options. */
describe('Project setup (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let clientId: string;
  let vendorA: string;
  let vendorB: string;
  const LINK = 'https://client.example.com/s?rid={session_token}';

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'setup');
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    clientId = (await pm.post('/clients', { name: 'Client One', code: 'C1' }).expect(201)).body.id;
    vendorA = (await pm.post('/vendors', { name: 'Vendor A', code: 'VA' }).expect(201)).body.id;
    vendorB = (await pm.post('/vendors', { name: 'Vendor B', code: 'VB' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const base = (o: object = {}) => ({
    name: 'Japan two audiences',
    category: 'B2C',
    clientId,
    currency: 'EUR',
    defaults: { loiMinutes: 12, irPercent: 40, cpi: 15, targetCompletes: 100 },
    countries: [
      { countryCode: 'JP', language: 'ja', targetGroup: 'Gen Z', liveSurveyUrl: LINK },
      { countryCode: 'JP', language: 'ja', targetGroup: 'Parents' },
      { countryCode: 'US', language: 'en', currency: 'USD' },
    ],
    ...o,
  });

  it('accepts the same country twice for different target groups, with one CPI currency and vendors and gate questions', async () => {
    const p = (
      await pm
        .post('/projects', base({
          vendors: [{ vendorId: vendorA, cpi: 6 }],
          gateQuestions: [{ id: 'age', type: 'number', text: 'How old are you?', validation: { min: 1, max: 120, integer: true }, qualify: { min: 18 } }],
        }))
        .expect(201)
    ).body;
    expect(p.countries.filter((c: { countryCode: string }) => c.countryCode === 'JP')).toHaveLength(2);
    expect(p.countries.every((c: { currency: string }) => c.currency === 'EUR')).toBe(true);
    for (const c of p.countries) {
      expect(c.allocations).toHaveLength(1);
      expect(c.allocations[0]).toMatchObject({ vendorId: vendorA, uidParam: 'vid', targetCompletes: 100 });
      expect(c.allocations[0].entryLink).toContain('?vid=[UID]');
    }
    expect(p.gateQuestions).toHaveLength(1);
    expect(p.finance[0]).toMatchObject({ currency: 'EUR', avgCpi: 15, plannedRevenue: 4500, plannedCost: 1800, revenue: 0 });
  });

  it('still refuses the exact same market twice', async () => {
    const res = await pm.post('/projects', base({ countries: [{ countryCode: 'JP', language: 'ja', targetGroup: 'Gen Z' }, { countryCode: 'JP', language: 'ja', targetGroup: ' gen z ' }] })).expect(400);
    expect(res.body.issues[0]).toMatch(/listed twice.*different target group/);
  });

  it('refuses a vendor payout above the client CPI unless confirmed', async () => {
    const res = await pm.post('/projects', base({ vendors: [{ vendorId: vendorA, cpi: 90 }] })).expect(400);
    expect(res.body.code).toBe('PAYOUT_ABOVE_CPI');
    const p = (await pm.post('/projects', base({ vendors: [{ vendorId: vendorA, cpi: 16, allowAboveCpi: true }] })).expect(201)).body;
    const c = p.countries[0];
    await pm.post(`/projects/${p.id}/countries/${c.id}/allocations`, { vendorId: vendorB, cpi: 90, targetCompletes: 10 }).expect(400);
    await pm.post(`/projects/${p.id}/countries/${c.id}/allocations`, { vendorId: vendorB, cpi: 5, targetCompletes: 10 }).expect(201);
    // Payouts stay editable, with the same check.
    const alloc = c.allocations[0];
    await pm.patch(`/projects/${p.id}/countries/${c.id}/allocations/${alloc.id}`, { cpi: 50 }).expect(400);
    const edited = (await pm.patch(`/projects/${p.id}/countries/${c.id}/allocations/${alloc.id}`, { cpi: 7.5, uidParam: 'rid', targetCompletes: 40 }).expect(200)).body;
    expect(edited).toMatchObject({ uidParam: 'rid', targetCompletes: 40 });
    expect(Number(edited.cpi)).toBe(7.5);
  });

  it('goes live in the markets that are ready and lists the others; a market alone cannot go live without a link', async () => {
    const p = (await pm.post('/projects', base({ vendors: [{ vendorId: vendorA, cpi: 5 }] })).expect(201)).body;
    const live = (await pm.patch(`/projects/${p.id}`, { status: 'LIVE' }).expect(200)).body;
    expect(live.status).toBe('LIVE');
    expect(live.launch.opened).toBe(1);
    expect(live.launch.notReady.map((n: { market: string }) => n.market).sort()).toEqual(['JP (ja) · Parents', 'US (en)']);
    const parents = live.countries.find((c: { targetGroup: string }) => c.targetGroup === 'Parents');
    expect(parents.status).toBe('DRAFT');
    expect(live.countries.find((c: { targetGroup: string }) => c.targetGroup === 'Gen Z').status).toBe('LIVE');

    const res = await pm.patch(`/projects/${p.id}/countries/${parents.id}`, { status: 'LIVE' }).expect(400);
    expect(res.body.code).toBe('NOT_READY');
    expect(res.body.message).toMatch(/no live survey link/);
    await pm.patch(`/projects/${p.id}/countries/${parents.id}`, { status: 'LIVE', liveSurveyUrl: LINK }).expect(200);
  });

  it('refuses to go live when no market has a live link', async () => {
    const p = (await pm.post('/projects', base({ countries: [{ countryCode: 'DE', language: 'de' }], vendors: [{ vendorId: vendorA, cpi: 5 }] })).expect(201)).body;
    const res = await pm.patch(`/projects/${p.id}`, { status: 'LIVE' }).expect(400);
    expect(res.body.issues.join(' ')).toMatch(/DE \(de\): no live survey link/);
  });

  it('adds a market after creation, copying settings and vendors from another market', async () => {
    const p = (await pm.post('/projects', base({ vendors: [{ vendorId: vendorA, cpi: 5 }] })).expect(201)).body;
    const genZ = p.countries.find((c: { targetGroup: string }) => c.targetGroup === 'Gen Z');
    await pm.post(`/projects/${p.id}/countries`, { countryCode: 'JP', language: 'ja', targetGroup: 'gen z', copyFromCountryId: genZ.id }).expect(400);
    const added = (await pm.post(`/projects/${p.id}/countries`, { countryCode: 'JP', language: 'ja', targetGroup: 'Seniors', targetCompletes: 50, copyFromCountryId: genZ.id, copyVendors: true }).expect(201)).body;
    expect(added).toMatchObject({ countryCode: 'JP', targetGroup: 'Seniors', loiMinutes: 12, irPercent: 40, currency: 'EUR', targetCompletes: 50 });
    const after = (await pm.get(`/projects/${p.id}`).expect(200)).body;
    expect(after.countries.find((c: { id: string }) => c.id === added.id).allocations).toHaveLength(1);
    await viewer.post(`/projects/${p.id}/countries`, { countryCode: 'FR', language: 'fr' }).expect(403);
  });

  it('applies values to many markets at once and reports the ones it could not change', async () => {
    const p = (await pm.post('/projects', base({ vendors: [{ vendorId: vendorA, cpi: 5 }] })).expect(201)).body;
    const ids = p.countries.map((c: { id: string }) => c.id);
    const r = (await pm.patch(`/projects/${p.id}/countries/bulk`, { countryIds: ids, set: { cpi: 18.5, loiMinutes: 20 } }).expect(200)).body;
    expect(r).toEqual({ updated: 3, failed: [] });
    const after = (await pm.get(`/projects/${p.id}`).expect(200)).body;
    expect(after.countries.every((c: { cpi: string; loiMinutes: number }) => Number(c.cpi) === 18.5 && c.loiMinutes === 20)).toBe(true);
    const s = (await pm.patch(`/projects/${p.id}/countries/bulk`, { countryIds: ids, set: { status: 'LIVE' } }).expect(200)).body;
    expect(s.updated).toBe(1);
    expect(s.failed).toHaveLength(2);
  });

  it('moves many projects between live and hold', async () => {
    const ready = (await pm.post('/projects', base({ vendors: [{ vendorId: vendorA, cpi: 5 }] })).expect(201)).body;
    const notReady = (await pm.post('/projects', base({ countries: [{ countryCode: 'DE', language: 'de' }] })).expect(201)).body;
    const r = (await pm.post('/projects/bulk-status', { ids: [ready.id, notReady.id], status: 'LIVE' }).expect(201)).body;
    expect(r.changed).toBe(1);
    expect(r.results.find((x: { id: string }) => x.id === notReady.id)).toMatchObject({ ok: false });
    const h = (await pm.post('/projects/bulk-status', { ids: [ready.id], status: 'HOLD' }).expect(201)).body;
    expect(h.changed).toBe(1);
    expect((await pm.get(`/projects/${ready.id}`).expect(200)).body.status).toBe('HOLD');
    await viewer.post('/projects/bulk-status', { ids: [ready.id], status: 'LIVE' }).expect(403);
  });

  it('clones a project as a new draft with markets, vendors (new links), quotas and redirects', async () => {
    const src = (await pm.post('/projects', base({ vendors: [{ vendorId: vendorA, cpi: 5 }] })).expect(201)).body;
    await pm.patch(`/projects/${src.id}`, { status: 'LIVE' }).expect(200);
    const copy = (await pm.post(`/projects/${src.id}/clone`, { name: 'Wave 2' }).expect(201)).body;
    expect(copy).toMatchObject({ name: 'Wave 2', status: 'DRAFT', category: 'B2C' });
    expect(copy.projectCode).not.toBe(src.projectCode);
    expect(copy.countries).toHaveLength(3);
    expect(copy.countries.every((c: { status: string; completes: number }) => c.status === 'DRAFT' && c.completes === 0)).toBe(true);
    const a0 = copy.countries[0].allocations[0];
    expect(a0.entryCode).not.toBe(src.countries[0].allocations[0].entryCode);
    expect(copy.countries.find((c: { targetGroup: string }) => c.targetGroup === 'Gen Z').liveSurveyUrl).toBe(LINK);
    expect(copy.activeRedirectVersion.version).toBe(1);
    const bare = (await pm.post(`/projects/${src.id}/clone`, { includeVendors: false, includeSurveyLinks: false }).expect(201)).body;
    expect(bare.name).toBe('Japan two audiences (copy)');
    expect(bare.countries.every((c: { allocations: unknown[]; liveSurveyUrl: string | null }) => !c.allocations.length && !c.liveSurveyUrl)).toBe(true);
  });

  it('keeps options people add to dropdowns', async () => {
    await pm.post('/custom-options', { field: 'category', value: 'Automotive' }).expect(201);
    await pm.post('/custom-options', { field: 'category', value: 'Automotive' }).expect(201);
    await pm.post('/custom-options', { field: 'nope', value: 'x' }).expect(400);
    await viewer.post('/custom-options', { field: 'category', value: 'Other' }).expect(403);
    expect((await viewer.get('/custom-options?field=category').expect(200)).body.map((o: { value: string }) => o.value)).toEqual(['Automotive']);
    const saved = (await pm.post('/custom-options/replace', { field: 'defaultVendor', values: [vendorA, vendorB] }).expect(201)).body;
    expect(saved).toHaveLength(2);
    const again = (await pm.post('/custom-options/replace', { field: 'defaultVendor', values: [vendorB] }).expect(201)).body;
    expect(again.map((o: { value: string }) => o.value)).toEqual([vendorB]);
  });
});
