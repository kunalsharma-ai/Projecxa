import { INestApplication } from '@nestjs/common';
import { PrismaClient, RespondentStatus, ApprovalStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { api, createApp, login, makeOrg, resetDb } from './helpers';
import { toolByName, ToolContext } from '../../src/ai/tools';
import { VendorScoringService } from '../../src/vendors/vendor-scoring';

const LINK = 'https://client.example.com/s?rid={session_token}';

describe('Vendor scoring, capacity and suggestions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let pm: ReturnType<typeof api>;
  let viewer: ReturnType<typeof api>;
  let other: ReturnType<typeof api>;
  let org: string;
  const v: Record<'good' | 'bad' | 'newbie' | 'covers', string> = { good: '', bad: '', newbie: '', covers: '' };
  let live: { id: string; countries: { id: string; countryCode: string }[] };

  /** Adds `n` sessions with one outcome to an allocation. */
  async function sessions(allocationId: string, n: number, status: RespondentStatus, approval: ApprovalStatus = 'NOT_APPLICABLE') {
    const a = await prisma.vendorAllocation.findUniqueOrThrow({ where: { id: allocationId }, include: { projectCountry: true } });
    await prisma.respondentSession.createMany({
      data: Array.from({ length: n }, () => ({
        organizationId: org,
        projectId: a.projectCountry.projectId,
        projectCountryId: a.projectCountryId,
        vendorAllocationId: a.id,
        token: randomBytes(12).toString('hex'),
        vendorRespondentId: randomBytes(6).toString('hex'),
        status,
        approval,
        startedAt: new Date(Date.now() - 5 * 86_400_000),
        expiresAt: new Date(Date.now() - 4 * 86_400_000),
      })),
    });
  }
  const project = async (name: string, countries: object[]) =>
    (await pm.post('/projects', { name, category: 'B2C', clientId: (await pm.post('/clients', { name, code: name.replace(/\W/g, '').slice(0, 8).toUpperCase() }).expect(201)).body.id, defaults: { language: 'en', loiMinutes: 10, irPercent: 50, liveSurveyUrl: LINK }, countries }).expect(201)).body;
  const allocate = async (projectId: string, countryId: string, vendorId: string, cpi: number, targetCompletes: number) =>
    (await pm.post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId, cpi, targetCompletes }).expect(201)).body.id as string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    const a = await makeOrg(prisma, 'vs');
    const b = await makeOrg(prisma, 'vs-other');
    org = a.org.id;
    pm = api(app, await login(app, a.users.PROJECT_MANAGER.email));
    viewer = api(app, await login(app, a.users.VIEWER.email));
    other = api(app, await login(app, b.users.ADMIN.email));
    for (const k of Object.keys(v) as (keyof typeof v)[]) v[k] = (await pm.post('/vendors', { name: `Vendor ${k}`, code: k.toUpperCase() }).expect(201)).body.id;

    // A finished project in the US with a good and a bad vendor.
    const done = await project('Done study', [{ countryCode: 'US', currency: 'USD', cpi: 5, targetCompletes: 80 }]);
    const us = done.countries[0].id;
    const good = await allocate(done.id, us, v.good, 2, 40);
    const bad = await allocate(done.id, us, v.bad, 2.5, 40);
    const newbie = await allocate(done.id, us, v.newbie, 3, 10);
    await sessions(good, 38, 'COMPLETE', 'APPROVED');
    await sessions(good, 2, 'COMPLETE', 'REJECTED');
    await sessions(good, 40, 'TERMINATE');
    await sessions(good, 10, 'QUOTA_FULL');
    await sessions(good, 4, 'QUALITY_FAIL');
    await sessions(good, 6, 'PARTIAL');
    await sessions(bad, 5, 'COMPLETE', 'APPROVED');
    await sessions(bad, 5, 'COMPLETE', 'REJECTED');
    await sessions(bad, 30, 'TERMINATE');
    await sessions(bad, 20, 'QUALITY_FAIL');
    await sessions(bad, 10, 'DUPLICATE');
    await sessions(bad, 30, 'STARTED'); // expired without an outcome: dropped
    await sessions(newbie, 5, 'TERMINATE');
    await prisma.vendorAllocation.update({ where: { id: good }, data: { completes: 40 } });
    await prisma.vendorAllocation.update({ where: { id: bad }, data: { completes: 10 } });
    await prisma.project.update({ where: { id: done.id }, data: { status: 'CLOSED' } });
    // Test traffic never counts.
    await sessions(good, 50, 'QUALITY_FAIL');
    await prisma.respondentSession.updateMany({ where: { vendorAllocationId: good, status: 'QUALITY_FAIL', id: { notIn: (await prisma.respondentSession.findMany({ where: { vendorAllocationId: good, status: 'QUALITY_FAIL' }, take: 4, orderBy: { id: 'asc' }, select: { id: true } })).map((x) => x.id) } }, data: { isTest: true } });

    // A live German project already takes most of the covering vendor's month.
    const busy = await project('Busy study', [{ countryCode: 'DE', currency: 'EUR', cpi: 6, targetCompletes: 450 }]);
    await allocate(busy.id, busy.countries[0].id, v.covers, 3, 450);
    await prisma.project.update({ where: { id: busy.id }, data: { status: 'LIVE' } });

    live = await project('New study', [{ countryCode: 'US', currency: 'USD', cpi: 2.2, targetCompletes: 100 }, { countryCode: 'DE', currency: 'EUR', cpi: 6, targetCompletes: 100 }]);
  });
  afterAll(async () => {
    await app.close();
  });

  it('scores vendors from their delivery history, and holds back a score until there is enough data', async () => {
    const r = (await viewer.get('/vendors/scores').expect(200)).body;
    expect(r).toMatchObject({ days: 180, minClicks: 30 });
    const by = Object.fromEntries(r.vendors.map((x: { code: string }) => [x.code, x]));
    expect(by.GOOD).toMatchObject({ score: 92, grade: 'A', parts: { quality: 84, acceptance: 95, delivery: 100, incidence: 100, engagement: 85 }, notes: ['No problems found'] });
    expect(by.GOOD.stats).toMatchObject({ clicks: 100, completes: 40, conversion: 40, qualityRate: 4, rejectionRate: 5, delivery: 100, projects: 1 });
    expect(by.BAD).toMatchObject({ grade: 'D', parts: { quality: 0, acceptance: 50, delivery: 25, incidence: 50, engagement: 25 } });
    expect(by.BAD.score).toBe(28);
    expect(by.BAD.notes).toEqual([
      '30% of clicks failed quality, duplicate or security checks',
      '50% of reconciled completes were rejected by clients',
      'Reached 25% of target on finished links',
      'Actual IR 25% against 50% expected',
      '30% of clicks dropped out',
    ]);
    expect(by.NEWBIE).toMatchObject({ score: null, grade: null, notes: ['Not enough data yet: 5 of 30 clicks needed'] });
    expect(by.COVERS).toMatchObject({ score: null, committed: 450 });
    expect((await other.get('/vendors/scores').expect(200)).body.vendors).toEqual([]);
    await viewer.get('/vendors/scores?days=3').expect(400);
  });

  it('keeps capacity per market and shows what live projects already use', async () => {
    await viewer.put(`/vendors/${v.covers}/capacity`, { rows: [] }).expect(403);
    await other.put(`/vendors/${v.covers}/capacity`, { rows: [] }).expect(404);
    await pm.put(`/vendors/${v.covers}/capacity`, { rows: [{ countryCode: 'DE' }, { countryCode: 'DE' }] }).expect(400);
    await pm.put(`/vendors/${v.covers}/capacity`, { rows: [{ countryCode: 'FR', completesPerMonth: 100 }] }).expect(200);
    const rows = (await pm.put(`/vendors/${v.covers}/capacity`, { rows: [{ countryCode: 'DE', completesPerDay: 20, completesPerMonth: 500, note: ' B2C only ' }, { countryCode: 'AT' }] }).expect(200)).body;
    expect(rows).toEqual([
      { countryCode: 'AT', completesPerDay: null, completesPerMonth: null, note: null },
      { countryCode: 'DE', completesPerDay: 20, completesPerMonth: 500, note: 'B2C only' },
    ]);
    const card = (await viewer.get(`/vendors/${v.covers}/scorecard`).expect(200)).body;
    expect(card.markets.map((m: { countryCode: string }) => m.countryCode)).toEqual(['AT', 'DE']);
    expect(card.markets[1]).toMatchObject({ committed: 450, headroom: 50, capacity: { completesPerMonth: 500 } });
    const good = (await viewer.get(`/vendors/${v.good}/scorecard?days=90`).expect(200)).body;
    expect(good).toMatchObject({ days: 90, score: 92, markets: [{ countryCode: 'US', score: 92, capacity: null }] });
    expect(good.links).toEqual([expect.objectContaining({ countryCode: 'US', cpi: 2, target: 40, completes: 40, finished: true, clicks: 100, qualityRate: 4, rejected: 2 })]);
    await other.get(`/vendors/${v.good}/scorecard`).expect(404);
  });

  it('suggests vendors for a market, best fit first, with the reasons and a CPI and target to start from', async () => {
    const us = live.countries.find((c) => c.countryCode === 'US')!;
    const r = (await viewer.get(`/projects/${live.id}/countries/${us.id}/vendor-suggestions`).expect(200)).body;
    expect(r).toMatchObject({ countryCode: 'US', currency: 'USD', clientCpi: 2.2, needed: 100, marketCpi: 2.5 });
    expect(r.suggestions.map((s: { code: string; fit: number }) => [s.code, s.fit])).toEqual([['GOOD', 100], ['NEWBIE', 35], ['BAD', 28], ['COVERS', 15]]);
    expect(r.suggestions[0]).toMatchObject({ grade: 'A', marketCompletes: 40, typicalCpi: 2, cpiSource: 'vendor', margin: 9.1, suggested: { cpi: 2, targetCompletes: 100 } });
    expect(r.suggestions[0].reasons.map((x: { text: string }) => x.text)).toEqual(['Score 92 (A) in US', 'Delivered 40 completes in US on 1 project']);
    const by = (code: string) => r.suggestions.find((x: { code: string }) => x.code === code);
    expect(by('BAD').reasons.map((x: { points: number }) => x.points)).toEqual([0, 15, -15]);
    expect(by('BAD').warnings).toHaveLength(5);
    // No history here, and the market's usual CPI (2.5) is above this client's 2.2.
    expect(by('COVERS').reasons.map((x: { text: string }) => x.text)).toEqual(['No score yet, counted as 50', 'No history or declared coverage in US', 'Typical CPI 2.5 USD leaves no margin on the client CPI 2.2']);
    expect(by('COVERS')).toMatchObject({ cpiSource: 'market', margin: -13.6 });
    expect(by('NEWBIE')).toMatchObject({ typicalCpi: 3, cpiSource: 'vendor' });

    // Once a vendor is on the market it is no longer suggested, and the target left shrinks.
    await pm.post(`/projects/${live.id}/countries/${us.id}/allocations`, { vendorId: v.good, cpi: 2, targetCompletes: 60 }).expect(201);
    const r2 = (await viewer.get(`/projects/${live.id}/countries/${us.id}/vendor-suggestions`).expect(200)).body;
    expect(r2.needed).toBe(40);
    expect(r2.suggestions.map((s: { code: string }) => s.code)).not.toContain('GOOD');

    const de = live.countries.find((c) => c.countryCode === 'DE')!;
    const d = (await viewer.get(`/projects/${live.id}/countries/${de.id}/vendor-suggestions`).expect(200)).body;
    expect(d.suggestions[0]).toMatchObject({ code: 'COVERS', fit: 40, committed: 450, headroom: 50, typicalCpi: 3, suggested: { cpi: 3, targetCompletes: 50 } });
    expect(d.suggestions[0].reasons.map((x: { text: string }) => x.text)).toEqual([
      'No score yet, counted as 50',
      'Covers DE (500 completes a month)',
      'Only 50 completes a month left after 450 owed on live projects',
    ]);
    await other.get(`/projects/${live.id}/countries/${de.id}/vendor-suggestions`).expect(404);
  });

  it('leaves inactive vendors out of the suggestions', async () => {
    await pm.patch(`/vendors/${v.newbie}`, { status: 'INACTIVE' }).expect(200);
    const us = live.countries.find((c) => c.countryCode === 'US')!;
    const r = (await pm.get(`/projects/${live.id}/countries/${us.id}/vendor-suggestions`).expect(200)).body;
    expect(r.suggestions.map((s: { code: string }) => s.code)).toEqual(['BAD', 'COVERS']);
    // Fully allocated: a 10% backup target is suggested. (Its payout is above the 2.20 client CPI, so it is confirmed on purpose.)
    await pm.post(`/projects/${live.id}/countries/${us.id}/allocations`, { vendorId: v.bad, cpi: 2.5, targetCompletes: 40, allowAboveCpi: true }).expect(201);
    const full = (await pm.get(`/projects/${live.id}/countries/${us.id}/vendor-suggestions`).expect(200)).body;
    expect(full.needed).toBe(0);
    expect(full.suggestions).toEqual([expect.objectContaining({ code: 'COVERS', suggested: { cpi: 2.5, targetCompletes: 10 } })]);
  });

  it('answers the copilot with vendor scores, overall or for one market', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { organizationId: org, role: 'VIEWER' } });
    const ctx = { u: { ...user, organizationId: org }, prisma, vendorScoring: app.get(VendorScoringService), now: new Date() } as unknown as ToolContext;
    const out = await toolByName.get('vendor_scores')!.run(ctx, { countryCode: 'us' });
    const data = out.data as { market: string; vendors: { vendor: string; grade: string | null; score: number | null }[] };
    expect(data.market).toBe('US');
    expect(data.vendors.map((x) => [x.vendor, x.grade])).toEqual([['Vendor good (GOOD)', 'A'], ['Vendor bad (BAD)', 'D']]);
    expect(out.display![0]).toMatchObject({ type: 'table', title: 'Vendor scores in US, last 180 days' });
  });
});
