/**
 * Moving a PostgreSQL database into MongoDB (src/prisma/pg-import.ts, docs/POSTGRES_TO_MONGODB.md).
 * The rows come from an in-memory source shaped like the PostgreSQL tables (the driver's values: NUMERIC
 * and BIGINT as text, BYTEA as Buffer, timestamps as Date). The documents are then read back with the
 * app's own Prisma client. Uses its own *_test database and drops it after.
 */
import { Prisma } from '@prisma/client';
import { MongoClient, type Db } from 'mongodb';
import { PrismaClient } from '../../src/prisma/client';
import { syncIndexes } from '../../src/prisma/indexes';
import { canonical, importPlan, importPostgres, keyId, parsePgArray, verified, verifyImport, type ImportSource, type Row, type TableInfo } from '../../src/prisma/pg-import';
import { pgConfig, redactUrl, utcTimestamp } from '../../src/prisma/pg-source';

const base = new URL(process.env.DATABASE_URL!);
base.pathname = '/projexa_pgimport_test';
const URL_ = base.toString();

const plan = new Map(importPlan().map((p) => [p.model, p]));
const T0 = new Date('2026-03-04T05:06:07.089Z');

/** A value of the driver's shape for a required field the test does not care about. */
function filler(model: string, field: string, i: number): unknown {
  const f = plan.get(model)!.fields.find((x) => x.name === field)!;
  if (f.isList) return [];
  if (f.kind === 'enum') return Prisma.dmmf.datamodel.enums.find((e) => e.name === f.type)!.values[0].name;
  switch (f.type) {
    case 'Int':
      return i;
    case 'Float':
      return 0;
    case 'Boolean':
      return false;
    case 'DateTime':
      return T0;
    case 'Json':
      return {};
    case 'Bytes':
      return Buffer.from([]);
    default:
      return `${model}-${field}-${i}`;
  }
}

class FakeSource implements ImportSource {
  readonly data = new Map<string, { info: TableInfo; rows: Row[] }>();
  seqs: Record<string, number> = {};

  table(model: string, rows: Row[], opts: { drop?: string[]; pk?: string[]; extra?: string[] } = {}) {
    const p = plan.get(model)!;
    const columns = new Map<string, { type: string; isEnum: boolean; isArray: boolean }>();
    for (const f of p.fields) if (!opts.drop?.includes(f.name)) columns.set(f.name, { type: f.type, isEnum: f.kind === 'enum', isArray: f.isList });
    for (const c of opts.extra ?? []) columns.set(c, { type: 'text', isEnum: false, isArray: false });
    const full = rows.map((r, i) => {
      const row: Row = {};
      for (const f of p.fields) {
        if (!columns.has(f.name)) continue;
        if (f.name in r) row[f.name] = r[f.name];
        else if (f.isRequired && f.default === undefined && !f.isUpdatedAt) row[f.name] = filler(model, f.name, i);
        else if (f.isList) row[f.name] = [];
        else if (f.default !== undefined && typeof f.default !== 'object') row[f.name] = f.default;
        else if (f.isUpdatedAt || (f.default as { name?: string })?.name === 'now') row[f.name] = T0;
        else row[f.name] = null;
      }
      for (const c of opts.extra ?? []) row[c] = r[c] ?? null;
      return row;
    });
    this.data.set(p.table, { info: { columns, primaryKey: opts.pk ?? ['id'] }, rows: full });
  }

  async tables() {
    return new Map([...this.data].map(([k, v]) => [k, v.info]));
  }
  async rows(table: string, info: TableInfo, columns: string[], after: unknown[] | null, limit: number) {
    const key = (r: Row) => info.primaryKey.map((k) => String(r[k])).join('\u0000');
    const sorted = [...this.data.get(table)!.rows].sort((a, b) => (key(a) < key(b) ? -1 : 1));
    const from = after ? sorted.filter((r) => key(r) > after.map(String).join('\u0000')) : sorted;
    return from.slice(0, limit).map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])));
  }
  async count(table: string) {
    return this.data.get(table)!.rows.length;
  }
  async sequence(name: string) {
    return this.seqs[name] ?? null;
  }
  async lastMigration() {
    return '20261111090100_plan_limits';
  }
}

