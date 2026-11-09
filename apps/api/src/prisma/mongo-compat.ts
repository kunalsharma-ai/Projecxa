/**
 * Small helpers for what PostgreSQL did in one statement and MongoDB (through Prisma) does not:
 * `createMany({ skipDuplicates })` (INSERT ... ON CONFLICT DO NOTHING) and lease claims
 * (UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)).
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';

/** A collision-free id in the same shape as Prisma's cuid() (25 characters, starting with c). */
export const newId = () => `c${randomBytes(12).toString('hex')}`;

type Row = Record<string, unknown>;
// The model delegates differ per model; these helpers only use the methods every delegate has.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Delegate = {
  findMany(args: any): Promise<any[]>;
  createMany(args: any): Promise<{ count: number }>;
  create(args: any): Promise<unknown>;
  updateMany(args: any): Promise<{ count: number }>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const uniqueSets = new Map<string, string[][]>();

/** The unique keys of a model (single-field `@unique` and `@@unique`), not counting the id. */
export function uniqueKeys(model: string): string[][] {
  let sets = uniqueSets.get(model);
  if (!sets) {
    const m = Prisma.dmmf.datamodel.models.find((x) => x.name === model);
    if (!m) throw new Error(`Unknown model ${model}`);
    sets = [...m.fields.filter((f) => f.isUnique && !f.isId).map((f) => [f.name]), ...m.uniqueFields.map((u) => [...u])];
    uniqueSets.set(model, sets);
  }
  return sets;
}

const isDuplicate = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Insert the rows that do not clash with an existing row (or an earlier row in the list) on any
 * unique key, like PostgreSQL's `createMany({ skipDuplicates: true })`. A key with a missing or
 * null field never clashes, as in PostgreSQL. Returns how many rows were inserted.
 *
 * Inside a transaction the existing rows are read first, so no insert fails. Outside one, a row
 * another request inserted in the meantime is skipped as well.
 */
export async function createManySkipDuplicates(delegate: Delegate, model: string, rows: Row[]): Promise<{ count: number }> {
  if (rows.length === 0) return { count: 0 };
  const keys = uniqueKeys(model);
  const keyOf = (r: Row, k: string[]) => (k.some((f) => r[f] === null || r[f] === undefined) ? null : JSON.stringify(k.map((f) => r[f])));
  const seen = keys.map(() => new Set<string>());
  let count = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const filters = keys.flatMap((k) => chunk.filter((r) => keyOf(r, k) !== null).map((r) => Object.fromEntries(k.map((f) => [f, r[f]]))));
    if (filters.length) {
      const select = Object.fromEntries(keys.flat().map((f) => [f, true]));
      for (const e of await delegate.findMany({ where: { OR: filters }, select }))
        keys.forEach((k, j) => {
          const key = keyOf(e as Row, k);
          if (key !== null) seen[j]!.add(key);
        });
    }
    const fresh: Row[] = [];
    for (const r of chunk) {
      const ks = keys.map((k) => keyOf(r, k));
      if (ks.some((key, j) => key !== null && seen[j]!.has(key))) continue;
      ks.forEach((key, j) => key !== null && seen[j]!.add(key));
      fresh.push({ ...r });
    }
    if (!fresh.length) continue;
    // Ids are set here so that after a clash we can tell which rows this call inserted.
    const idField = Prisma.dmmf.datamodel.models.find((x) => x.name === model)!.fields.find((f) => f.isId)!.name;
    for (const r of fresh) if (r[idField] === undefined) r[idField] = newId();
    try {
      count += (await delegate.createMany({ data: fresh })).count;
    } catch (e) {
      if (!isDuplicate(e)) throw e;
      // Someone else inserted a clashing row meanwhile. createMany is ordered, so the rows before
      // the clash are in: count them, then insert the rest one by one and skip the clashes.
      const ids = fresh.map((r) => r[idField]);
      const inserted = new Set(
        ((await delegate.findMany({ where: { [idField]: { in: ids } }, select: { [idField]: true } })) as Row[]).map((x) => x[idField]),
      );
      count += inserted.size;
      for (const r of fresh) {
        if (inserted.has(r[idField])) continue;
        try {
          await delegate.create({ data: r });
          count++;
        } catch (err) {
          if (!isDuplicate(err)) throw err;
        }
      }
    }
  }
  return { count };
}

/**
 * Claim up to `limit` documents that match `where`, by setting `data` on them, so that two
 * workers never claim the same one: each candidate is updated only if it still matches `where`.
 * Returns the ids claimed. This replaces UPDATE ... FOR UPDATE SKIP LOCKED.
 */
export async function claim(
  delegate: Delegate,
  where: Row,
  orderBy: Row | Row[],
  limit: number,
  data: Row | ((id: string) => Row),
): Promise<string[]> {
  const claimed: string[] = [];
  const tried: string[] = [];
  // A candidate another worker took first is skipped and the next one tried, as SKIP LOCKED did.
  for (let round = 0; round < 10 && claimed.length < limit; round++) {
    const candidates = (await delegate.findMany({
      where: tried.length ? { AND: [where, { id: { notIn: tried } }] } : where,
      orderBy,
      take: limit - claimed.length,
      select: { id: true },
    })) as { id: string }[];
    if (!candidates.length) break;
    for (const { id } of candidates) {
      tried.push(id);
      const r = await delegate.updateMany({ where: { AND: [where, { id }] }, data: typeof data === 'function' ? data(id) : data });
      if (r.count === 1) claimed.push(id);
    }
  }
  return claimed;
}

/**
 * Ids of the documents matching a plain MongoDB filter, for what Prisma cannot filter on MongoDB:
 * paths inside JSON fields (PostgreSQL's `{ field: { path, equals } }`). Use the result as
 * `{ id: { in: ids } }`, and keep the filter narrow (organization, project), as it reads every match.
 * A path like `answers.gate.Q1.value` with a value matches equal values and arrays that contain it.
 */
export async function idsMatching(
  delegate: { findRaw(args: { filter?: Prisma.InputJsonObject; options?: Prisma.InputJsonObject }): PromiseLike<Prisma.JsonObject> },
  filter: Prisma.InputJsonObject,
): Promise<string[]> {
  const docs = (await delegate.findRaw({ filter, options: { projection: { _id: 1 } } })) as unknown as { _id: string | { $oid: string } }[];
  return docs.map((d) => (typeof d._id === 'string' ? d._id : d._id.$oid));
}
