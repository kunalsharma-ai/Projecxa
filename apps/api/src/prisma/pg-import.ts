/**
 * Moving a SampTrek database from PostgreSQL (the versions before MongoDB) into MongoDB
 * (docs/POSTGRES_TO_MONGODB.md). The command line is prisma/import-postgres.ts.
 *
 * The plan comes from the Prisma schema: PostgreSQL had one table per model and one column per field,
 * with the same names, so every model is read from its table and written to its collection, with the
 * id as `_id`. Ids are kept as they were, so every relation (organizationId, projectId, ...) still
 * points at the same record. Files are `Bytes` fields in the database, so they move with it.
 *
 * - Each document is written with `replaceOne(..., { upsert: true })` by its id: running the import
 *   again brings the same documents back to what PostgreSQL holds and adds nothing twice.
 * - NUMERIC money becomes a number at the same scale, BIGINT a 64-bit integer, BYTEA binary data,
 *   timestamps the same instant (PostgreSQL stored them in UTC without a zone).
 * - Optional fields that were NULL are written as null, as the app writes them (compat.ts).
 * - A column the old database does not have yet (a server that skipped updates) gets the field's
 *   default; a required field without a default stops the import of that table with a clear error.
 * - `ChatMember` had a two-column primary key and now has an id: it is made from the key, so it is
 *   the same on every run. `IpReputationRange` gets `rangeStart`/`rangeEnd` from its `inet` range.
 * - The `ChatMessage.seq` and invoice number sequences go to the `counters` collection.
 */
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { Binary, Double, Long, type AnyBulkWriteOperation, type Db, type Document } from 'mongodb';
import { cidrBounds } from '../survey/ip-reputation';
import { AUTOINCREMENT } from './compat';

export type Row = Record<string, unknown>;

/** What a source table looks like: its columns (with their PostgreSQL type) and primary key. */
export interface ColumnInfo {
  /** PostgreSQL type name, e.g. text, int4, numeric, timestamp, jsonb, _text, inet, or the enum's name. */
  type: string;
  /** Enum type, or an array of an enum type. */
  isEnum: boolean;
  isArray: boolean;
}
export interface TableInfo {
  columns: Map<string, ColumnInfo>;
  primaryKey: string[];
}

/** Where the rows come from. PgSource reads a PostgreSQL database; tests use an in-memory one. */
export interface ImportSource {
  tables(): Promise<Map<string, TableInfo>>;
  /** Rows in primary key order, after the given key (exclusive), at most `limit`. */
  rows(table: string, info: TableInfo, columns: string[], after: unknown[] | null, limit: number): Promise<Row[]>;
  count(table: string): Promise<number>;
  /** Current value of a sequence (the last number handed out), or null when it was never used. */
  sequence(name: string): Promise<number | null>;
  /** Name of the last applied migration, when known. */
  lastMigration(): Promise<string | null>;
}

interface FieldPlan {
  name: string;
  /** Name in the MongoDB document. */
  target: string;
  type: string;
  kind: 'scalar' | 'enum';
  isList: boolean;
  isRequired: boolean;
  isId: boolean;
  isUpdatedAt: boolean;
  default?: unknown;
}

export interface ModelPlan {
  model: string;
  table: string;
  collection: string;
  fields: FieldPlan[];
}

/** The last migration of the PostgreSQL versions. A database at it has every column the import reads. */
export const LAST_POSTGRES_MIGRATION = '20261111090100_plan_limits';

/** Models that are new in the MongoDB version: there is no table to read. */
const NEW_MODELS = new Set(['LimitAlert']);

/** Fields that did not exist as columns and are worked out from the row. */
const DERIVED: Record<string, Record<string, (row: Row) => unknown>> = {
  IpReputationRange: {
    rangeStart: (r) => cidrBounds(String(r.range ?? ''))?.start ?? null,
    rangeEnd: (r) => cidrBounds(String(r.range ?? ''))?.end ?? null,
  },
};

/** Sequences moved to the counters collection: counter name → PostgreSQL sequence (and the column it fed). */
export const SEQUENCES: { counter: string; sequence: string; max?: { model: string; field: string } }[] = [
  ...Object.entries(AUTOINCREMENT).map(([model, field]) => ({ counter: `${model}.${field}`, sequence: `${model}_${field}_seq`, max: { model, field } })),
  { counter: 'billing_invoice_seq', sequence: 'billing_invoice_seq' },
];

