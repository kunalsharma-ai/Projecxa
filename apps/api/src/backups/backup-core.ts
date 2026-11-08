/**
 * The database side of backups (docs/BACKUPS.md), shared by the app and the command line
 * (`pnpm backup`, `pnpm restore-backup`). Uses PostgreSQL's own free tools: pg_dump makes the copy,
 * pg_restore reads it back. Nothing here knows about Nest, so it also works when the app cannot start.
 */
import { execFile, spawn } from 'child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb } from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

/** Tables whose rows stay out of a backup: they describe the backups and uptime themselves and are kept across a restore. */
export const KEPT_TABLES = ['Backup', 'UptimeCheck'];

export interface PgTarget { env: NodeJS.ProcessEnv; schema: string; database: string; host: string }

/**
 * DATABASE_URL → PG* variables, so the password never shows in the process list.
 * Prisma-only parameters (schema, connection_limit…) are dropped; sslmode is kept.
 */
export function pgTarget(databaseUrl: string, base: NodeJS.ProcessEnv = process.env): PgTarget {
  const u = new URL(databaseUrl);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('DATABASE_URL is not a PostgreSQL address');
  const env: NodeJS.ProcessEnv = { ...base };
  for (const k of Object.keys(env)) if (k.startsWith('PG')) delete env[k];
  env.PGHOST = decodeURIComponent(u.hostname.replace(/^\[|\]$/g, '')) || 'localhost';
  env.PGPORT = u.port || '5432';
  env.PGUSER = decodeURIComponent(u.username);
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  env.PGDATABASE = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const ssl = u.searchParams.get('sslmode');
  if (ssl) env.PGSSLMODE = ssl === 'prefer' || ssl === 'require' || ssl === 'disable' || ssl === 'allow' || ssl === 'verify-ca' || ssl === 'verify-full' ? ssl : 'require';
  const host = u.searchParams.get('host');
  if (host) env.PGHOST = host;
  env.PGAPPNAME = 'samptrek-backup';
  return { env, schema: u.searchParams.get('schema') || 'public', database: env.PGDATABASE!, host: env.PGHOST! };
}

/** Finds pg_dump / pg_restore / psql: PG_BIN_DIR if set, else the PATH. */
export function pgBin(name: 'pg_dump' | 'pg_restore' | 'psql') {
  const dir = process.env.PG_BIN_DIR?.trim();
  return dir ? join(dir, name) : name;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, stdin?: NodeJS.ReadableStream | string, stdinTail?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { if (stdout.length < 5_000_000) stdout += d; });
    p.stderr.on('data', (d) => { if (stderr.length < 100_000) stderr += d; });
    p.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'ENOENT' ? new Error(`${cmd} is not installed on this server. Install the PostgreSQL client tools (e.g. apt install postgresql-client-16) or set PG_BIN_DIR.`) : e));
    p.stdin.on('error', () => undefined);
    p.on('close', (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(cleanPgError(stderr) || `${cmd} stopped with code ${code}`))));
    if (typeof stdin === 'string') p.stdin.end(stdin);
    else if (stdin) {
      stdin.on('error', reject);
      stdin.on('end', () => p.stdin.end(stdinTail ?? ''));
      stdin.pipe(p.stdin, { end: false });
    } else p.stdin.end();
  });
}

function cleanPgError(s: string) {
  const lines = s.split('\n').map((l) => l.trim()).filter((l) => l && !/^(pg_dump|pg_restore|psql): (warning|detail): /.test(l) && !/^NOTICE:/.test(l));
  return lines.slice(0, 4).join(' ').slice(0, 600);
}

