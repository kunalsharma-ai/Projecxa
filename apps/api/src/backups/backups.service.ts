/**
 * Super Admin → Backups (docs/BACKUPS.md): one-click and scheduled copies of the whole database, kept
 * in the storage chosen in Settings → Integrations → Backup storage, and a guarded restore.
 *
 * A restore always takes a safety backup first, checks the file's fingerprint, and replaces the
 * database in one transaction: it either fully works or changes nothing.
 */
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Backup, IntegrationSetting, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createReadStream, promises as fs } from 'fs';
import { join, resolve } from 'path';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { IntegrationsService } from '../integrations/integrations.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { esc } from '../super-admin/super-admin.service';
import { config } from '../common/config';
import {
  backupName, decryptFile, dumpTo, encryptFile, execText, inspectDump, isEncryptedFile, Manifest, manifestName, newestMigration, pgDumpVersion, pgTarget, restoreFrom, sha256File, workDir,
} from './backup-core';
import { BackupStorage } from './storage';

export interface BackupSettings {
  /** off | daily | weekly */
  schedule: 'off' | 'daily' | 'weekly';
  /** Hour of the day, UTC (0–23). */
  hour: number;
  /** 0 = Sunday … 6 = Saturday, for weekly. */
  weekday: number;
  /** How many backups to keep; older ones are deleted after each new one. */
  keep: number;
  /** Email the Super Admins when a backup fails. */
  notifyOnFailure: boolean;
  /** When the schedule was last changed: slots before it are not caught up. */
  since?: string;
}
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { schedule: 'off', hour: 2, weekday: 0, keep: 14, notifyOnFailure: true };

export const RESTORE_WORD = 'RESTORE';
const STALE_MS = 6 * 3_600_000;

/** The start of the latest scheduled slot at or before `now` (UTC), or null when the schedule is off. */
export function latestSlot(s: Pick<BackupSettings, 'schedule' | 'hour' | 'weekday'>, now: Date): Date | null {
  if (s.schedule === 'off') return null;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), s.hour));
  if (d > now) d.setUTCDate(d.getUTCDate() - 1);
  if (s.schedule === 'weekly') while (d.getUTCDay() !== s.weekday) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}
export function nextSlot(s: Pick<BackupSettings, 'schedule' | 'hour' | 'weekday'>, now: Date): Date | null {
  const last = latestSlot(s, now);
  if (!last) return null;
  const n = new Date(last);
  n.setUTCDate(n.getUTCDate() + (s.schedule === 'weekly' ? 7 : 1));
  return n;
}

type RestoreStep = 'safety_backup' | 'download' | 'check' | 'restore' | 'migrate' | 'done';
export interface RestoreState {
  backupId: string; backupName: string; by: string; startedAt: string; finishedAt: string | null;
  state: 'running' | 'ok' | 'failed'; step: RestoreStep; message: string | null; safetyBackup: string | null;
}

@Injectable()
export class BackupsService implements OnModuleInit {
  private readonly log = new Logger(BackupsService.name);
  private busy: Promise<unknown> | null = null;
  private busyWith: 'backup' | 'restore' | null = null;
  restoreState: RestoreState | null = null;
  /** Swapped in tests. */
  now: () => Date = () => new Date();
  /** Runs `prisma migrate deploy` after restoring an older backup; swapped in tests. */
  migrate: () => Promise<string> = async () => {
    const cli = require.resolve('prisma/build/index.js', { paths: [process.cwd(), resolve(__dirname, '../..')] });
    return execText(process.execPath, [cli, 'migrate', 'deploy'], { cwd: resolve(__dirname, '../..'), timeout: 300_000 });
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async onModuleInit() {
    // A backup that was running when the server stopped will never finish.
    await this.prisma.backup.updateMany({ where: { status: 'running', startedAt: { lt: new Date(Date.now() - STALE_MS) } }, data: { status: 'failed', error: 'The server stopped during this backup', finishedAt: new Date() } }).catch(() => undefined);
  }

  private get db() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new BadRequestException('DATABASE_URL is not set');
    return pgTarget(url);
  }

  // ───────────── Settings ─────────────

