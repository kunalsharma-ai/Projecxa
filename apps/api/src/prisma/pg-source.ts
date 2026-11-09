/**
 * Reads an old SampTrek PostgreSQL database for the import (pg-import.ts). Read-only: it only runs
 * SELECT statements, so the old database stays exactly as it was.
 */
import { Client, types } from 'pg';
import type { ImportSource, Row, TableInfo } from './pg-import';

const TIMESTAMP = 1114; // timestamp without time zone: Prisma wrote UTC
const TEXT_TYPES = new Set(['inet', 'cidr', 'macaddr', 'uuid', 'citext', 'tsvector', 'xml', 'money']);

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Parse a Prisma timestamp(3) as UTC, whatever the server's time zone is. */
export function utcTimestamp(text: string): Date {
  if (text === 'infinity' || text === '-infinity') return new Date(text === 'infinity' ? 8.64e15 : -8.64e15);
  return new Date(`${text.replace(' ', 'T')}Z`);
}

/** Connection settings from a Prisma PostgreSQL URL (its ?schema= becomes the search path). */
export function pgConfig(url: string) {
  const u = new URL(url);
  const schema = u.searchParams.get('schema') ?? 'public';
  u.searchParams.delete('schema');
  return { connectionString: u.toString(), schema };
}

/** The URL without its password, for messages. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(invalid URL)';
  }
}

export class PgSource implements ImportSource {
  private constructor(private readonly client: Client, private readonly schema: string) {}

  static async connect(url: string): Promise<PgSource> {
    const { connectionString, schema } = pgConfig(url);
    const client = new Client({
      connectionString,
      types: { getTypeParser: ((oid: number, format?: 'text' | 'binary') => (oid === TIMESTAMP ? utcTimestamp : types.getTypeParser(oid, format))) as typeof types.getTypeParser },
    });
    await client.connect();
    // Read everything from one consistent snapshot, and never write.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return new PgSource(client, schema);
  }

  async close() {
    await this.client.query('ROLLBACK').catch(() => undefined);
    await this.client.end();
  }

  async tables(): Promise<Map<string, TableInfo>> {
    const cols = await this.client.query<{ table: string; column: string; type: string; typtype: string; category: string; elemtype: string | null }>(
      `SELECT c.relname AS table, a.attname AS column, t.typname AS type, t.typtype, t.typcategory AS category, et.typtype AS elemtype
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
         JOIN pg_type t ON t.oid = a.atttypid
         LEFT JOIN pg_type et ON et.oid = t.typelem AND t.typcategory = 'A'
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
        ORDER BY c.relname, a.attnum`,
      [this.schema],
    );
    const pks = await this.client.query<{ table: string; column: string }>(
      `SELECT c.relname AS table, a.attname AS column
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, pos) ON true
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
        WHERE n.nspname = $1 AND i.indisprimary
        ORDER BY c.relname, k.pos`,
      [this.schema],
    );
    const out = new Map<string, TableInfo>();
    for (const r of cols.rows) {
      const t = out.get(r.table) ?? { columns: new Map(), primaryKey: [] };
      const isArray = r.category === 'A';
      t.columns.set(r.column, { type: r.type, isArray, isEnum: isArray ? r.elemtype === 'e' : r.typtype === 'e' });
      out.set(r.table, t);
    }
    for (const r of pks.rows) out.get(r.table)?.primaryKey.push(r.column);
    for (const t of out.values()) if (!t.primaryKey.length) t.primaryKey.push(...t.columns.keys());
    return out;
  }

  async rows(table: string, info: TableInfo, columns: string[], after: unknown[] | null, limit: number): Promise<Row[]> {
    const select = columns.map((c) => {
      const col = info.columns.get(c);
      if (col?.isArray && (col.isEnum || TEXT_TYPES.has(col.type.slice(1)))) return `${q(c)}::text[] AS ${q(c)}`;
      if (col && !col.isArray && TEXT_TYPES.has(col.type)) return `${q(c)}::text AS ${q(c)}`;
      return q(c);
    });
    const key = info.primaryKey.map(q).join(', ');
    const params: unknown[] = after ?? [];
    const where = after ? `WHERE (${key}) > (${after.map((_, i) => `$${i + 1}`).join(', ')})` : '';
    const sql = `SELECT ${select.join(', ')} FROM ${q(this.schema)}.${q(table)} ${where} ORDER BY ${key} LIMIT ${Math.max(1, Math.floor(limit))}`;
    return (await this.client.query<Row>(sql, params)).rows;
  }

  async count(table: string): Promise<number> {
    const r = await this.client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${q(this.schema)}.${q(table)}`);
    return Number(r.rows[0].n);
  }

  async sequence(name: string): Promise<number | null> {
    const reg = `${q(this.schema)}.${q(name)}`;
    const exists = await this.client.query<{ r: string | null }>('SELECT to_regclass($1)::text AS r', [reg]);
    if (!exists.rows[0].r) return null;
    const r = await this.client.query<{ last_value: string; is_called: boolean }>(`SELECT last_value::text, is_called FROM ${reg}`);
    const { last_value, is_called } = r.rows[0];
    return is_called ? Number(last_value) : null;
  }

  async lastMigration(): Promise<string | null> {
    const reg = `${q(this.schema)}._prisma_migrations`;
    const exists = await this.client.query<{ r: string | null }>('SELECT to_regclass($1)::text AS r', [reg]);
    if (!exists.rows[0].r) return null;
    const r = await this.client.query<{ name: string }>(
      `SELECT migration_name AS name FROM ${reg} WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1`,
    );
    return r.rows[0]?.name ?? null;
  }
}
