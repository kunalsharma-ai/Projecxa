/**
 * The database side of backups (docs/BACKUPS.md), shared by the app and the command line
 * (`pnpm backup`, `pnpm restore-backup`). Uses MongoDB's own free tools: mongodump makes the copy
 * (one gzip-compressed archive), mongorestore reads it back. Nothing here knows about Nest, so it
 * also works when the app cannot start.
 */
import { PrismaClient as BaseClient } from '@prisma/client';
import { execFile, spawn } from 'child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb } from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { createGunzip } from 'zlib';
import { SCHEMA_VERSION, syncIndexes } from '../prisma/indexes';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

/** Collections whose documents stay out of a backup: they describe the backups and uptime themselves and are kept across a restore. */
export const KEPT_TABLES = ['Backup', 'UptimeCheck'];

/** Where the database is. `uri` holds the password, so it only ever goes into a private config file. */
export interface DbTarget { uri: string; database: string; host: string }

/** DATABASE_URL → the target of mongodump and mongorestore. */
export function dbTarget(databaseUrl: string): DbTarget {
  // Not `new URL()`: a replica set address lists several hosts (mongodb://a:27017,b:27017/db).
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]*)(?:\/([^?]*))?/.exec(databaseUrl.trim());
  if (!m) throw new Error('DATABASE_URL is not a MongoDB address');
  const database = decodeURIComponent(m[2] ?? '');
  if (!database) throw new Error('DATABASE_URL must name the database, e.g. mongodb://host:27017/projexa');
  return { uri: databaseUrl, database, host: m[1]!.split(',')[0]!.replace(/:\d+$/, '') || 'localhost' };
}

/** Finds mongodump / mongorestore: MONGO_TOOLS_DIR if set, else the PATH. */
export function mongoBin(name: 'mongodump' | 'mongorestore') {
  const dir = process.env.MONGO_TOOLS_DIR?.trim();
  return dir ? join(dir, name) : name;
}

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { if (stdout.length < 5_000_000) stdout += d; });
    p.stderr.on('data', (d) => { if (stderr.length < 200_000) stderr += d; });
    p.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'ENOENT' ? new Error(`${cmd} is not installed on this server. Install the MongoDB Database Tools (mongodump, mongorestore) or set MONGO_TOOLS_DIR.`) : e));
    p.on('close', (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(cleanToolError(stderr) || `${cmd} stopped with code ${code}`))));
  });
}