export function importPlan(): ModelPlan[] {
  return Prisma.dmmf.datamodel.models.map((m) => ({
    model: m.name,
    table: m.dbName ?? m.name,
    collection: m.dbName ?? m.name,
    fields: m.fields
      .filter((f) => f.kind === 'scalar' || f.kind === 'enum')
      .map((f) => ({
        name: f.name,
        target: f.isId ? '_id' : (f.dbName ?? f.name),
        type: f.type,
        kind: f.kind as 'scalar' | 'enum',
        isList: f.isList,
        isRequired: f.isRequired,
        isId: f.isId,
        isUpdatedAt: !!f.isUpdatedAt,
        default: f.default,
      })),
  }));
}

export class ImportError extends Error {}

/** A stable id from the old composite primary key (ChatMember), so every run makes the same one. */
export function keyId(model: string, key: unknown[]): string {
  return `m${createHash('sha256').update(`${model}\u0000${key.map(String).join('\u0000')}`).digest('hex').slice(0, 24)}`;
}

function fieldDefault(f: FieldPlan, row: Row): unknown {
  const d = f.default as { name?: string } | unknown;
  if (f.isUpdatedAt) return row.createdAt instanceof Date ? row.createdAt : new Date();
  if (d === undefined) return f.isList ? [] : null;
  if (d && typeof d === 'object' && !Array.isArray(d) && 'name' in (d as object)) {
    const name = (d as { name: string }).name;
    if (name === 'now') return row.createdAt instanceof Date ? row.createdAt : new Date();
    return undefined; // cuid(), uuid(), autoincrement(): nothing sensible to invent
  }
  if (f.type === 'Json' && typeof d === 'string') {
    try {
      return JSON.parse(d);
    } catch {
      return d;
    }
  }
  return d;
}

/** PostgreSQL array text ({a,b,"c d"}), for arrays the driver hands over as text. */
export function parsePgArray(text: string): string[] {
  const s = text.trim();
  if (s === '{}' || s === '') return [];
  const inner = s.replace(/^\{/, '').replace(/\}$/, '');
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quoted) {
      if (c === '\\') cur += inner[++i] ?? '';
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
      wasQuoted = false;
    } else cur += c;
  }
  if (cur !== '' || wasQuoted || inner.endsWith(',')) out.push(cur);
  return out;
}

function scalar(f: FieldPlan, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (f.type) {
    case 'Int':
      return Number(v);
    case 'Float':
      return new Double(Number(v));
    case 'BigInt':
      return Long.fromString(String(v));
    case 'Boolean':
      return typeof v === 'string' ? v === 't' || v === 'true' : Boolean(v);
    case 'DateTime':
      return v instanceof Date ? v : new Date(String(v));
    case 'Bytes':
      return new Binary(Buffer.isBuffer(v) ? v : Buffer.from(v as Uint8Array));
    case 'Json':
      return v;
    default:
      return v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : String(v);
  }
}

function value(f: FieldPlan, v: unknown): unknown {
  if (!f.isList) return scalar(f, v);
  if (v === null || v === undefined) return [];
  const list = typeof v === 'string' ? parsePgArray(v) : (v as unknown[]);
  return list.map((x) => scalar(f, x));
}

/**
 * One PostgreSQL row as the MongoDB document the app would have written. `columns` are the columns the
 * source table has; fields without one get their default. Throws ImportError when a required field has
 * neither.
 */
export function convertRow(plan: ModelPlan, row: Row, columns: Set<string>, primaryKey: string[]): Document {
  const doc: Document = {};
  const derived = DERIVED[plan.model] ?? {};
  for (const f of plan.fields) {
    let v: unknown;
    if (columns.has(f.name)) v = row[f.name];
    else if (derived[f.name]) v = derived[f.name](row);
    else if (f.isId) v = keyId(plan.model, primaryKey.map((k) => row[k]));
    else {
      v = fieldDefault(f, row);
      if (v === undefined || (v === null && f.isRequired))
        throw new ImportError(`${plan.table} has no "${f.name}" column. Update the old server to the last PostgreSQL version first (docs/POSTGRES_TO_MONGODB.md).`);
    }
    if (v === null && f.isRequired && !f.isList) throw new ImportError(`${plan.table}: "${f.name}" is empty in a row (${primaryKey.map((k) => row[k]).join(', ')}).`);
    doc[f.target] = value(f, v);
  }
  return doc;
}

