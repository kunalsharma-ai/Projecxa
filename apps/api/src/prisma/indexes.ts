/**
 * MongoDB collections and indexes, read from prisma/schema.prisma (this replaces the SQL migrations).
 *
 * `prisma db push` is not used: MongoDB counts a missing or null value as a value in a unique index,
 * so an optional `@unique` field (or an `@@unique` with an optional field) would allow only one row
 * without it, where PostgreSQL allowed any number. Those indexes are created here as partial
 * indexes that only cover rows where every optional field is set, which keeps the PostgreSQL rule.
 *
 * Running it again is a no-op: creating an index that already exists with the same keys and options
 * does nothing, and so does creating a collection that exists.
 *   pnpm db:deploy   (also pnpm db:migrate in development; the tests run it in test/global-setup.ts)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from './client';

interface Field {
  name: string;
  type: string;
  optional: boolean;
}
export interface IndexSpec {
  collection: string;
  name: string;
  key: Record<string, 1 | -1>;
  unique: boolean;
  partialFilterExpression?: Record<string, unknown>;
}

const BSON: Record<string, string> = {
  String: 'string',
  Int: 'int',
  BigInt: 'long',
  Float: 'double',
  Boolean: 'bool',
  DateTime: 'date',
};

const SCALARS = new Set([...Object.keys(BSON), 'Json', 'Bytes', 'Decimal']);

/** Every index the schema declares (`@unique`, `@@unique`, `@@index`), per collection. */
export function indexesFromSchema(schema: string): IndexSpec[] {
  const enums = new Set([...schema.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((m) => m[1]!));
  const out: IndexSpec[] = [];
  for (const m of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const collection = m[1]!;
    const fields = new Map<string, Field>();
    const body = m[2]!
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter(Boolean);
    for (const line of body) {
      if (line.startsWith('@@')) continue;
      const f = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
      if (!f) continue;
      const [, name, type, list, opt, attrs] = f;
      if (!SCALARS.has(type!) && !enums.has(type!)) continue; // a relation field
      if (list) continue;
      fields.set(name!, { name: name!, type: enums.has(type!) ? 'String' : type!, optional: !!opt });
      if (/@unique\b/.test(attrs!) && !/@id\b/.test(attrs!)) out.push(spec(collection, [name!], true, fields));
    }
    for (const line of body) {
      const u = /^@@(unique|index)\(\s*\[([^\]]*)\]/.exec(line);
      if (!u) continue;
      const cols = u[2]!
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      out.push(spec(collection, cols, u[1] === 'unique', fields));
    }
  }
  return out;
}

function spec(collection: string, cols: string[], unique: boolean, fields: Map<string, Field>): IndexSpec {
  const key: Record<string, 1 | -1> = {};
  const partial: Record<string, unknown> = {};
  for (const c of cols) {
    const name = /^(\w+)/.exec(c)![1]!;
    key[name] = /sort:\s*Desc/.test(c) ? -1 : 1;
    const f = fields.get(name);
    if (!f) throw new Error(`Index on ${collection}.${name}: no such field`);
    if (unique && f.optional && BSON[f.type]) partial[name] = { $type: BSON[f.type] };
  }
  return {
    collection,
    name: `${collection}_${Object.keys(key).join('_')}_${unique ? 'key' : 'idx'}`,
    key,
    unique,
    ...(Object.keys(partial).length ? { partialFilterExpression: partial } : {}),
  };
}

export function schemaIndexes(): IndexSpec[] {
  return indexesFromSchema(readFileSync(join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8'));
}

/**
 * The database's schema version, kept in the `_schema` collection and in every backup's manifest.
 * Raise it (same YYYYMMDDHHMMSS_name form, so versions sort as text) when a change needs data to be
 * moved, not just new fields or indexes.
 */
export const SCHEMA_VERSION = '20261112000000_mongodb';

/** Create every collection and index the schema declares. Returns how many indexes it asked for. */
export async function syncIndexes(prisma: PrismaClient): Promise<number> {
  const schema = readFileSync(join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8');
  const collections = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!);
  const listed = (await prisma.$runCommandRaw({ listCollections: 1, nameOnly: true })) as {
    cursor: { firstBatch: { name: string }[] };
  };
  const existing = new Set(listed.cursor.firstBatch.map((c) => c.name));
  // Collections must exist before a multi-document transaction first writes to them on older servers.
  for (const c of collections) {
    if (existing.has(c)) continue;
    try {
      await prisma.$runCommandRaw({ create: c });
    } catch (e) {
      if (!/already exists|NamespaceExists/.test(String((e as Error).message))) throw e;
    }
  }
  const specs = indexesFromSchema(schema);
  const byCollection = new Map<string, IndexSpec[]>();
  for (const s of specs) byCollection.set(s.collection, [...(byCollection.get(s.collection) ?? []), s]);
  for (const [collection, list] of byCollection) {
    await prisma.$runCommandRaw({
      createIndexes: collection,
      indexes: list.map(({ name, key, unique, partialFilterExpression }) => ({
        name,
        key,
        ...(unique ? { unique: true } : {}),
        ...(partialFilterExpression ? { partialFilterExpression } : {}),
      })),
    } as never);
  }
  await prisma.$runCommandRaw({ update: '_schema', updates: [{ q: { _id: 'version' }, u: { _id: 'version', version: SCHEMA_VERSION }, upsert: true }] });
  return specs.length;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  syncIndexes(prisma)
    .then(async (n) => {
      process.stdout.write(`MongoDB collections and ${n} indexes are in place\n`);
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
