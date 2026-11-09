/**
 * What row locks, ON CONFLICT, sequences, NUMERIC and NULL comparisons guaranteed on PostgreSQL,
 * checked on MongoDB (docs/MONGODB.md): parallel completes never pass a target, parallel claims
 * never hand one client link to two sessions, duplicate-skipping inserts stay idempotent under races,
 * sequences never repeat, money keeps its scale, and filters treat null as PostgreSQL did.
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { nextSequence } from '../../src/prisma/compat';
import { claim, createManySkipDuplicates } from '../../src/prisma/mongo-compat';

const run = Date.now().toString(36);
let prisma: PrismaService;

beforeAll(async () => {
  prisma = new PrismaService();
  await prisma.onModuleInit();
});
afterAll(async () => {
  await prisma.onModuleDestroy();
});

async function market(target: number) {
  return prisma.projectCountry.create({
    data: { projectId: `p-${run}-${target}`, countryCode: 'US', language: 'en', loiMinutes: 10, irPercent: 50, cpi: 2.5, targetCompletes: target },
  });
}

describe('MongoDB in place of PostgreSQL', () => {
  it('parallel completes on a target of 3 take exactly 3 places, as the row lock did', async () => {
    const c = await market(3);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        prisma.$transaction(async (tx) => {
          const n = (await tx.projectCountry.updateMany({ where: { id: c.id, completes: { lt: tx.projectCountry.fields.targetCompletes } }, data: { completes: { increment: 1 } } })).count;
          return n === 1;
        }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await prisma.projectCountry.findUniqueOrThrow({ where: { id: c.id } })).completes).toBe(3);
  });

  it('parallel claims never hand the same client link to two sessions (FOR UPDATE SKIP LOCKED)', async () => {
    const projectCountryId = `pc-${run}-links`;
    await prisma.clientUniqueLink.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({ organizationId: `o-${run}`, projectId: `p-${run}`, projectCountryId, url: `https://client.example.com/s?id=${i}`, seq: i })),
    });
    const claimed = (
      await Promise.all(
        Array.from({ length: 16 }, (_, i) => claim(prisma.clientUniqueLink, { projectCountryId, status: 'UNUSED' }, { seq: 'asc' }, 1, { status: 'ASSIGNED', sessionId: `s-${run}-${i}`, assignedAt: new Date() })),
      )
    ).flat();
    expect(claimed).toHaveLength(12);
    expect(new Set(claimed).size).toBe(12);
    const links = await prisma.clientUniqueLink.findMany({ where: { projectCountryId } });
    expect(new Set(links.map((l) => l.sessionId)).size).toBe(12);
  });

  it('duplicate-skipping inserts count each row once, even when run in parallel (ON CONFLICT DO NOTHING)', async () => {
    const organizationId = `o-${run}-fx`;
    const rows = ['EUR', 'GBP', 'INR', 'EUR'].map((currency) => ({ organizationId, currency, rate: 1.1 }));
    const counts = await Promise.all(Array.from({ length: 4 }, () => createManySkipDuplicates(prisma.exchangeRate, 'ExchangeRate', rows)));
    expect(counts.reduce((n, c) => n + c.count, 0)).toBe(3);
    expect(await prisma.exchangeRate.count({ where: { organizationId } })).toBe(3);
    expect((await createManySkipDuplicates(prisma.exchangeRate, 'ExchangeRate', rows)).count).toBe(0);
  });

  it('never gives one sequence number twice', async () => {
    const name = `test-${run}`;
    const got = await Promise.all(Array.from({ length: 25 }, () => nextSequence(prisma, name)));
    expect(new Set(got).size).toBe(25);
    expect(Math.min(...got)).toBe(1);
    expect(Math.max(...got)).toBe(25);
  });

  it('rounds money to the scale of its old NUMERIC column', async () => {
    const r = await prisma.exchangeRate.create({ data: { organizationId: `o-${run}-round`, currency: 'JPY', rate: 0.006543219876 } });
    expect(r.rate).toBe(0.00654322);
    const c = await prisma.projectCountry.update({ where: { id: (await market(1)).id }, data: { cpi: 3.015 } });
    expect(c.cpi).toBe(3.02);
    const d = await prisma.projectCountry.update({ where: { id: c.id }, data: { cpi: -2.345 } });
    expect(d.cpi).toBe(-2.35);
  });

  it('leaves null out of comparisons and finds unset fields with null, as PostgreSQL did', async () => {
    const projectCountryId = `pc-${run}-null`;
    const base = { organizationId: `o-${run}`, projectId: `p-${run}`, projectCountryId };
    await prisma.clientUniqueLink.create({ data: { ...base, url: 'https://x.example.com/1', seq: 1, assignedAt: new Date('2026-01-01T00:00:00Z') } });
    await prisma.clientUniqueLink.create({ data: { ...base, url: 'https://x.example.com/2', seq: 2 } });
    const cut = new Date('2026-06-01T00:00:00Z');
    expect(await prisma.clientUniqueLink.count({ where: { projectCountryId, assignedAt: { lt: cut } } })).toBe(1);
    expect(await prisma.clientUniqueLink.count({ where: { projectCountryId, assignedAt: { not: cut } } })).toBe(1);
    expect(await prisma.clientUniqueLink.count({ where: { projectCountryId, NOT: { assignedAt: { gte: cut } } } })).toBe(1);
    expect(await prisma.clientUniqueLink.count({ where: { projectCountryId, assignedAt: null } })).toBe(1);
    // An optional unique field (sessionId) can be empty on any number of links.
    expect(await prisma.clientUniqueLink.count({ where: { projectCountryId, sessionId: null } })).toBe(2);
  });
});