export interface ModelReport {
  model: string;
  /** Rows in PostgreSQL (null: no table there). */
  source: number | null;
  written: number;
  /** Filled by verify. */
  matched?: number;
  missing?: number;
  different?: number;
  /** Documents in MongoDB that are not in PostgreSQL. */
  extra?: number;
  /** Columns in PostgreSQL that the MongoDB version no longer has (not copied). */
  droppedColumns: string[];
  /** Fields the old table had no column for (filled with their default). */
  defaulted: string[];
  examples?: string[];
}

export interface ImportReport {
  dryRun: boolean;
  lastMigration: string | null;
  models: ModelReport[];
  counters: Record<string, number>;
  /** Tables in PostgreSQL the MongoDB version has no model for. */
  unknownTables: string[];
}

export interface ImportOptions {
  dryRun?: boolean;
  batchSize?: number;
  /** Only these models (by name), e.g. for a test. */
  only?: string[];
  log?: (line: string) => void;
}

function columnsFor(plan: ModelPlan, info: TableInfo): { read: string[]; dropped: string[]; defaulted: string[] } {
  const fieldNames = new Set(plan.fields.map((f) => f.name));
  const read = [...info.columns.keys()].filter((c) => fieldNames.has(c) || (DERIVED[plan.model] && c === 'range'));
  for (const k of info.primaryKey) if (!read.includes(k)) read.push(k);
  const dropped = [...info.columns.keys()].filter((c) => !fieldNames.has(c));
  const defaulted = plan.fields.filter((f) => !info.columns.has(f.name) && !DERIVED[plan.model]?.[f.name] && !f.isId).map((f) => f.name);
  return { read, dropped, defaulted };
}

const IGNORED_TABLES = new Set(['_prisma_migrations']);

async function plans(source: ImportSource, only?: string[]) {
  const tables = await source.tables();
  const all = importPlan().filter((p) => !only || only.includes(p.model));
  const known = new Set(importPlan().map((p) => p.table));
  const unknownTables = only ? [] : [...tables.keys()].filter((t) => !known.has(t) && !IGNORED_TABLES.has(t)).sort();
  return { tables, all, unknownTables };
}

async function* batches(source: ImportSource, plan: ModelPlan, info: TableInfo, read: string[], size: number) {
  let after: unknown[] | null = null;
  for (;;) {
    const rows = await source.rows(plan.table, info, read, after, size);
    if (!rows.length) return;
    yield rows;
    if (rows.length < size) return;
    const last = rows[rows.length - 1];
    after = info.primaryKey.map((k) => last[k]);
  }
}

/** Copy every table into MongoDB (or, with dryRun, read and convert everything and write nothing). */
export async function importPostgres(source: ImportSource, db: Db, opts: ImportOptions = {}): Promise<ImportReport> {
  const size = opts.batchSize ?? 1000;
  const log = opts.log ?? (() => undefined);
  const { tables, all, unknownTables } = await plans(source, opts.only);
  const report: ImportReport = { dryRun: !!opts.dryRun, lastMigration: await source.lastMigration(), models: [], counters: {}, unknownTables };
  const maxima: Record<string, number> = {};

  for (const plan of all) {
    const info = tables.get(plan.table);
    if (!info) {
      report.models.push({ model: plan.model, source: null, written: 0, droppedColumns: [], defaulted: [] });
      if (!NEW_MODELS.has(plan.model)) log(`${plan.model}: no table in PostgreSQL, nothing to copy`);
      continue;
    }
    const { read, dropped, defaulted } = columnsFor(plan, info);
    const columns = new Set(info.columns.keys());
    const r: ModelReport = { model: plan.model, source: await source.count(plan.table), written: 0, droppedColumns: dropped, defaulted };
    const seqField = AUTOINCREMENT[plan.model];
    for await (const rows of batches(source, plan, info, read, size)) {
      const docs = rows.map((row) => convertRow(plan, row, columns, info.primaryKey));
      if (seqField) for (const d of docs) maxima[plan.model] = Math.max(maxima[plan.model] ?? 0, Number(d[seqField] ?? 0));
      if (!opts.dryRun) {
        const ops: AnyBulkWriteOperation[] = docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } }));
        await db.collection(plan.collection).bulkWrite(ops, { ordered: false });
      }
      r.written += docs.length;
    }
    report.models.push(r);
    log(`${plan.model}: ${r.written} of ${r.source}${opts.dryRun ? ' read (dry run)' : ' copied'}${defaulted.length ? `; defaults for ${defaulted.join(', ')}` : ''}`);
  }

  for (const s of SEQUENCES) {
    const seq = await source.sequence(s.sequence);
    const value = Math.max(seq ?? 0, s.max ? (maxima[s.max.model] ?? 0) : 0);
    if (!value) continue;
    report.counters[s.counter] = value;
    // $max: a counter that already moved on (the app ran on MongoDB) is never set back.
    if (!opts.dryRun) await db.collection<{ _id: string; value: number }>('counters').updateOne({ _id: s.counter }, { $max: { value } }, { upsert: true });
  }
  return report;
}

