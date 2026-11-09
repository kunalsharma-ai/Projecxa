/**
 * PostgreSQL row semantics on MongoDB (the same layer as SampCode's packages/db/src/compat.ts).
 *
 * On PostgreSQL every row has every column, so an optional field nobody set is NULL, and the code
 * finds such rows with `{ field: null }` (for example `deletedAt: null`). Prisma's MongoDB
 * connector leaves an unset optional field out of the document, and `{ field: null }` does not match
 * a missing field. So every create through this client writes `null` for the optional fields it was
 * not given (in nested creates as well), and `{ field: null }` keeps meaning "not set".
 *
 * The connector also compares with aggregation expressions, where null is lower than every value:
 * `{ field: { lt: x } }` matches rows whose field is null, and so does `{ field: { not: x } }`.
 * PostgreSQL leaves NULL out of every comparison (it is neither below x nor different from it).
 * So every filter through this client is rewritten to leave out null for those comparisons, and
 * for any comparison under NOT, as PostgreSQL did.
 *
 * Two more PostgreSQL features are kept here: money columns were NUMERIC with a fixed scale and are
 * now numbers, rounded to that scale on every write (MONEY_SCALES); and `ChatMessage.seq` was an
 * autoincrement column, now taken from the `counters` collection (nextSequence).
 */
import { Prisma } from '@prisma/client';

type Data = Record<string, unknown>;
interface ModelInfo {
  /** Optional scalar fields without a default: name, whether it is a JSON field. */
  optional: { name: string }[];
  /** Relation field name to the related model and its foreign key fields. */
  relations: Map<string, { model: string; fks: string[]; refs: string[] }>;
  /** Optional scalar fields that can hold null (not JSON, not lists). */
  nullable: Set<string>;
}

let models: Map<string, ModelInfo> | undefined;

function info(model: string): ModelInfo | undefined {
  if (!models) {
    models = new Map();
    for (const m of Prisma.dmmf.datamodel.models) {
      const relations = new Map<string, { model: string; fks: string[]; refs: string[] }>();
      for (const f of m.fields) if (f.kind === 'object') relations.set(f.name, { model: f.type, fks: [...(f.relationFromFields ?? [])], refs: [...(f.relationToFields ?? [])] });
      models.set(m.name, {
        optional: m.fields
          .filter((f) => (f.kind === 'scalar' || f.kind === 'enum') && !f.isRequired && !f.isList && !f.hasDefaultValue && !f.isId)
          .map((f) => ({ name: f.name })),
        relations,
        nullable: new Set(
          m.fields
            .filter((f) => (f.kind === 'scalar' || f.kind === 'enum') && !f.isRequired && !f.isList && f.type !== 'Json')
            .map((f) => f.name),
        ),
      });
    }
  }
  return models.get(model);
}

/** Fill unset optional fields of one create input with null, and of the creates nested in it. */
export function withNulls(model: string, data: unknown): unknown {
  if (Array.isArray(data)) return data.map((d) => withNulls(model, d));
  if (!data || typeof data !== 'object') return data;
  const m = info(model);
  if (!m) return data;
  const out: Data = uncheck(m, { ...(data as Data) });
  // A create that names a relation it holds the foreign key of (connect, create) is a "checked"
  // input: it may not set the foreign key fields themselves, so those are left to Prisma. Nested
  // creates of child rows (events: { create }) are allowed in both kinds.
  const checked = Object.keys(out).some((k) => (m.relations.get(k)?.fks.length ?? 0) > 0);
  const fks = new Set([...m.relations.values()].flatMap((r) => r.fks));
  for (const f of m.optional) {
    if (out[f.name] !== undefined) continue;
    if (checked && fks.has(f.name)) continue;
    out[f.name] = null;
  }
  for (const [name, rel] of m.relations) {
    const nested = out[name];
    if (nested && typeof nested === 'object') out[name] = withNestedNulls(rel.model, nested as Data);
  }
  return roundMoney(model, out);
}

/**
 * `{ project: { connect: { id } } }` → `{ projectId: id }` when every relation the create names is
 * such a connect, so the input is "unchecked" and its other foreign keys can be written as null.
 */