  async settings(): Promise<BackupSettings> {
    const owner = await this.integrations.ownerId();
    const o = owner ? await this.prisma.organization.findUnique({ where: { id: owner }, select: { platformSettings: true } }) : null;
    const saved = ((o?.platformSettings ?? {}) as { backups?: Partial<BackupSettings> }).backups ?? {};
    return { ...DEFAULT_BACKUP_SETTINGS, ...saved };
  }

  async saveSettings(u: AuthUser, body: Partial<BackupSettings>) {
    const owner = await this.integrations.ownerId();
    if (!owner) throw new BadRequestException('No organisation runs this server yet');
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: owner }, select: { platformSettings: true } });
    const all = (o.platformSettings ?? {}) as Record<string, unknown>;
    const before = await this.settings();
    const next: BackupSettings = { ...before, ...body };
    if (next.schedule !== before.schedule || next.hour !== before.hour || next.weekday !== before.weekday) next.since = this.now().toISOString();
    if (next.schedule !== 'off' && !(await this.integrations.backupStorage())) throw new BadRequestException('Choose where to keep backups first: Settings → Integrations → Backup storage');
    await this.prisma.organization.update({ where: { id: owner }, data: { platformSettings: { ...all, backups: next } as unknown as Prisma.InputJsonValue } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'backup.settings', entityType: 'Backup', entityId: 'settings', detail: { schedule: next.schedule, hour: next.hour, weekday: next.weekday, keep: next.keep } });
    return this.overview();
  }

  // ───────────── Screen ─────────────

  async overview() {
    const [settings, storage, rows, tool] = await Promise.all([
      this.settings(),
      this.integrations.backupStorage().catch((e: Error) => ({ error: e.message })),
      this.prisma.backup.findMany({ orderBy: { startedAt: 'desc' }, take: 200 }),
      pgDumpVersion().then((v) => ({ ok: true, message: v }), (e: Error) => ({ ok: false, message: e.message })),
    ]);
    const row = await this.prisma.integrationSetting.findFirst({ where: { kind: 'backup_storage', organization: { platformOwner: true } }, select: { lastTestOk: true, lastTestAt: true, lastTestMessage: true } });
    const s = storage && !('error' in storage) ? storage : null;
    const last = rows.find((b) => b.status === 'ok');
    return {
      settings,
      nextRunAt: s ? nextSlot(settings, this.now()) : null,
      storage: {
        configured: !!s,
        error: storage && 'error' in storage ? storage.error : null,
        target: s?.target ?? null,
        where: s?.storage.where ?? null,
        encrypted: !!s?.passphrase,
        source: s?.source ?? null,
        lastTestOk: row?.lastTestOk ?? null, lastTestAt: row?.lastTestAt ?? null, lastTestMessage: row?.lastTestMessage ?? null,
      },
      tool,
      database: { name: this.safeDb()?.database ?? null, host: this.safeDb()?.host ?? null },
      running: this.busyWith,
      restore: this.restoreState,
      lastOkAt: last?.finishedAt ?? null,
      backups: rows.map((b) => this.view(b)),
      restoreWord: RESTORE_WORD,
    };
  }

  private safeDb() {
    try { return this.db; } catch { return null; }
  }

  view(b: Backup) {
    return { ...b, sizeBytes: b.sizeBytes === null ? null : Number(b.sizeBytes) };
  }

  /** The newest finished backup, for the Super Admin overview and the status of backups. */
  async latest() {
    return this.prisma.backup.findFirst({ where: { status: 'ok' }, orderBy: { startedAt: 'desc' } });
  }

  // ───────────── Taking a backup ─────────────

  private async storage(): Promise<{ storage: BackupStorage; passphrase: string | null; target: string }> {
    const s = await this.integrations.backupStorage();
    if (!s) throw new BadRequestException('Choose where to keep backups first: Settings → Integrations → Backup storage');
    return s;
  }

  /** Starts a backup in the background and returns its row at once; the screen polls for the result. */
  async start(u: AuthUser | null, trigger: 'manual' | 'scheduled' | 'cli' = 'manual') {
    if (this.busy) throw new ConflictException(this.busyWith === 'restore' ? 'A restore is running. Wait until it has finished.' : 'A backup is already running.');
    const s = await this.storage();
    const row = await this.createRow(u, trigger, s);
    const job = this.runBackup(row, s).finally(() => { this.busy = null; this.busyWith = null; });
    this.busy = job;
    this.busyWith = 'backup';
    job.catch(() => undefined);
    return this.view(row);
  }

  /** Waits for whatever is running (tests, and the command line). */
  async idle() {
    while (this.busy) await this.busy.catch(() => undefined);
  }

  private async createRow(u: AuthUser | null, trigger: string, s: { passphrase: string | null; target: string }) {
    const name = backupName(this.now(), !!s.passphrase);
    return this.prisma.backup.create({ data: { name, trigger, status: 'running', target: s.target, encrypted: !!s.passphrase, createdById: u?.id ?? null, createdBy: u?.name ?? (trigger === 'scheduled' ? 'Schedule' : null), startedAt: this.now() } });
  }

  /** Dump → check → encrypt → upload with its manifest → prune. Updates the row either way. */
  private async runBackup(row: Backup, s: { storage: BackupStorage; passphrase: string | null }): Promise<Backup> {
    const started = Date.now();
    const { dir, cleanup } = await workDir();
    try {
      const db = this.db;
      const plain = join(dir, 'db.dump');
      const migration = await newestMigration(db).catch(() => null);
      await dumpTo(db, plain);
      const { tables } = await inspectDump(plain);
      let file = plain;
      if (s.passphrase) {
        file = join(dir, 'db.dump.enc');
        await encryptFile(plain, file, s.passphrase);
      }
      const { size } = await fs.stat(file);
      const sha256 = await sha256File(file);
      await s.storage.put(row.name, file);
      const manifest: Manifest = {
        app: 'samptrek', version: 1, name: row.name, trigger: row.trigger, createdAt: row.startedAt.toISOString(), createdBy: row.createdBy,
        sizeBytes: size, sha256, encrypted: !!s.passphrase, migration, tables, database: db.database,
      };
      await s.storage.putText(manifestName(row.name), JSON.stringify(manifest, null, 2));
      const done = await this.prisma.backup.update({ where: { id: row.id }, data: { status: 'ok', sizeBytes: BigInt(size), sha256, migration, tables, durationMs: Date.now() - started, finishedAt: new Date() } });
      this.log.log(`Backup ${row.name} done (${Math.round(size / 1024)} KB, ${tables} tables)`);
      await this.prune(s.storage).catch((e: Error) => this.log.warn(`Could not delete old backups: ${e.message}`));
      return done;
    } catch (e) {
      const message = (e as Error).message.slice(0, 1000);
      this.log.error(`Backup ${row.name} failed: ${message}`);
      const failed = await this.prisma.backup.update({ where: { id: row.id }, data: { status: 'failed', error: message, durationMs: Date.now() - started, finishedAt: new Date() } });
      if (row.trigger !== 'before_restore') await this.notifyFailure(failed).catch(() => undefined);
      throw e;
    } finally {
      await cleanup();
    }
  }

  /** Keeps the newest `keep` good backups (safety copies taken before a restore included) and deletes the rest. */
  private async prune(storage: BackupStorage) {
    const { keep } = await this.settings();
    const old = await this.prisma.backup.findMany({ where: { status: 'ok' }, orderBy: { startedAt: 'desc' }, skip: keep });
    for (const b of old) {
      await storage.remove(b.name);
      await storage.remove(manifestName(b.name));
      await this.prisma.backup.delete({ where: { id: b.id } });
    }
    // Failed attempts are kept for 30 days to show what went wrong.
    await this.prisma.backup.deleteMany({ where: { status: 'failed', startedAt: { lt: new Date(this.now().getTime() - 30 * 86_400_000) } } });
  }

  private async notifyFailure(b: Backup) {
    if (!(await this.settings()).notifyOnFailure) return;
    const owner = await this.integrations.ownerId();
    if (!owner) return;
    const people = await this.prisma.user.findMany({ where: { superAdmin: true, active: true, organization: { platformOwner: true } }, select: { email: true } });
    if (!people.length) return;
    const link = `${config.webOrigins[0] ?? ''}/super-admin/backups`;
    await this.mail.send({
      organizationId: owner, to: people.map((p) => p.email),
      subject: 'SampTrek backup failed',
      text: `The ${b.trigger} database backup at ${b.startedAt.toISOString()} failed:\n\n${b.error}\n\nOpen ${link} to try again.`,
      html: `<p>The ${esc(b.trigger)} database backup at ${esc(b.startedAt.toISOString())} failed:</p><pre style="white-space:pre-wrap">${esc(b.error ?? '')}</pre><p><a href="${esc(link)}">Open Backups</a> to try again.</p>`,
    });
  }

  @Interval(5 * 60_000)
  async tick() {
    if (process.env.BACKUP_SCHEDULER_ENABLED === 'false') return;
    await this.runDue().catch((e: Error) => this.log.warn(`Scheduled backup: ${e.message}`));
  }

  /** Takes the scheduled backup when its slot has passed and none was taken for it. */
  async runDue(): Promise<Backup | null> {
    const s = await this.settings();
    const slot = latestSlot(s, this.now());
    if (!slot || this.busy) return null;
    if (s.since && new Date(s.since) > slot) return null;
    const taken = await this.prisma.backup.count({ where: { trigger: 'scheduled', startedAt: { gte: slot } } });
    if (taken) return null;
    const row = await this.start(null, 'scheduled');
    await this.idle();
    return this.prisma.backup.findUnique({ where: { id: row.id } });
  }

  // ───────────── Using a backup ─────────────

  private async one(id: string) {
    const b = await this.prisma.backup.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Backup not found');
    return b;
  }

  /** Fetches the stored file and checks its fingerprint. Returns the plain dump's path in `dir`. */
  private async fetch(b: Backup, s: { storage: BackupStorage; passphrase: string | null }, dir: string): Promise<string> {
    if (b.status !== 'ok') throw new BadRequestException('This backup did not finish, so it cannot be used');
    const stored = join(dir, 'stored');
    await s.storage.get(b.name, stored).catch((e: Error) => { throw new BadRequestException(`Could not fetch ${b.name} from ${s.storage.where}: ${e.message}`); });
    if (b.sha256 && (await sha256File(stored)) !== b.sha256) throw new BadRequestException('The backup file has changed since it was made (its fingerprint does not match). It will not be used.');
    if (!(await isEncryptedFile(stored))) return stored;
    if (!s.passphrase) throw new BadRequestException('This backup is encrypted. Enter its passphrase in Settings → Integrations → Backup storage.');
    const plain = join(dir, 'plain.dump');
    await decryptFile(stored, plain, s.passphrase).catch((e: Error) => { throw new BadRequestException(`${e.message}. If the passphrase was changed, enter the one used when this backup was made.`); });
    return plain;
  }

  /** Test a backup without touching the database: fetch, fingerprint, decrypt, read every entry. */
  async verify(u: AuthUser, id: string) {
    const b = await this.one(id);
    const s = await this.storage();
    const { dir, cleanup } = await workDir();
    try {
      const plain = await this.fetch(b, s, dir);
      const r = await inspectDump(plain);
      await this.prisma.backup.update({ where: { id }, data: { lastVerifiedAt: new Date(), lastVerifyOk: true } });
      await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'backup.verified', entityType: 'Backup', entityId: id, detail: { name: b.name, ok: true } });
      return { ok: true, message: `The backup is complete and readable: ${r.tables} tables, ${r.entries} items.`, backup: this.view(await this.one(id)) };
    } catch (e) {
      await this.prisma.backup.update({ where: { id }, data: { lastVerifiedAt: new Date(), lastVerifyOk: false } });
      return { ok: false, message: (e as Error).message, backup: this.view(await this.one(id)) };
    } finally {
      await cleanup();
    }
  }

  /** The stored file (encrypted if it was made encrypted), or the plain dump with `plain`. */
  async download(u: AuthUser, id: string, plain: boolean) {
    const b = await this.one(id);
    const s = await this.storage();
    const { dir, cleanup } = await workDir();
    try {
      let file: string;
      let name = b.name;
      if (plain) {
        file = await this.fetch(b, s, dir);
        name = b.name.replace(/\.enc$/, '');
      } else {
        if (b.status !== 'ok') throw new BadRequestException('This backup did not finish');
        file = join(dir, 'stored');
        await s.storage.get(b.name, file);
      }
      await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'backup.downloaded', entityType: 'Backup', entityId: id, detail: { name, plain } });
      const { size } = await fs.stat(file);
      const stream = createReadStream(file);
      stream.on('close', () => { cleanup().catch(() => undefined); });
      return { stream, name, size };
    } catch (e) {
      await cleanup();
      throw e;
    }
  }

  async remove(u: AuthUser, id: string) {
    const b = await this.one(id);
    if (b.status === 'running') throw new BadRequestException('This backup is still running');
    const s = await this.integrations.backupStorage();
    if (s && b.status === 'ok') {
      await s.storage.remove(b.name);
      await s.storage.remove(manifestName(b.name));
    }
    await this.prisma.backup.delete({ where: { id } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'backup.deleted', entityType: 'Backup', entityId: id, detail: { name: b.name } });
    return { ok: true };
  }

  /** Adds backups found in the storage (by their manifest) that the list does not know: a new server, or after a restore. */
  async rescan(u: AuthUser | null) {
    const s = await this.storage();
    const files = await s.storage.list();
    const known = new Set((await this.prisma.backup.findMany({ select: { name: true } })).map((b) => b.name));
    const names = new Set(files.map((f) => f.name));
    let added = 0;
    for (const f of files) {
      if (!f.name.endsWith('.json')) continue;
      const name = f.name.slice(0, -5);
      if (known.has(name) || !names.has(name)) continue;
      const text = await s.storage.getText(f.name).catch(() => null);
      let m: Manifest | null = null;
      try { m = text ? (JSON.parse(text) as Manifest) : null; } catch { m = null; }
      if (!m || m.app !== 'samptrek' || m.name !== name) continue;
      await this.prisma.backup.create({
        data: {
          name, trigger: m.trigger, status: 'ok', target: s.target, sizeBytes: BigInt(m.sizeBytes), sha256: m.sha256, encrypted: m.encrypted, migration: m.migration,
          tables: m.tables, createdBy: m.createdBy, startedAt: new Date(m.createdAt), finishedAt: new Date(m.createdAt),
        },
      });
      added++;
    }
    if (u) await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'backup.rescan', entityType: 'Backup', entityId: 'storage', detail: { added } });
    return { added, message: added ? `Found ${added} backup${added === 1 ? '' : 's'} in ${s.storage.where} and added ${added === 1 ? 'it' : 'them'} to the list.` : `No other backups in ${s.storage.where}.` };
  }

  // ───────────── Restore ─────────────

  /**
   * Guarded restore. The Super Admin types RESTORE and their password. Then, in the background:
   * a safety backup of the database as it is now, the backup is fetched and checked, the database is
   * replaced in one transaction, and newer migrations are applied if the backup is older.
   */
  async restore(u: AuthUser, id: string, body: { confirm: string; password: string }) {
    if (body.confirm.trim() !== RESTORE_WORD) throw new BadRequestException(`Type ${RESTORE_WORD} to confirm`);
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { passwordHash: true } });
    if (!me.passwordHash || !(await bcrypt.compare(body.password, me.passwordHash))) throw new BadRequestException('Your password is not right');
    if (this.busy) throw new ConflictException('A backup or restore is already running. Wait until it has finished.');
    const b = await this.one(id);
    if (b.status !== 'ok') throw new BadRequestException('This backup did not finish, so it cannot be restored');
    const current = await newestMigration(this.db).catch(() => null);
    if (b.migration && current && b.migration > current) {
      throw new BadRequestException(`This backup comes from a newer version of SampTrek (database version ${b.migration}). Update this server first, then restore.`);
    }
    const s = await this.storage();
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'backup.restore_started', entityType: 'Backup', entityId: id, detail: { name: b.name } });
    this.restoreState = { backupId: b.id, backupName: b.name, by: u.name, startedAt: this.now().toISOString(), finishedAt: null, state: 'running', step: 'safety_backup', message: null, safetyBackup: null };
    const job = this.runRestore(u, b, s, current).finally(() => { this.busy = null; this.busyWith = null; });
    this.busy = job;
    this.busyWith = 'restore';
    job.catch(() => undefined);
    return this.restoreState;
  }

  private async runRestore(u: AuthUser, b: Backup, s: { storage: BackupStorage; passphrase: string | null; target: string }, current: string | null) {
    const st = this.restoreState!;
    const { dir, cleanup } = await workDir();
    try {
      // 1. Safety copy of the database as it is now, so the restore itself can be undone.
      const safety = await this.runBackup(await this.createRow(u, 'before_restore', s), s);
      st.safetyBackup = safety.name;
      // 2–3. Fetch, check the fingerprint, decrypt, read it through.
      st.step = 'download';
      const plain = await this.fetch(b, s, dir);
      st.step = 'check';
      await inspectDump(plain);
      // Backups and uptime history are not in a backup; keep today's list across the restore.
      const keptBackups = await this.prisma.backup.findMany();
      const keptUptime = await this.prisma.uptimeCheck.findMany({ where: { at: { gte: new Date(Date.now() - 91 * 86_400_000) } } });
      // So is where backups are kept and their schedule: otherwise an older backup could leave the
      // safety copy just made out of reach.
      const keptStorage = await this.prisma.integrationSetting.findFirst({ where: { kind: 'backup_storage', organization: { platformOwner: true } } });
      const keptSettings = await this.settings();
      // 4. Replace the database in one transaction.
      st.step = 'restore';
      await restoreFrom(this.db, plain);
      await this.prisma.$disconnect();
      await this.prisma.$connect();
      // 5. A backup from an older version: bring the database up to this version.
      let migrated = '';
      if (b.migration && current && b.migration < current) {
        st.step = 'migrate';
        try {
          await this.migrate();
          migrated = ' Newer database changes were applied, so it matches this version of SampTrek.';
        } catch (e) {
          migrated = ` The backup is from an older version: run "pnpm db:deploy" on the server now and restart the API. (${(e as Error).message.slice(0, 200)})`;
        }
      }
      await this.putBack(keptBackups, keptUptime);
      await this.keepSetup(keptStorage, keptSettings).catch((e: Error) => this.log.warn(`Could not keep the backup storage settings: ${e.message}`));
      await this.prisma.backup.update({ where: { name: b.name }, data: { restoredAt: new Date() } }).catch(() => undefined);
      // The person may not exist in the restored data; the server owner's log gets the entry.
      const owner = await this.integrations.ownerId();
      if (owner) await this.audit.record({ organizationId: owner, actorId: (await this.prisma.user.findUnique({ where: { id: u.id }, select: { id: true } }))?.id ?? null, action: 'backup.restored', entityType: 'Backup', entityId: b.id, detail: { name: b.name, by: u.name, email: u.email, safetyBackup: safety.name } }).catch(() => undefined);
      st.step = 'done';
      st.state = 'ok';
      st.message = `Restored ${b.name}. A safety backup of the database from just before (${safety.name}) is in the list if you need to go back.${migrated}`;
      this.log.warn(`Database restored from ${b.name} by ${u.email}`);
    } catch (e) {
      st.state = 'failed';
      st.message = st.step === 'safety_backup'
        ? `Nothing was changed: the safety backup failed first (${(e as Error).message})`
        : `Nothing was changed: ${(e as Error).message}`;
      this.log.error(`Restore of ${b.name} failed at ${st.step}: ${(e as Error).message}`);
      throw e;
    } finally {
      st.finishedAt = new Date().toISOString();
      await cleanup();
    }
  }

  private async keepSetup(storage: IntegrationSetting | null, settings: BackupSettings) {
    const owner = await this.integrations.ownerId();
    if (!owner) return;
    if (storage) {
      const { id: _id, organizationId: _org, ...data } = storage;
      void _id; void _org;
      await this.prisma.integrationSetting.upsert({
        where: { organizationId_kind: { organizationId: owner, kind: 'backup_storage' } },
        create: { ...data, organizationId: owner, values: data.values as Prisma.InputJsonValue },
        update: { ...data, values: data.values as Prisma.InputJsonValue },
      });
    }
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: owner }, select: { platformSettings: true } });
    await this.prisma.organization.update({ where: { id: owner }, data: { platformSettings: { ...((o.platformSettings ?? {}) as object), backups: settings } as unknown as Prisma.InputJsonValue } });
  }

  private async putBack(backups: Backup[], uptime: { id: string; at: Date; components: Prisma.JsonValue; dbLatencyMs: number | null }[]) {
    for (let i = 0; i < backups.length; i += 500) await this.prisma.backup.createMany({ data: backups.slice(i, i + 500), skipDuplicates: true });
    for (let i = 0; i < uptime.length; i += 1000) {
      await this.prisma.uptimeCheck.createMany({ data: uptime.slice(i, i + 1000).map((x) => ({ ...x, components: x.components as Prisma.InputJsonValue })), skipDuplicates: true });
    }
  }
}
