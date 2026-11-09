import { promises as fs } from 'fs';
import { join } from 'path';
import { backupName, decryptFile, encryptFile, isEncryptedFile, pgTarget, sha256File, workDir } from '../../src/backups/backup-core';
import { latestSlot, nextSlot } from '../../src/backups/backups.service';
import { LocalStorage, s3From, safeName, signV4, storageFrom } from '../../src/backups/storage';
import { dayStats, overallOf } from '../../src/status/status.service';

describe('backups: S3 signing', () => {
  it('matches the AWS Signature Version 4 example for GET Object', () => {
    // docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html → "Example: GET Object"
    const h = signV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { Range: 'bytes=0-9' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      amzDate: '20130524T000000Z',
    });
    expect(h.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('builds the bucket from the saved fields', () => {
    expect(s3From({ BACKUP_S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com/', BACKUP_S3_BUCKET: 'b' })).toBeNull();
    const c = s3From({ BACKUP_S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com/', BACKUP_S3_BUCKET: 'b', BACKUP_S3_ACCESS_KEY: 'k', BACKUP_S3_SECRET_KEY: 's', BACKUP_S3_PREFIX: '/prod/' })!;
    expect(c).toMatchObject({ endpoint: 'https://x.r2.cloudflarestorage.com', region: 'auto', prefix: 'prod', pathStyle: true });
    expect(storageFrom({ BACKUP_TARGET: 's3', ...{ BACKUP_S3_ENDPOINT: 'https://e', BACKUP_S3_BUCKET: 'b', BACKUP_S3_ACCESS_KEY: 'k', BACKUP_S3_SECRET_KEY: 's' } }).where).toBe('Bucket b at e');
    expect(storageFrom({}).target).toBe('local');
  });

  it('only accepts its own file names', () => {
    expect(safeName('samptrek-20261108T0300Z-ab12cd.dump.enc')).toBeTruthy();
    for (const bad of ['../etc/passwd', 'a/b', '.hidden', '']) expect(() => safeName(bad)).toThrow();
  });
});

describe('backups: files', () => {
  it('encrypts and decrypts, and refuses a wrong passphrase or a changed file', async () => {
    const { dir, cleanup } = await workDir();
    try {
      const plain = join(dir, 'p');
      await fs.writeFile(plain, Buffer.alloc(300_000, 7));
      await encryptFile(plain, join(dir, 'e'), 'correct horse');
      expect(await isEncryptedFile(join(dir, 'e'))).toBe(true);
      expect(await isEncryptedFile(plain)).toBe(false);
      await decryptFile(join(dir, 'e'), join(dir, 'd'), 'correct horse');
      expect(await sha256File(join(dir, 'd'))).toBe(await sha256File(plain));
      await expect(decryptFile(join(dir, 'e'), join(dir, 'x'), 'wrong')).rejects.toThrow(/passphrase is wrong/);
      const b = await fs.readFile(join(dir, 'e'));
      b[1000] ^= 1;
      await fs.writeFile(join(dir, 'e2'), b);
      await expect(decryptFile(join(dir, 'e2'), join(dir, 'y'), 'correct horse')).rejects.toThrow(/changed/);
    } finally { await cleanup(); }
  });

  it('keeps files in a folder', async () => {
    const { dir, cleanup } = await workDir();
    try {
      const s = new LocalStorage(join(dir, 'store'));
      expect(await s.list()).toEqual([]);
      await s.putText('a.json', '{}');
      await fs.writeFile(join(dir, 'f'), 'hello');
      await s.put('a', join(dir, 'f'));
      expect((await s.list()).map((x) => x.name).sort()).toEqual(['a', 'a.json']);
      await s.get('a', join(dir, 'g'));
      expect(await fs.readFile(join(dir, 'g'), 'utf8')).toBe('hello');
      expect(await s.getText('missing')).toBeNull();
      await s.remove('a');
      expect((await s.list()).map((x) => x.name)).toEqual(['a.json']);
    } finally { await cleanup(); }
  });

  it('names backups by time and reads the database address without exposing the password', () => {
    expect(backupName(new Date('2026-11-08T03:00:12Z'), true)).toMatch(/^samptrek-20261108T0300Z-[0-9a-f]{6}\.dump\.enc$/);
    const t = pgTarget('postgresql://u%40x:p%23ss@db.internal:6543/samp?schema=crm&sslmode=require&connection_limit=5', {});
    expect(t.env).toMatchObject({ PGHOST: 'db.internal', PGPORT: '6543', PGUSER: 'u@x', PGPASSWORD: 'p#ss', PGDATABASE: 'samp', PGSSLMODE: 'require' });
    expect(t.schema).toBe('crm');
  });
});

describe('backups: schedule', () => {
  const now = new Date('2026-11-11T10:30:00Z'); // a Wednesday
  it('finds the latest and next daily and weekly slot', () => {
    expect(latestSlot({ schedule: 'off', hour: 2, weekday: 0 }, now)).toBeNull();
    expect(latestSlot({ schedule: 'daily', hour: 2, weekday: 0 }, now)!.toISOString()).toBe('2026-11-11T02:00:00.000Z');
    expect(latestSlot({ schedule: 'daily', hour: 23, weekday: 0 }, now)!.toISOString()).toBe('2026-11-10T23:00:00.000Z');
    expect(latestSlot({ schedule: 'weekly', hour: 2, weekday: 0 }, now)!.toISOString()).toBe('2026-11-08T02:00:00.000Z');
    expect(nextSlot({ schedule: 'weekly', hour: 2, weekday: 0 }, now)!.toISOString()).toBe('2026-11-15T02:00:00.000Z');
    expect(nextSlot({ schedule: 'daily', hour: 2, weekday: 0 }, now)!.toISOString()).toBe('2026-11-12T02:00:00.000Z');
  });
});

describe('status page: uptime', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  it('counts minutes without a check as down', () => {
    const counts = new Map([['2026-11-08', { up: 600, degraded: 60 }], ['2026-11-07', { up: 1440 }]]);
    const days = dayStats(counts, new Date('2026-11-07T00:00:00Z'), now, 3);
    expect(days[0]).toEqual({ date: '2026-11-06', uptime: null, minutes: 0, downMinutes: 0, degradedMinutes: 0 });
    expect(days[1]).toMatchObject({ date: '2026-11-07', uptime: 100, downMinutes: 0 });
    // 721 minutes so far today (the current one included), 660 checked (60 degraded still count as up).
    expect(days[2]).toMatchObject({ date: '2026-11-08', minutes: 721, downMinutes: 61, degradedMinutes: 60, uptime: 91.54 });
  });

  it('only counts from the first check ever', () => {
    const days = dayStats(new Map([['2026-11-08', { up: 120 }]]), new Date('2026-11-08T10:00:00Z'), now, 1);
    expect(days[0]).toMatchObject({ minutes: 121, downMinutes: 1, uptime: 99.174 });
  });

  it('works out the overall state', () => {
    expect(overallOf(['up', 'up'], [])).toBe('operational');
    expect(overallOf(['up', 'degraded'], [])).toBe('degraded');
    expect(overallOf(['up', 'down'], [])).toBe('outage');
    expect(overallOf(['up'], [{ impact: 'minor', state: 'investigating' }])).toBe('degraded');
    expect(overallOf(['up'], [{ impact: 'minor', state: 'resolved' }])).toBe('operational');
    expect(overallOf(['up'], [{ impact: 'maintenance', state: 'in_progress' }])).toBe('maintenance');
    expect(overallOf(['up'], [{ impact: 'maintenance', state: 'scheduled' }])).toBe('operational');
    expect(overallOf(['up'], [{ impact: 'major', state: 'identified' }])).toBe('outage');
  });
});