function uncheck(m: ModelInfo, out: Data): Data {
  const named = Object.keys(out).filter((k) => (m.relations.get(k)?.fks.length ?? 0) > 0);
  if (!named.length) return out;
  const plan: [string, string, unknown][] = [];
  for (const k of named) {
    const rel = m.relations.get(k)!;
    const v = out[k] as Data | undefined;
    const c = v && typeof v === 'object' && Object.keys(v).length === 1 ? (v.connect as Data | undefined) : undefined;
    if (rel.fks.length !== 1 || !c || typeof c !== 'object' || Array.isArray(c)) return out;
    const keys = Object.keys(c);
    if (keys.length !== 1 || keys[0] !== rel.refs[0] || typeof c[keys[0]!] !== 'string') return out;
    plan.push([k, rel.fks[0]!, c[keys[0]!]]);
  }
  for (const [k, fk, value] of plan) {
    delete out[k];
    out[fk] = value;
  }
  return out;
}

function withNestedNulls(model: string, w: Data): Data {
  const out = { ...w };
  if (out.create !== undefined) out.create = withNulls(model, out.create);
  if (out.createMany && typeof out.createMany === 'object') {
    const cm = out.createMany as Data;
    out.createMany = { ...cm, data: withNulls(model, cm.data) };
  }
  const coc = out.connectOrCreate;
  if (coc !== undefined)
    out.connectOrCreate = (Array.isArray(coc) ? coc : [coc]).map((c: Data) => ({ ...c, create: withNulls(model, c.create) }));
  if (!Array.isArray(coc) && coc !== undefined) out.connectOrCreate = (out.connectOrCreate as Data[])[0];
  const up = out.upsert;
  if (up !== undefined) {
    const list = (Array.isArray(up) ? up : [up]).map((u: Data) => ({
      ...u,
      create: withNulls(model, u.create),
      update: u.update && typeof u.update === 'object' ? withUpdateNulls(model, u.update as Data) : u.update,
    }));
    out.upsert = Array.isArray(up) ? list : list[0];
  }
  if (out.update !== undefined) {
    const list = (Array.isArray(out.update) ? out.update : [out.update]).map((u: Data) =>
      u && typeof u === 'object' && 'data' in u ? { ...u, data: withUpdateNulls(model, u.data as Data) } : withUpdateNulls(model, u),
    );
    out.update = Array.isArray(w.update) ? list : list[0];
  }
  return out;
}

/** Nested creates inside an update's data. */
function withUpdateNulls(model: string, data: Data): Data {
  const m = info(model);
  if (!m || !data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const [name, rel] of m.relations) {
    const nested = out[name];
    if (nested && typeof nested === 'object') out[name] = withNestedNulls(rel.model, nested as Data);
  }
  return roundMoney(model, out) as Data;
}

// ---- Filters --------------------------------------------------------------------------------------

const isPlain = (v: unknown): v is Data =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && Object.getPrototypeOf(v) === Object.prototype;
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

/** Whether a scalar filter compares in a way that, in PostgreSQL, leaves out NULL. */
function needsGuard(filter: unknown, negated: boolean): boolean {
  if (filter === null) return false; // `field: null` itself
  if (!isPlain(filter)) return negated; // `field: value`: only under NOT does null slip in
  for (const [op, v] of Object.entries(filter)) {
    if (op === 'mode') continue;
    if (op === 'lt' || op === 'lte' || op === 'notIn') return true;
    if (op === 'not') {
      if (v === null) continue;
      return true;
    }
    if (op === 'equals' && v === null) continue;
    if (negated) return true;
  }
  return false;
}

/** The nullable fields that a where compares directly (through AND, OR and NOT, not relations). */
function comparedFields(m: ModelInfo, w: unknown, out = new Set<string>()): Set<string> {
  for (const c of asList(w)) {
    if (!isPlain(c)) continue;
    for (const [k, v] of Object.entries(c)) {
      if (k === 'AND' || k === 'OR' || k === 'NOT') comparedFields(m, v, out);
      else if (m.nullable.has(k) && v !== null && !(isPlain(v) && (v.equals === null || v.not === null) && Object.keys(v).length === 1))
        out.add(k);
    }
  }
  return out;
}