function cleanToolError(s: string) {
  // The tools log progress on stderr; lead with the failed lines, and never echo the address.
  const all = s.split('\n').map((l) => l.replace(/^\S+\t/, '').replace(/mongodb(\+srv)?:\/\/[^\s"']+/g, 'mongodb://…').trim()).filter(Boolean);
  const bad = all.filter((l) => !/^finished |^\d+ document\(s\)/.test(l) && /error|failed/i.test(l));
  return (bad.length ? bad : all.slice(-3)).slice(0, 4).join(' ').slice(0, 600);
}

/** Runs a tool with the address in a private config file, so the password never shows in the process list. */
async function withConfig<T>(t: DbTarget, fn: (configArg: string) => Promise<T>): Promise<T> {
  const { dir, cleanup } = await workDir();
  try {
    const file = join(dir, 'tool.yaml');
    await fs.writeFile(file, `uri: ${JSON.stringify(t.uri)}\n`, { mode: 0o600 });
    return await fn(`--config=${file}`);
  } finally {
    await cleanup();
  }
}

/** mongodump's version, or a plain error if it is missing. */
export async function dumpToolVersion(): Promise<string> {
  return (await run(mongoBin('mongodump'), ['--version'])).stdout.split('\n')[0]!.trim();
}

/** Makes a compressed archive of the database into `file`. */
export async function dumpTo(t: DbTarget, file: string) {
  await withConfig(t, (cfg) => run(mongoBin('mongodump'), [cfg, `--db=${t.database}`, `--archive=${file}`, '--gzip', ...KEPT_TABLES.map((c) => `--excludeCollection=${c}`)]));
}

/**
 * What is inside a backup: its collections, read from the archive's header without a database.
 * Throws when the file is not a mongodump archive (gzip-compressed).
 */
export async function inspectDump(file: string): Promise<{ tables: number; entries: number; collections: string[] }> {
  const head = await readArchiveHead(file).catch(() => null);
  if (!head) throw new Error('The backup file is empty or not a SampTrek backup');
  return { tables: head.length, entries: head.length, collections: head };
}

const ARCHIVE_MAGIC = 0x8199e26d;

/** The collection names in a mongodump archive's prelude (magic, header document, one document per collection, terminator). */
async function readArchiveHead(file: string): Promise<string[]> {
  const gunzip = createReadStream(file).pipe(createGunzip());
  const chunks = gunzip[Symbol.asyncIterator]();
  let buf = Buffer.alloc(0);
  // One iterator for the whole read: leaving a for-await loop would close the stream.
  const need = async (n: number) => {
    while (buf.length < n) {
      const r = await chunks.next();
      if (r.done) return;
      buf = Buffer.concat([buf, r.value as Buffer]);
    }
  };
  try {
    let at = 0;
    const take = async (n: number) => {
      if (buf.length < at + n) await need(at + n);
      if (buf.length < at + n) throw new Error('truncated');
      const b = buf.subarray(at, at + n);
      at += n;
      return b;
    };
    if ((await take(4)).readUInt32LE(0) !== ARCHIVE_MAGIC) throw new Error('not an archive');
    const doc = async () => {
      const len = (await take(4)).readInt32LE(0);
      if (len === -1) return null;
      if (len < 5 || len > 16 * 1024 * 1024) throw new Error('bad document');
      return bsonStrings(Buffer.concat([buf.subarray(at - 4, at), await take(len - 4)]));
    };
    const header = await doc();
    if (!header) throw new Error('no header');
    const names: string[] = [];
    for (let d = await doc(); d; d = await doc()) if (d.collection) names.push(d.collection);
    return names;
  } finally {
    gunzip.destroy();
  }
}

/** The top-level string fields of one BSON document (enough for the archive prelude). */
function bsonStrings(b: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 4;
  while (i < b.length - 1) {
    const type = b[i++]!;
    const end = b.indexOf(0, i);
    const key = b.toString('utf8', i, end);
    i = end + 1;
    const fixed: Record<number, number> = { 0x01: 8, 0x07: 12, 0x08: 1, 0x09: 8, 0x0a: 0, 0x10: 4, 0x11: 8, 0x12: 8, 0x13: 16, 0xff: 0, 0x7f: 0 };
    if (type === 0x02 || type === 0x0d || type === 0x0e) {
      const n = b.readInt32LE(i);
      if (type === 0x02) out[key] = b.toString('utf8', i + 4, i + 4 + n - 1);
      i += 4 + n;
    } else if (type === 0x03 || type === 0x04) i += b.readInt32LE(i);
    else if (type === 0x05) i += 5 + b.readInt32LE(i);
    else if (type in fixed) i += fixed[type]!;
    else throw new Error('unknown BSON type');
  }
  return out;
}

async function client<T>(t: DbTarget, fn: (c: BaseClient) => Promise<T>): Promise<T> {
  const c = new BaseClient({ datasources: { db: { url: t.uri } } });
  try {
    return await fn(c);
  } finally {
    await c.$disconnect();
  }
}

/** The schema version the database was last set up for (see SCHEMA_VERSION), or null when it is empty. */
export async function schemaVersion(t: DbTarget): Promise<string | null> {
  return client(t, async (c) => {
    const r = (await c.$runCommandRaw({ find: '_schema', filter: { _id: 'version' }, limit: 1 })) as { cursor?: { firstBatch?: { version?: string }[] } };
    return r.cursor?.firstBatch?.[0]?.version ?? null;
  });
}

/** This server's schema version. */
export const currentSchemaVersion = () => SCHEMA_VERSION;

async function dropAll(c: BaseClient) {
  const r = (await c.$runCommandRaw({ listCollections: 1, nameOnly: true })) as { cursor: { firstBatch: { name: string }[] } };
  for (const { name } of r.cursor.firstBatch) if (!name.startsWith('system.')) await c.$runCommandRaw({ drop: name });
}

async function load(t: DbTarget, file: string) {
  // Into this database, whatever the database the backup was made from was called.
  await withConfig(t, (cfg) => run(mongoBin('mongorestore'), [cfg, `--archive=${file}`, '--gzip', '--nsFrom=$db$.$coll$', `--nsTo=${t.database}.$coll$`, '--stopOnError']));
}

/**
 * Replaces the whole database with the backup: either everything is restored or the database is
 * put back as it was. Collections a newer version added do not linger, and the collections and
 * indexes of this version are created afterwards.
 */
export async function restoreFrom(t: DbTarget, file: string) {
  // Refuse a file that is not a backup before anything is touched.
  await inspectDump(file);
  const { dir, cleanup } = await workDir();
  try {
    // MongoDB cannot replace a database in one transaction, so keep a copy of it as it is now.
    const before = join(dir, 'before.archive');
    await dumpTo(t, before);
    await client(t, async (c) => {
      await dropAll(c);
      try {
        await load(t, file);
      } catch (e) {
        await dropAll(c);
        await load(t, before);
        await syncIndexes(c as never);
        throw e;
      }
      await syncIndexes(c as never);
    });
  } finally {
    await cleanup();
  }
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

/** samptrek-2026-11-08T0300Z-k3x9.dump(.enc): a mongodump archive (gzip). */
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

/** Runs a command and returns its trimmed output. */
export function execText(file: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}) {
  return new Promise<string>((resolve, reject) => execFile(file, args, { ...opts, maxBuffer: 2_000_000 }, (e, out, err) => (e ? reject(new Error((err || e.message).toString().slice(0, 800))) : resolve(String(out).trim()))));
}