function sample(): FakeSource {
  const s = new FakeSource();
  // An older database: no featureAccess / platformOwner / updatedAt columns, and one column since removed.
  s.table(
    'Organization',
    [
      { id: 'org1', name: 'Acme', slug: 'acme', invoiceTaxPercent: '18.00', redirectAllowedDomains: ['a.com', 'b.com'], branding: { appName: 'X', nested: [1, null, 'ü'] }, createdAt: T0, oldColumn: 'gone' },
      { id: 'org2', name: 'Beta', slug: 'beta', invoiceTaxPercent: '0.00', createdAt: T0 },
    ],
    { drop: ['featureAccess', 'platformOwner', 'updatedAt'], extra: ['oldColumn'] },
  );
  s.table('Plan', [{ id: 'plan1', code: 'pro', name: 'Pro', priceMonthly: '4999.50', priceYearly: null, features: ['chat', 'ai'] }]);
  s.table('Backup', [{ id: 'bk1', name: 'b-1', trigger: 'manual', status: 'ok', target: 'local', sizeBytes: '9007199254740993' }]);
  s.table('SharedFile', [{ id: 'f1', organizationId: 'org1', name: 'brief.pdf', contentType: 'application/pdf', size: 5, sha256: 'x', data: Buffer.from([0, 1, 2, 255, 7]) }]);
  s.table('ChatChannel', [{ id: 'ch1', organizationId: 'org1' }]);
  s.table('ChatMember', [{ channelId: 'ch1', userId: 'u1', readSeq: 4 }, { channelId: 'ch1', userId: 'u2' }], { drop: ['id'], pk: ['channelId', 'userId'] });
  s.table('ChatMessage', [{ id: 'm1', organizationId: 'org1', channelId: 'ch1', authorId: 'u1', body: 'hi', seq: 41 }, { id: 'm2', organizationId: 'org1', channelId: 'ch1', authorId: 'u2', body: 'yo', seq: 42 }]);
  s.table('IpReputationRange', [{ id: 'r1', source: 'x4b-vpn', category: 'vpn', range: '203.0.113.0/24' }, { id: 'r2', source: 'firehol', category: 'abuse', range: '2001:db8::/32' }], { drop: ['rangeStart', 'rangeEnd'] });
  s.seqs = { ChatMessage_seq_seq: 42, billing_invoice_seq: 17 };
  return s;
}

