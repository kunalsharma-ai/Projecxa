/**
 * Where backups are kept (docs/BACKUPS.md): a folder on the server, or any S3-compatible bucket
 * (Cloudflare R2, Backblaze B2, MinIO, Wasabi, AWS S3). No SDK: S3 requests are signed here with
 * AWS Signature Version 4, so nothing extra needs installing.
 */
import { createHash, createHmac } from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import * as http from 'http';
import * as https from 'https';
import { dirname, join, resolve } from 'path';
import { pipeline } from 'stream/promises';

export type EnvMap = Record<string, string | undefined>;

export interface StoredObject { name: string; size: number; modifiedAt: Date }

export interface BackupStorage {
  readonly target: 'local' | 's3';
  /** Where it is, in words, for the screen (never includes secrets). */
  readonly where: string;
  put(name: string, file: string): Promise<void>;
  putText(name: string, text: string): Promise<void>;
  get(name: string, file: string): Promise<void>;
  getText(name: string): Promise<string | null>;
  remove(name: string): Promise<void>;
  list(): Promise<StoredObject[]>;
}

/** Only file names SampTrek made itself: no folders, no "..". */
export function safeName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(name) || name.includes('..')) throw new Error(`Not a backup file name: ${name}`);
  return name;
}

export class LocalStorage implements BackupStorage {
  readonly target = 'local' as const;
  readonly dir: string;
  constructor(dir: string) {
    this.dir = resolve(dir);
  }
  get where() { return `Folder ${this.dir} on the server`; }
  private path(name: string) { return join(this.dir, safeName(name)); }
  async put(name: string, file: string) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = this.path(name) + '.part';
    await pipeline(createReadStream(file), createWriteStream(tmp, { mode: 0o600 }));
    await fs.rename(tmp, this.path(name));
  }
  async putText(name: string, text: string) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.path(name), text, { mode: 0o600 });
  }
  async get(name: string, file: string) {
    await fs.mkdir(dirname(file), { recursive: true });
    await pipeline(createReadStream(this.path(name)), createWriteStream(file, { mode: 0o600 }));
  }
  async getText(name: string) {
    try { return await fs.readFile(this.path(name), 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  async remove(name: string) {
    await fs.rm(this.path(name), { force: true });
  }
  async list() {
    let names: string[];
    try { names = await fs.readdir(this.dir); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
    const out: StoredObject[] = [];
    for (const n of names) {
      if (n.endsWith('.part')) continue;
      const s = await fs.stat(join(this.dir, n)).catch(() => null);
      if (s?.isFile()) out.push({ name: n, size: s.size, modifiedAt: s.mtime });
    }
    return out;
  }
}

// ───────────── S3 (Signature Version 4) ─────────────

const sha256hex = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const hmac = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s).digest();
/** RFC 3986 encoding as S3 wants it; "/" kept in paths. */
const enc = (s: string, keepSlash = false) => {
  const e = encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return keepSlash ? e.replace(/%2F/g, '/') : e;
};

export interface SignInput {
  method: string;
  /** Full URL, already encoded path. */
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  accessKey: string;
  secretKey: string;
  region: string;
  /** yyyymmddThhmmssZ */
  amzDate: string;
}

/** Adds x-amz-date, x-amz-content-sha256 and Authorization (AWS Signature Version 4, service s3). */
export function signV4(i: SignInput): Record<string, string> {
  const date = i.amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...i.headers, host: i.url.host, 'x-amz-content-sha256': i.payloadHash, 'x-amz-date': i.amzDate };
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const signed = Object.keys(lower).sort();
  const query = [...i.url.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [i.method, i.url.pathname || '/', query, signed.map((k) => `${k}:${lower[k]}\n`).join(''), signed.join(';'), i.payloadHash].join('\n');
  const scope = `${date}/${i.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', i.amzDate, scope, sha256hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + i.secretKey, date), i.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKey}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}` };
}

export interface S3Config { endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string; prefix: string; pathStyle: boolean }

interface Reply { status: number; body: Buffer }

export class S3Storage implements BackupStorage {
  readonly target = 's3' as const;
  /** Swapped in tests. */
  now: () => Date = () => new Date();
  constructor(readonly c: S3Config) {}
  get where() { return `Bucket ${this.c.bucket}${this.c.prefix ? '/' + this.c.prefix : ''} at ${new URL(this.c.endpoint).host}`; }

  private url(key: string | null, query: Record<string, string> = {}): URL {
    const base = new URL(this.c.endpoint);
    const path = key === null ? '' : '/' + enc(key, true);
    const u = this.c.pathStyle
      ? new URL(`${base.protocol}//${base.host}/${enc(this.c.bucket)}${path || '/'}`)
      : new URL(`${base.protocol}//${this.c.bucket}.${base.host}${path || '/'}`);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    return u;
  }
  private key(name: string) { return (this.c.prefix ? this.c.prefix.replace(/\/+$/, '') + '/' : '') + safeName(name); }

  private request(method: string, url: URL, opts: { body?: Buffer; file?: { path: string; size: number }; toFile?: string } = {}): Promise<Reply> {
    const amzDate = this.now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const payloadHash = opts.file ? 'UNSIGNED-PAYLOAD' : sha256hex(opts.body ?? '');
    const length = opts.file ? opts.file.size : (opts.body?.length ?? 0);
    const headers = signV4({ method, url, headers: method === 'PUT' ? { 'content-length': String(length) } : {}, payloadHash, accessKey: this.c.accessKey, secretKey: this.c.secretKey, region: this.c.region, amzDate });
    const lib = url.protocol === 'https:' ? https : http;
    return new Promise<Reply>((resolveReply, reject) => {
      const req = lib.request(url, { method, headers, timeout: 120_000 }, (res) => {
        const status = res.statusCode ?? 0;
        if (opts.toFile && status === 200) {
          const out = createWriteStream(opts.toFile, { mode: 0o600 });
          res.pipe(out);
          out.on('finish', () => resolveReply({ status, body: Buffer.alloc(0) }));
          out.on('error', reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => resolveReply({ status, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error(`${url.host} did not answer in time`)));
      req.on('error', reject);
      if (opts.file) createReadStream(opts.file.path).on('error', reject).pipe(req);
      else req.end(opts.body);
    });
  }

  private fail(what: string, r: Reply): never {
    const text = r.body.toString('utf8');
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    const msg = /<Message>([^<]+)<\/Message>/.exec(text)?.[1];
    const hint = r.status === 403 ? ' Check the access key, secret and that the key may write to this bucket.' : r.status === 404 ? ' Check the bucket name and endpoint.' : '';
    throw new Error(`${what} failed: ${r.status}${code ? ` ${code}` : ''}${msg ? ` (${msg})` : ''}.${hint}`);
  }

  async put(name: string, file: string) {
    const { size } = await fs.stat(file);
    const r = await this.request('PUT', this.url(this.key(name)), { file: { path: file, size } });
    if (r.status !== 200) this.fail('Upload', r);
  }
  async putText(name: string, text: string) {
    const r = await this.request('PUT', this.url(this.key(name)), { body: Buffer.from(text, 'utf8') });
    if (r.status !== 200) this.fail('Upload', r);
  }
  async get(name: string, file: string) {
    await fs.mkdir(dirname(file), { recursive: true });
    const r = await this.request('GET', this.url(this.key(name)), { toFile: file });
    if (r.status !== 200) this.fail('Download', r);
  }
  async getText(name: string) {
    const r = await this.request('GET', this.url(this.key(name)));
    if (r.status === 404) return null;
    if (r.status !== 200) this.fail('Download', r);
    return r.body.toString('utf8');
  }
  async remove(name: string) {
    const r = await this.request('DELETE', this.url(this.key(name)));
    if (r.status !== 204 && r.status !== 200 && r.status !== 404) this.fail('Delete', r);
  }
  async list() {
    const out: StoredObject[] = [];
    const prefix = this.c.prefix ? this.c.prefix.replace(/\/+$/, '') + '/' : '';
    let token: string | undefined;
    for (let page = 0; page < 100; page++) {
      const q: Record<string, string> = { 'list-type': '2', prefix };
      if (token) q['continuation-token'] = token;
      const r = await this.request('GET', this.url(null, q));
      if (r.status !== 200) this.fail('Listing the bucket', r);
      const xml = r.body.toString('utf8');
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = unxml(/<Key>([^<]*)<\/Key>/.exec(m[1])?.[1] ?? '');
        const name = key.slice(prefix.length);
        if (!name || name.includes('/')) continue;
        out.push({ name, size: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0), modifiedAt: new Date(/<LastModified>([^<]+)<\/LastModified>/.exec(m[1])?.[1] ?? 0) });
      }
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
      token = unxml(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '');
      if (!token) break;
    }
    return out;
  }
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The folder used when nothing is set up: ./backups next to the API, outside the web root. */
export const DEFAULT_BACKUP_DIR = 'backups';

/** Builds the storage from Settings → Integrations → Backup storage (or the env fallback). */
export function storageFrom(env: EnvMap): BackupStorage {
  const target = (env.BACKUP_TARGET ?? 'local').trim();
  if (target === 's3') {
    const c = s3From(env);
    if (!c) throw new Error('Backup storage: fill in the endpoint, bucket, access key and secret in Settings → Integrations → Backup storage');
    return new S3Storage(c);
  }
  return new LocalStorage(env.BACKUP_DIR?.trim() || DEFAULT_BACKUP_DIR);
}

export function s3From(env: EnvMap): S3Config | null {
  const endpoint = env.BACKUP_S3_ENDPOINT?.trim();
  const bucket = env.BACKUP_S3_BUCKET?.trim();
  const accessKey = env.BACKUP_S3_ACCESS_KEY?.trim();
  const secretKey = env.BACKUP_S3_SECRET_KEY?.trim();
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket,
    accessKey,
    secretKey,
    region: env.BACKUP_S3_REGION?.trim() || 'auto',
    prefix: (env.BACKUP_S3_PREFIX ?? '').trim().replace(/^\/+|\/+$/g, ''),
    pathStyle: (env.BACKUP_S3_STYLE ?? 'path').trim() !== 'virtual',
  };
}
