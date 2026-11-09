import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { BackupsService } from '../../src/backups/backups.service';
import { StatusService } from '../../src/status/status.service';
import { api, createApp, login, makeOrg, PASSWORD, resetDb } from './helpers';

const binary = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Backups, restore and the status page (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let owner: Awaited<ReturnType<typeof makeOrg>>;
  let tenant: Awaited<ReturnType<typeof makeOrg>>;
  let sa: ReturnType<typeof api>;
  let tenantAdmin: ReturnType<typeof api>;
  let backups: BackupsService;
  let status: StatusService;
  let dir: string;
  const http_ = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDb(prisma);
    await prisma.backup.deleteMany();
    await prisma.uptimeCheck.deleteMany();
    await prisma.statusIncident.deleteMany();
    owner = await makeOrg(prisma, 'bk-owner');
    tenant = await makeOrg(prisma, 'bk-tenant');
    await prisma.organization.update({ where: { id: owner.org.id }, data: { platformOwner: true } });
    await prisma.user.update({ where: { id: owner.users.ADMIN.id }, data: { superAdmin: true } });
    sa = api(app, await login(app, owner.users.ADMIN.email));
    tenantAdmin = api(app, await login(app, tenant.users.ADMIN.email));
    backups = app.get(BackupsService);
    status = app.get(StatusService);
    dir = await fs.mkdtemp(join(tmpdir(), 'samptrek-e2e-backups-'));
  });
  afterAll(async () => {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('is only for the Super Admin, and backup storage is only offered to the server owner', async () => {
    await tenantAdmin.get('/super-admin/backups').expect(403);
    await tenantAdmin.get('/super-admin/status').expect(403);
    const list = (await tenantAdmin.get('/integrations/settings').expect(200)).body.integrations.map((i: { kind: string }) => i.kind);
    expect(list).not.toContain('backup_storage');
    await tenantAdmin.put('/integrations/settings/backup_storage', { values: { BACKUP_TARGET: 'local' } }).expect(403);
    const mine = (await sa.get('/integrations/settings').expect(200)).body.integrations.find((i: { kind: string }) => i.kind === 'backup_storage');
    expect(mine).toMatchObject({ group: 'Backups', editable: true, status: { state: 'off' } });
  });

  it('asks for storage first, then backs up in one click', async () => {
    const o = (await sa.get('/super-admin/backups').expect(200)).body;
    expect(o.storage.configured).toBe(false);
    expect(o.tool.ok).toBe(true);
    await sa.post('/super-admin/backups').expect(400);
    await sa.put('/super-admin/backups/settings', { schedule: 'daily' }).expect(400);

    // An S3 bucket needs its fields.
    const bad = await sa.put('/integrations/settings/backup_storage', { values: { BACKUP_TARGET: 's3' } }).expect(400);
    expect(bad.body.message).toMatch(/Bucket endpoint/);

    await sa.put('/integrations/settings/backup_storage', { values: { BACKUP_TARGET: 'local', BACKUP_DIR: join(dir, 'store'), BACKUP_PASSPHRASE: 'a long passphrase for tests' } }).expect(200);
    const t = (await sa.post('/integrations/settings/backup_storage/test').expect(200)).body;
    expect(t).toMatchObject({ ok: true });
    expect(t.message).toMatch(/pg_dump/);
    expect(t.message).toMatch(/encrypted/);

    await prisma.organization.update({ where: { id: owner.org.id }, data: { name: 'Name before' } });
    const started = (await sa.post('/super-admin/backups').expect(202)).body;
    expect(started).toMatchObject({ status: 'running', trigger: 'manual', encrypted: true });
    await sa.post('/super-admin/backups').expect(409);
    await backups.idle();

    const after = (await sa.get('/super-admin/backups').expect(200)).body;
    expect(after.storage).toMatchObject({ configured: true, target: 'local', encrypted: true });
    const b = after.backups[0];
    expect(b).toMatchObject({ status: 'ok', trigger: 'manual', encrypted: true, createdBy: 'ADMIN' });
    expect(b.sizeBytes).toBeGreaterThan(1000);
    expect(b.tables).toBeGreaterThan(30);
    // The newest migration on this server (several features add migrations; the backup records the last one).
    const latest = (await fs.readdir(join(__dirname, '../../prisma/migrations'))).filter((m) => /^\d{14}_/.test(m)).sort().pop();
    expect(b.migration).toBe(latest);
    const files = (await fs.readdir(join(dir, 'store'))).sort();
    expect(files).toEqual([b.name, `${b.name}.json`].sort());
    expect((await fs.readFile(join(dir, 'store', b.name))).subarray(0, 8).toString()).toBe('STBKENC1');
    const manifest = JSON.parse(await fs.readFile(join(dir, 'store', `${b.name}.json`), 'utf8'));
    expect(manifest).toMatchObject({ app: 'samptrek', name: b.name, sha256: b.sha256, encrypted: true });

    const v = (await sa.post(`/super-admin/backups/${b.id}/verify`).expect(200)).body;
    expect(v.ok).toBe(true);
    expect(v.backup.lastVerifyOk).toBe(true);

    const stored = await sa.get(`/super-admin/backups/${b.id}/download`).buffer(true).parse(binary).expect(200);
    expect((stored.body as Buffer).subarray(0, 8).toString()).toBe('STBKENC1');
    const plain = await sa.get(`/super-admin/backups/${b.id}/download?plain=1`).buffer(true).parse(binary).expect(200);
    expect((plain.body as Buffer).subarray(0, 5).toString()).toBe('PGDMP');
    expect(plain.headers['content-disposition']).toContain(b.name.replace(/\.enc$/, ''));
  });

  it('restores only after RESTORE and the password, with a safety backup first', async () => {
    const [b] = (await sa.get('/super-admin/backups').expect(200)).body.backups;
    await prisma.organization.update({ where: { id: owner.org.id }, data: { name: 'Name after' } });
    await prisma.organization.create({ data: { name: 'Made after the backup', slug: 'bk-later' } });

    expect((await sa.post(`/super-admin/backups/${b.id}/restore`, { confirm: 'restore please', password: PASSWORD }).expect(400)).body.message).toMatch(/Type RESTORE/);
    expect((await sa.post(`/super-admin/backups/${b.id}/restore`, { confirm: 'RESTORE', password: 'wrong' }).expect(400)).body.message).toMatch(/password/);
    await tenantAdmin.post(`/super-admin/backups/${b.id}/restore`, { confirm: 'RESTORE', password: PASSWORD }).expect(403);

    const r = (await sa.post(`/super-admin/backups/${b.id}/restore`, { confirm: 'RESTORE', password: PASSWORD }).expect(202)).body;
    expect(r).toMatchObject({ state: 'running', backupName: b.name });
    await backups.idle();
    expect(backups.restoreState).toMatchObject({ state: 'ok', step: 'done' });
    expect(backups.restoreState!.message).toMatch(/safety backup/);

    expect((await prisma.organization.findUniqueOrThrow({ where: { id: owner.org.id } })).name).toBe('Name before');
    expect(await prisma.organization.count({ where: { slug: 'bk-later' } })).toBe(0);
    // The list survives the restore, with the safety copy of the database from just before.
    const o = (await sa.get('/super-admin/backups').expect(200)).body;
    expect(o.backups.map((x: { trigger: string }) => x.trigger).sort()).toEqual(['before_restore', 'manual']);
    expect(o.backups.find((x: { id: string }) => x.id === b.id).restoredAt).toBeTruthy();
    expect(o.restore).toMatchObject({ state: 'ok' });
    // Still signed in, and the restore is in the server owner's log.
    expect(await prisma.auditEvent.count({ where: { action: 'backup.restored' } })).toBe(1);

    // Going back to the safety copy brings the later changes back.
    const safety = o.backups.find((x: { trigger: string }) => x.trigger === 'before_restore');
    await sa.post(`/super-admin/backups/${safety.id}/restore`, { confirm: 'RESTORE', password: PASSWORD }).expect(202);
    await backups.idle();
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: owner.org.id } })).name).toBe('Name after');
    expect(await prisma.organization.count({ where: { slug: 'bk-later' } })).toBe(1);
  });

  it('refuses a backup from a newer version, or one whose file was changed', async () => {
    const [b] = (await sa.get('/super-admin/backups').expect(200)).body.backups;
    await prisma.backup.update({ where: { id: b.id }, data: { migration: '99991231000000_future' } });
    expect((await sa.post(`/super-admin/backups/${b.id}/restore`, { confirm: 'RESTORE', password: PASSWORD }).expect(400)).body.message).toMatch(/newer version/);
    await prisma.backup.update({ where: { id: b.id }, data: { migration: null, sha256: 'f'.repeat(64) } });
    const v = (await sa.post(`/super-admin/backups/${b.id}/verify`).expect(200)).body;
    expect(v).toMatchObject({ ok: false });
    expect(v.message).toMatch(/fingerprint/);
    const name = (await prisma.organization.findUniqueOrThrow({ where: { id: owner.org.id } })).name;
    await sa.post(`/super-admin/backups/${b.id}/restore`, { confirm: 'RESTORE', password: PASSWORD }).expect(202);
    await backups.idle();
    expect(backups.restoreState).toMatchObject({ state: 'failed' });
    expect(backups.restoreState!.message).toMatch(/Nothing was changed/);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: owner.org.id } })).name).toBe(name);
  });

  it('finds backups again from the storage alone', async () => {
    const before = await prisma.backup.count({ where: { status: 'ok' } });
    await prisma.backup.deleteMany();
    const r = (await sa.post('/super-admin/backups/rescan').expect(200)).body;
    expect(r.added).toBe(before);
    expect((await sa.post('/super-admin/backups/rescan').expect(200)).body.added).toBe(0);
  });

  it('runs on a schedule and keeps only the newest ones', async () => {
    const realNow = backups.now;
    // Later than the backups taken above, so they are the old ones that get deleted.
    backups.now = () => new Date('2030-03-08T01:00:00Z');
    const s = (await sa.put('/super-admin/backups/settings', { schedule: 'daily', hour: 3, keep: 2 }).expect(200)).body;
    expect(s.settings).toMatchObject({ schedule: 'daily', hour: 3, keep: 2 });
    expect(s.nextRunAt).toBe('2030-03-08T03:00:00.000Z');
    expect(await backups.runDue()).toBeNull();
    backups.now = () => new Date('2030-03-08T03:04:00Z');
    const done = await backups.runDue();
    expect(done).toMatchObject({ status: 'ok', trigger: 'scheduled', createdBy: 'Schedule' });
    expect(await backups.runDue()).toBeNull();
    const left = await prisma.backup.findMany({ where: { status: 'ok' } });
    backups.now = realNow;
    expect(left).toHaveLength(2);
    expect((await fs.readdir(join(dir, 'store'))).filter((f) => !f.endsWith('.json'))).toHaveLength(2);
    await prisma.backup.updateMany({ data: { startedAt: new Date(Date.now() - 60_000) } });
    await sa.put('/super-admin/backups/settings', { schedule: 'off' }).expect(200);
  });

  it('works with an S3-compatible bucket', async () => {
    const objects = new Map<string, Buffer>();
    const auth: string[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        auth.push(String(req.headers.authorization));
        const u = new URL(req.url!, 'http://x');
        const key = decodeURIComponent(u.pathname.replace(/^\/bucket\//, ''));
        if (req.method === 'PUT') { objects.set(key, Buffer.concat(chunks)); res.writeHead(200).end(); return; }
        if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204).end(); return; }
        if (req.method === 'GET' && u.searchParams.get('list-type') === '2') {
          const prefix = u.searchParams.get('prefix') ?? '';
          const items = [...objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size><LastModified>2026-11-08T00:00:00.000Z</LastModified></Contents>`).join('');
          res.writeHead(200, { 'content-type': 'application/xml' }).end(`<ListBucketResult><IsTruncated>false</IsTruncated>${items}</ListBucketResult>`);
          return;
        }
        const o = objects.get(key);
        if (!o) { res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>'); return; }
        res.writeHead(200).end(o);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      await sa.put('/integrations/settings/backup_storage', { values: {
        BACKUP_TARGET: 's3', BACKUP_S3_ENDPOINT: `http://127.0.0.1:${port}`, BACKUP_S3_BUCKET: 'bucket', BACKUP_S3_PREFIX: 'prod',
        BACKUP_S3_ACCESS_KEY: 'AKIDEXAMPLE', BACKUP_S3_SECRET_KEY: 'secret', BACKUP_PASSPHRASE: null,
      } }).expect(200);
      expect((await sa.post('/integrations/settings/backup_storage/test').expect(200)).body).toMatchObject({ ok: true });
      await sa.post('/super-admin/backups').expect(202);
      await backups.idle();
      const [b] = (await sa.get('/super-admin/backups').expect(200)).body.backups;
      expect(b).toMatchObject({ status: 'ok', target: 's3', encrypted: false });
      expect(objects.get(`prod/${b.name}`)!.subarray(0, 5).toString()).toBe('PGDMP');
      expect(objects.has(`prod/${b.name}.json`)).toBe(true);
      expect(auth.every((a) => a.startsWith('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/'))).toBe(true);
      expect((await sa.post(`/super-admin/backups/${b.id}/verify`).expect(200)).body.ok).toBe(true);
      await prisma.backup.deleteMany({ where: { id: b.id } });
      expect((await sa.post('/super-admin/backups/rescan').expect(200)).body.added).toBe(1);
      const again = await prisma.backup.findFirstOrThrow({ where: { name: b.name } });
      await sa.delete(`/super-admin/backups/${again.id}`).expect(200);
      expect(objects.has(`prod/${b.name}`)).toBe(false);
    } finally {
      server.close();
    }
  });

  // ───────────── Status page ─────────────

  it('shows a public status page with uptime and a ping for monitors', async () => {
    await http_().get('/api/v1/public/status/ping').expect(200);
    for (let i = 0; i < 3; i++) await status.check();
    const p = (await http_().get('/api/v1/public/status').expect(200)).body;
    expect(p.title).toBe('SampTrek status');
    expect(p.overall).toBe('operational');
    expect(p.components.map((c: { key: string }) => c.key)).toEqual(['app', 'links', 'database', 'callbacks', 'email']);
    const app0 = p.components[0];
    expect(app0.status).toBe('up');
    expect(app0.days).toHaveLength(90);
    expect(app0.days[89].uptime).not.toBeNull();
    expect(app0.days[0].uptime).toBeNull();
    // Nothing about organisations, users or projects is on the page.
    expect(JSON.stringify(p)).not.toMatch(/bk-owner|bk-tenant|@/);
  });

  it('lets the Super Admin post incidents and maintenance, and hide the page', async () => {
    const inc = (await sa.post('/super-admin/status/incidents', { title: 'Respondent links are slow', impact: 'major', components: ['links'], message: 'We are looking into it.' }).expect(201)).body;
    expect(inc.state).toBe('investigating');
    await sa.post('/super-admin/status/incidents', { title: 'Bad', impact: 'major', state: 'scheduled', message: 'x' }).expect(400);
    let p = (await http_().get('/api/v1/public/status').expect(200)).body;
    expect(p.overall).toBe('outage');
    expect(p.components.find((c: { key: string }) => c.key === 'links').status).toBe('down');
    expect(p.incidents.active[0]).toMatchObject({ title: 'Respondent links are slow' });

    await sa.patch(`/super-admin/status/incidents/${inc.id}`, { state: 'resolved', message: 'Fixed: a slow database query.' }).expect(200);
    await sa.post('/super-admin/status/incidents', { title: 'Database upgrade', impact: 'maintenance', components: ['database'], message: 'About 10 minutes.', startsAt: '2030-01-05T02:00:00Z' }).expect(201);
    p = (await http_().get('/api/v1/public/status').expect(200)).body;
    expect(p.overall).toBe('operational');
    expect(p.incidents.recent[0].updates).toHaveLength(2);
    expect(p.incidents.upcoming[0]).toMatchObject({ title: 'Database upgrade', state: 'scheduled' });

    const admin = (await sa.get('/super-admin/status').expect(200)).body;
    expect(admin.incidents).toHaveLength(2);
    expect(admin.lastCheck.components.database).toBe('up');
    await sa.put('/super-admin/status/settings', { components: ['app', 'database'], title: 'Acme Research status' }).expect(200);
    p = (await http_().get('/api/v1/public/status').expect(200)).body;
    expect(p.title).toBe('Acme Research status');
    expect(p.components).toHaveLength(2);
    await sa.put('/super-admin/status/settings', { enabled: false }).expect(200);
    await http_().get('/api/v1/public/status').expect(404);
    await sa.put('/super-admin/status/settings', { enabled: true }).expect(200);
  });
});