describe('PostgreSQL → MongoDB import', () => {
  let mongo: MongoClient;
  let db: Db;
  let prisma: PrismaClient;

  beforeAll(async () => {
    mongo = await MongoClient.connect(URL_);
    db = mongo.db();
    await db.dropDatabase();
    prisma = new PrismaClient({ datasources: { db: { url: URL_ } } });
    await syncIndexes(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await db.dropDatabase();
    await mongo.close();
  });

  it('does nothing in a dry run', async () => {
    const r = await importPostgres(sample(), db, { dryRun: true });
    expect(r.models.find((m) => m.model === 'Organization')).toMatchObject({ source: 2, written: 2, droppedColumns: ['oldColumn'] });
    expect(await db.collection('Organization').countDocuments()).toBe(0);
    expect(await db.collection('counters').countDocuments()).toBe(0);
  });

  it('copies every table with ids, types and defaults the app reads back', async () => {
    const src = sample();
    const r = await importPostgres(src, db, { batchSize: 1 });
    expect(r.models.find((m) => m.model === 'Organization')!.defaulted.sort()).toEqual(['featureAccess', 'platformOwner', 'updatedAt']);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: 'org1' } });
    expect(org).toMatchObject({ slug: 'acme', invoiceTaxPercent: 18, redirectAllowedDomains: ['a.com', 'b.com'], branding: { appName: 'X', nested: [1, null, 'ü'] }, platformOwner: false, featureAccess: null, createdAt: T0, updatedAt: T0, status: 'ACTIVE' });
    expect((await db.collection('Organization').findOne({ _id: 'org1' as never }))!).not.toHaveProperty('oldColumn');
    // A NULL column is a null field (as the app writes them), so { field: null } filters find it.
    expect(await prisma.organization.count({ where: { fallbackRedirectUrl: null } })).toBe(2);

    expect(await prisma.plan.findUniqueOrThrow({ where: { id: 'plan1' } })).toMatchObject({ priceMonthly: 4999.5, priceYearly: null, features: ['chat', 'ai'] });
    expect((await prisma.backup.findUniqueOrThrow({ where: { id: 'bk1' } })).sizeBytes).toBe(9007199254740993n);
    expect(Buffer.from((await prisma.sharedFile.findUniqueOrThrow({ where: { id: 'f1' } })).data)).toEqual(Buffer.from([0, 1, 2, 255, 7]));

    const members = await prisma.chatMember.findMany({ orderBy: { userId: 'asc' } });
    expect(members.map((m) => [m.id, m.userId, m.readSeq])).toEqual([
      [keyId('ChatMember', ['ch1', 'u1']), 'u1', 4],
      [keyId('ChatMember', ['ch1', 'u2']), 'u2', 0],
    ]);

    const ranges = await prisma.ipReputationRange.findMany({ orderBy: { id: 'asc' } });
    expect(ranges.map((x) => [x.rangeStart, x.rangeEnd])).toEqual([
      ['00000000000000000000ffffcb007100', '00000000000000000000ffffcb0071ff'],
      ['20010db8000000000000000000000000', '20010db8ffffffffffffffffffffffff'],
    ]);

    // Sequences carry on from PostgreSQL.
    expect(await db.collection('counters').find().sort({ _id: 1 }).toArray()).toEqual([
      { _id: 'ChatMessage.seq', value: 42 },
      { _id: 'billing_invoice_seq', value: 17 },
    ]);
    const next = await prisma.chatMessage.create({ data: { organizationId: 'org1', channelId: 'ch1', authorId: 'u1', body: 'new' } as never });
    expect(next.seq).toBe(43);
    await prisma.chatMessage.delete({ where: { id: next.id } });

    expect(verified(await verifyImport(src, db))).toBe(true);
  });

  it('can run again: records are updated in place, never doubled, counters never go back', async () => {
    const src = sample();
    src.data.get('Organization')!.rows[1].name = 'Beta renamed';
    src.seqs = { ChatMessage_seq_seq: 42, billing_invoice_seq: 3 };
    await importPostgres(src, db);
    expect(await db.collection('Organization').countDocuments()).toBe(2);
    expect(await db.collection('ChatMember').countDocuments()).toBe(2);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: 'org2' } })).name).toBe('Beta renamed');
    expect((await db.collection('counters').findOne({ _id: 'billing_invoice_seq' as never }))!.value).toBe(17);
    expect(verified(await verifyImport(src, db))).toBe(true);
  });

  it('verify finds changed, missing and extra records', async () => {
    const src = sample();
    await importPostgres(src, db);
    await db.collection('Plan').updateOne({ _id: 'plan1' as never }, { $set: { name: 'Changed' } });
    await db.collection('Backup').deleteOne({ _id: 'bk1' as never });
    await db.collection('ChatChannel').insertOne({ _id: 'ch-extra' as never, organizationId: 'org1' });
    const r = await verifyImport(src, db);
    expect(verified(r)).toBe(false);
    const by = (m: string) => r.models.find((x) => x.model === m)!;
    expect(by('Plan')).toMatchObject({ different: 1, matched: 0 });
    expect(by('Backup')).toMatchObject({ missing: 1 });
    expect(by('ChatChannel')).toMatchObject({ extra: 1, matched: 1 });
    // Running the import again repairs what it copied; the extra document stays (it is reported).
    await importPostgres(src, db);
    const again = await verifyImport(src, db);
    expect(again.models.filter((m) => m.missing || m.different)).toEqual([]);
    await db.collection('ChatChannel').deleteOne({ _id: 'ch-extra' as never });
    expect(verified(await verifyImport(src, db))).toBe(true);
  });

  it('stops on a required column the old database does not have', async () => {
    const src = new FakeSource();
    src.table('Plan', [{ id: 'p', code: 'c' }], { drop: ['name'] });
    await expect(importPostgres(src, db, { dryRun: true })).rejects.toThrow(/Plan has no "name" column/);
  });
});

describe('PostgreSQL values', () => {
  it('reads array text, including quotes and commas', () => {
    expect(parsePgArray('{}')).toEqual([]);
    expect(parsePgArray('{A,B}')).toEqual(['A', 'B']);
    expect(parsePgArray('{"a,b","c \\"d\\"",""}')).toEqual(['a,b', 'c "d"', '']);
  });

  it('reads timestamps as UTC whatever the server time zone', () => {
    expect(utcTimestamp('2026-03-04 05:06:07.089').toISOString()).toBe('2026-03-04T05:06:07.089Z');
    expect(utcTimestamp('2026-03-04 05:06:07').toISOString()).toBe('2026-03-04T05:06:07.000Z');
  });

  it('takes the schema out of a Prisma URL and hides passwords', () => {
    expect(pgConfig('postgresql://u:p@h:5432/db?schema=app&sslmode=require')).toEqual({ connectionString: 'postgresql://u:p@h:5432/db?sslmode=require', schema: 'app' });
    expect(pgConfig('postgresql://u:p@h/db').schema).toBe('public');
    expect(redactUrl('postgresql://u:secret@h/db')).toBe('postgresql://u:***@h/db');
  });

  it('compares documents whatever the key order', () => {
    expect(canonical({ b: 1, a: [new Date(0), null] })).toBe(canonical({ a: [new Date(0), undefined], b: 1 }));
  });
});