/** Rewrite a where so that null takes part in comparisons as it did in PostgreSQL. */
export function fixWhere(model: string, where: unknown): unknown {
  const m = info(model);
  if (!m || !isPlain(where)) return where;
  const out: Data = {};
  const guards: Data[] = [];
  for (const [k, v] of Object.entries(where)) {
    if (k === 'AND' || k === 'OR') {
      out[k] = Array.isArray(v) ? v.map((c) => fixWhere(model, c)) : fixWhere(model, v);
    } else if (k === 'NOT') {
      // NOT (null < x) is not true in PostgreSQL either: rows with null in a compared field stay out.
      out[k] = Array.isArray(v) ? v.map((c) => fixWhere(model, c)) : fixWhere(model, v);
      for (const f of comparedFields(m, v)) guards.push({ [f]: { not: null } });
    } else if (m.relations.has(k)) {
      const rel = m.relations.get(k)!;
      if (isPlain(v)) {
        const r: Data = {};
        for (const [op, inner] of Object.entries(v))
          r[op] = ['some', 'every', 'none', 'is', 'isNot'].includes(op) ? fixWhere(rel.model, inner) : inner;
        // A to-one relation filtered directly, without is/isNot.
        out[k] = Object.keys(v).some((op) => ['some', 'every', 'none', 'is', 'isNot'].includes(op)) ? r : fixWhere(rel.model, v);
      } else out[k] = v;
    } else {
      out[k] = v;
      if (m.nullable.has(k) && needsGuard(v, false)) guards.push({ [k]: { not: null } });
    }
  }
  if (guards.length) out.AND = [...asList(out.AND), ...guards];
  return out;
}

/** Fix the where of a query and of the relations it includes, selects or counts. */
export function fixArgs(model: string, args: unknown): unknown {
  if (!isPlain(args)) return args;
  const m = info(model);
  if (!m) return args;
  const out: Data = { ...args };
  if (out.where !== undefined) out.where = fixWhere(model, out.where);
  for (const key of ['include', 'select'] as const) {
    const sel = out[key];
    if (!isPlain(sel)) continue;
    const next: Data = {};
    for (const [k, v] of Object.entries(sel)) {
      const rel = m.relations.get(k);
      if (rel && isPlain(v)) next[k] = fixArgs(rel.model, v);
      else if (k === '_count' && isPlain(v) && isPlain(v.select)) {
        const counted: Data = {};
        for (const [ck, cv] of Object.entries(v.select)) {
          const r = m.relations.get(ck);
          counted[ck] = r && isPlain(cv) ? fixArgs(r.model, cv) : cv;
        }
        next[k] = { ...v, select: counted };
      } else next[k] = v;
    }
    out[key] = next;
  }
  return out;
}

// ---- Money and sequences -------------------------------------------------------------------------

/** Former NUMERIC(p, s) columns: model → field → decimal places kept. */
export const MONEY_SCALES: Record<string, Record<string, number>> = { Organization: { invoiceTaxPercent: 2, billTaxPercent: 2 }, Plan: { priceMonthly: 2, priceYearly: 2 }, BillingInvoice: { amount: 2, taxPercent: 2, taxAmount: 2, total: 2 }, ProjectCountry: { cpi: 2 }, VendorAllocation: { cpi: 2 }, RespondentSession: { revenue: 2, payout: 2 }, WonBid: { totalAmount: 4 }, Invoice: { subtotal: 2, taxPercent: 2, taxAmount: 2, total: 2 }, VendorBill: { subtotal: 2, taxPercent: 2, taxAmount: 2, total: 2 }, ExchangeRate: { rate: 8 }, QuoteRequest: { cpi: 2 } };