/** pg_dump's version, or a plain error if it is missing. */
export async function pgDumpVersion(): Promise<string> {
  return (await run(pgBin('pg_dump'), ['--version'], process.env)).stdout.trim();
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Makes a custom-format dump (compressed) of the schema into `file`. */
export async function dumpTo(t: PgTarget, file: string) {
  const args = ['--format=custom', '--compress=6', '--no-owner', '--no-privileges', `--schema=${q(t.schema)}`, `--file=${file}`];
  for (const table of KEPT_TABLES) args.push(`--exclude-table-data=${q(t.schema)}.${q(table)}`);
  await run(pgBin('pg_dump'), args, t.env);
}

/** What is inside a dump: tables with data, and whether pg_restore can read it at all. */
export async function inspectDump(file: string): Promise<{ tables: number; entries: number }> {
  const { stdout } = await run(pgBin('pg_restore'), ['--list', file], process.env);
  const lines = stdout.split('\n').filter((l) => l && !l.startsWith(';'));
  if (!lines.length) throw new Error('The backup file is empty or not a SampTrek backup');
  return { entries: lines.length, tables: lines.filter((l) => / TABLE DATA /.test(l)).length };
}

/** The newest migration the database has, e.g. 20261110090000_backups_and_status. */
export async function newestMigration(t: PgTarget): Promise<string | null> {
  const { stdout } = await run(pgBin('psql'), ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', `SELECT max(migration_name) FROM ${q(t.schema)}."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`], t.env);
  return stdout.trim() || null;
}

/**
 * Replaces the whole schema with the dump, in ONE transaction: either everything is restored or
 * nothing changes. The schema is emptied first, so tables a newer version added do not linger.
 */
export async function restoreFrom(t: PgTarget, file: string) {
  // Refuse a file pg_restore cannot read before anything is touched.
  await inspectDump(file);
  const prelude = [
    'BEGIN;',
    "SET LOCAL lock_timeout = '60s';",
    `DROP SCHEMA IF EXISTS ${q(t.schema)} CASCADE;`,
    `CREATE SCHEMA ${q(t.schema)};`,
    '',
  ].join('\n');
  // pg_restore -n takes the plain name (pg_dump --schema takes a quoted pattern).
  const sql = spawn(pgBin('pg_restore'), ['--no-owner', '--no-privileges', `--schema=${t.schema}`, '--file=-', file], { env: t.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let restoreErr = '';
  sql.stderr.on('data', (d) => { restoreErr += d; });
  const exited = new Promise<number>((resolve, reject) => {
    sql.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'ENOENT' ? new Error('pg_restore is not installed on this server. Install the PostgreSQL client tools or set PG_BIN_DIR.') : e));
    sql.on('close', (c) => resolve(c ?? 1));
  });
  const { Readable } = await import('stream');
  // COMMIT is only sent once pg_restore has finished cleanly. Anything else ends the session
  // inside the open transaction, and PostgreSQL rolls it all back.
  const input = Readable.from((async function* () {
    yield prelude;
    for await (const chunk of sql.stdout) yield chunk as Buffer;
    const code = await exited;
    yield code === 0 ? '\nCOMMIT;\n' : '\nROLLBACK;\n';
  })());
  try {
    await psqlRun(t, input);
  } catch (e) {
    sql.kill();
    throw e;
  }
  if ((await exited) !== 0) throw new Error(cleanPgError(restoreErr) || 'pg_restore could not read the backup');
}

function psqlRun(t: PgTarget, input: NodeJS.ReadableStream) {
  return run(pgBin('psql'), ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], t.env, input);
}

// ───────────── Encryption (AES-256-GCM, key from a passphrase with scrypt) ─────────────

const MAGIC = Buffer.from('STBKENC1');
const SALT = 16;
const IV = 12;
const TAG = 16;
const HEADER = MAGIC.length + SALT + IV;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function isEncryptedFile(file: string): Promise<boolean> {
  const fh = await fs.open(file, 'r');
  try {
    const b = Buffer.alloc(MAGIC.length);
    await fh.read(b, 0, b.length, 0);
    return b.equals(MAGIC);
  } finally { await fh.close(); }
}

export async function encryptFile(src: string, dest: string, passphrase: string) {
  const salt = randomBytes(SALT);
  const iv = randomBytes(IV);
  const key = await scrypt(passphrase, salt, 32, SCRYPT);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(dest, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(createReadStream(src), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (e?: Error | null) => (e ? reject(e) : resolve())));
}

/** Writes the plain dump to `dest`. A wrong passphrase or a changed file is refused (GCM tag). */
export async function decryptFile(src: string, dest: string, passphrase: string) {
  const { size } = await fs.stat(src);
  if (size < HEADER + TAG) throw new Error('The backup file is too short');
  const fh = await fs.open(src, 'r');
  const head = Buffer.alloc(HEADER);
  const tag = Buffer.alloc(TAG);
  try {
    await fh.read(head, 0, HEADER, 0);
    await fh.read(tag, 0, TAG, size - TAG);
  } finally { await fh.close(); }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('This backup is not encrypted');
  const salt = head.subarray(MAGIC.length, MAGIC.length + SALT);
  const iv = head.subarray(MAGIC.length + SALT, HEADER);
  const key = await scrypt(passphrase, salt, 32, SCRYPT);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try {
    await pipeline(createReadStream(src, { start: HEADER, end: size - TAG - 1 }), d, createWriteStream(dest, { mode: 0o600 }));
  } catch {
    await fs.rm(dest, { force: true });
    throw new Error('Could not decrypt the backup: the passphrase is wrong or the file was changed');
  }
}

export async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

/** A private temporary folder; removed by the caller with `cleanup()`. */
export async function workDir() {
  const dir = await fs.mkdtemp(join(process.env.BACKUP_TMP_DIR?.trim() || tmpdir(), 'samptrek-backup-'));
  await fs.chmod(dir, 0o700);
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

/** samptrek-2026-11-08T0300Z-k3x9.dump(.enc) */
export function backupName(at: Date, encrypted: boolean) {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace(/(\d{8}T\d{4})\d{2}Z/, '$1Z');
  return `samptrek-${stamp}-${randomBytes(3).toString('hex')}.dump${encrypted ? '.enc' : ''}`;
}

/** The JSON written next to each backup, so backups can be found again from the storage alone. */
export interface Manifest {
  app: 'samptrek';
  version: 1;
  name: string;
  trigger: string;
  createdAt: string;
  createdBy: string | null;
  sizeBytes: number;
  sha256: string;
  encrypted: boolean;
  migration: string | null;
  tables: number;
  database: string;
}
export const manifestName = (name: string) => `${name}.json`;

/** Runs a shell command and returns its trimmed output (used for `prisma migrate deploy` after a restore). */
export function execText(file: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}) {
  return new Promise<string>((resolve, reject) => execFile(file, args, { ...opts, maxBuffer: 2_000_000 }, (e, out, err) => (e ? reject(new Error((err || e.message).toString().slice(0, 800))) : resolve(String(out).trim()))));
}