/** A document as comparable text: keys sorted, numbers, dates and binary data written out. */
export function canonical(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (x === null || x === undefined) return null;
    if (x instanceof Double) return x.valueOf();
    if (x instanceof Long) return `long:${x.toString()}`;
    if (typeof x === 'bigint') return `long:${x.toString()}`;
    if (x instanceof Binary) return `bin:${Buffer.from(x.buffer.subarray(0, x.position)).toString('base64')}`;
    if (Buffer.isBuffer(x)) return `bin:${x.toString('base64')}`;
    if (x instanceof Date) return `date:${x.toISOString()}`;
    if (Array.isArray(x)) return x.map(norm);
    if (typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (o._bsontype === 'Int32' || o._bsontype === 'Double') return Number((o as { value: number }).value);
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, norm(o[k])]));
    }
    return x;
  };
  return JSON.stringify(norm(v));
}

/**
 * Compare MongoDB with PostgreSQL: every row converted again and compared with its document, and the
 * documents in MongoDB that PostgreSQL does not have counted. Run it straight after the import, before
 * the app writes anything.
 */
export async function verifyImport(source: ImportSource, db: Db, opts: ImportOptions = {}): Promise<ImportReport> {
  const size = opts.batchSize ?? 1000;
  const log = opts.log ?? (() => undefined);
  const { tables, all, unknownTables } = await plans(source, opts.only);
  const report: ImportReport = { dryRun: true, lastMigration: await source.lastMigration(), models: [], counters: {}, unknownTables };
  for (const plan of all) {
    const info = tables.get(plan.table);
    const total = await db.collection(plan.collection).countDocuments({});
    if (!info) {
      report.models.push({ model: plan.model, source: null, written: 0, matched: 0, missing: 0, different: 0, extra: NEW_MODELS.has(plan.model) ? 0 : total, droppedColumns: [], defaulted: [] });
      continue;
    }
    const { read, dropped, defaulted } = columnsFor(plan, info);
    const columns = new Set(info.columns.keys());
    const r: ModelReport = { model: plan.model, source: await source.count(plan.table), written: 0, matched: 0, missing: 0, different: 0, extra: 0, droppedColumns: dropped, defaulted, examples: [] };
    for await (const rows of batches(source, plan, info, read, size)) {
      const docs = rows.map((row) => convertRow(plan, row, columns, info.primaryKey));
      const found = await db.collection(plan.collection).find({ _id: { $in: docs.map((d) => d._id) } }, { promoteValues: false }).toArray();
      const byId = new Map(found.map((d) => [String(d._id), d]));
      for (const d of docs) {
        const t = byId.get(String(d._id));
        if (!t) {
          r.missing!++;
          if (r.examples!.length < 5) r.examples!.push(`missing ${String(d._id)}`);
        } else if (canonical(t) !== canonical(d)) {
          r.different!++;
          if (r.examples!.length < 5) r.examples!.push(`different ${String(d._id)}`);
        } else r.matched!++;
      }
    }
    r.extra = total - r.matched! - r.different!;
    report.models.push(r);
    const ok = r.matched === r.source && r.extra === 0;
    log(`${ok ? 'OK  ' : 'DIFF'} ${plan.model}: PostgreSQL ${r.source}, MongoDB ${total} (matched ${r.matched}, missing ${r.missing}, different ${r.different}, extra ${r.extra})`);
  }
  return report;
}

/** Everything matched: same number of records and every one equal. */
export function verified(report: ImportReport): boolean {
  return report.models.every((m) => (m.source === null ? (m.extra ?? 0) === 0 : m.matched === m.source && !m.missing && !m.different && !m.extra));
}