const roundTo = (v: unknown, places: number) => {
  if (v === null || v === undefined) return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  // As NUMERIC did with the number's decimal text: half away from zero (3.015 → 3.02, -2.5 → -3).
  const abs = Math.abs(n);
  const text = String(abs);
  const r = text.includes('e') ? Math.round(abs * 10 ** places) / 10 ** places : Number(`${Math.round(Number(`${text}e${places}`))}e-${places}`);
  return n < 0 ? -r : r;
};

function roundMoney(model: string, data: unknown): unknown {
  const scales = MONEY_SCALES[model];
  if (!scales) return data;
  if (Array.isArray(data)) return data.map((d) => roundMoney(model, d));
  if (!isPlain(data)) return data;
  const out: Data = { ...data };
  for (const [field, places] of Object.entries(scales)) {
    const v = out[field];
    if (v === undefined) continue;
    if (isPlain(v)) {
      const ops: Data = { ...v };
      for (const op of ['set', 'increment', 'decrement', 'multiply', 'divide']) if (op in ops) ops[op] = roundTo(ops[op], places);
      out[field] = ops;
    } else out[field] = roundTo(v, places);
  }
  return out;
}

/** Former autoincrement columns: model → field, filled from the counters collection. */
export const AUTOINCREMENT: Record<string, string> = { ChatMessage: 'seq' };

interface RawRunner {
  $runCommandRaw(cmd: Record<string, unknown>): Promise<unknown>;
}

/** The next value of a named sequence (like PostgreSQL's nextval). Starts at 1. */
export async function nextSequence(client: RawRunner, name: string, count = 1): Promise<number> {
  const r = (await client.$runCommandRaw({
    findAndModify: 'counters',
    query: { _id: name },
    update: { $inc: { value: count } },
    upsert: true,
    new: true,
  })) as { value: { value: number | { $numberLong: string } } };
  const v = r.value.value;
  return (typeof v === 'number' ? v : Number(v.$numberLong)) - count + 1;
}

/** Set a sequence so that the next value is `next` (like PostgreSQL's setval(name, next - 1)). */
export async function setSequence(client: RawRunner, name: string, current: number) {
  await client.$runCommandRaw({ update: 'counters', updates: [{ q: { _id: name }, u: { $set: { value: current } }, upsert: true }] });
}

async function fillSequence(client: RawRunner, model: string, data: unknown): Promise<unknown> {
  const field = AUTOINCREMENT[model];
  if (!field) return data;
  const rows = Array.isArray(data) ? data : [data];
  const missing = rows.filter((r) => isPlain(r) && r[field] === undefined) as Data[];
  if (!missing.length) return data;
  let next = await nextSequence(client, `${model}.${field}`, missing.length);
  const filled = rows.map((r) => (isPlain(r) && r[field] === undefined ? { ...r, [field]: next++ } : r));
  return Array.isArray(data) ? filled : filled[0];
}

type Extendable = {
  $extends(ext: {
    query: { $allModels: { $allOperations(p: { model: string; operation: string; args: Data; query: (args: Data) => Promise<unknown> }): Promise<unknown> } };
  }): unknown;
};

/** Rewrites one operation's arguments with the PostgreSQL rules above. */
async function fixOperation(raw: RawRunner, model: string, operation: string, args: Data): Promise<Data> {
  if (!args) return args;
  const a = fixArgs(model, args) as Data;
  switch (operation) {
    case 'create':
    case 'createMany':
    case 'createManyAndReturn':
      return { ...a, data: await fillSequence(raw, model, withNulls(model, a.data)) };
    case 'upsert':
      return { ...a, create: await fillSequence(raw, model, withNulls(model, a.create)), update: withUpdateNulls(model, a.update as Data) };
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
      return { ...a, data: withUpdateNulls(model, a.data as Data) };
    default:
      return a;
  }
}

/**
 * The client with the null-filling and comparison guards applied to every model operation,
 * including inside transactions. Returns the extended client (Prisma 6.14+ has no $use).
 */
export function withMongoCompat<T>(client: T): T {
  return (client as unknown as Extendable).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(await fixOperation(client as unknown as RawRunner, model, operation, args));
        },
      },
    },
  }) as T;
}
