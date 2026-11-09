/**
 * Backups from the command line (docs/BACKUPS.md). Normally you use Super Admin → Backups; these are
 * for a server cron job and for getting a database back when the app itself cannot start.
 *
 *   pnpm backup                                   one backup to the storage set in Settings → Integrations
 *   pnpm restore-backup --file <backup> [--yes]   replace the database with a downloaded backup file
 *   pnpm restore-backup --decrypt <backup> --out <plain.dump>
 *
 * An encrypted backup (.enc) asks for its passphrase, or reads BACKUP_PASSPHRASE. The restore keeps a copy
 * of the database first: it either works completely or puts the database back as it was.
 */
import 'dotenv/config';
import { existsSync } from 'fs';
import { createInterface } from 'readline';
import { dbTarget, decryptFile, inspectDump, isEncryptedFile, restoreFrom, schemaVersion, workDir } from '../src/backups/backup-core';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

async function passphrase(): Promise<string> {
  if (process.env.BACKUP_PASSPHRASE) return process.env.BACKUP_PASSPHRASE;
  if (!process.stdin.isTTY) throw new Error('This backup is encrypted: set BACKUP_PASSPHRASE');
  return ask('Backup passphrase: ', true);
}

async function backup() {
  process.env.BACKUP_SCHEDULER_ENABLED = 'false';
  process.env.STATUS_CHECKS_ENABLED = 'false';
  process.env.CALLBACK_WORKER_ENABLED = 'false';
  process.env.REPORT_SCHEDULER_ENABLED = 'false';
  process.env.MONITOR_ENABLED = 'false';
  process.env.AUTOMATION_SCHEDULER_ENABLED = 'false';
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module');
  const { BackupsService } = await import('../src/backups/backups.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const svc = app.get(BackupsService);
    const row = await svc.start(null, 'cli');
    await svc.idle();
    const done = (await svc.overview()).backups.find((b) => b.id === row.id);
    if (done?.status !== 'ok') throw new Error(done?.error ?? 'The backup failed');
    console.log(`Backup ${done.name} done (${Math.round((done.sizeBytes ?? 0) / 1024)} KB) in ${(await svc.overview()).storage.where}.`);
  } finally {
    await app.close();
  }
}

async function restore() {
  const file = flag('file');
  if (!file || !existsSync(file)) throw new Error('Give the backup file: pnpm restore-backup --file /path/to/samptrek-….dump(.enc)');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = dbTarget(url);
  const { dir, cleanup } = await workDir();
  try {
    let plain = file;
    if (await isEncryptedFile(file)) {
      plain = `${dir}/plain.dump`;
      await decryptFile(file, plain, await passphrase());
    }
    const info = await inspectDump(plain);
    const current = await schemaVersion(db).catch(() => null);
    console.log(`Backup: ${info.tables} tables. Database: ${db.database} on ${db.host}${current ? ` (version ${current})` : ' (empty)'}.`);
    if (!has('yes')) {
      if (!process.stdin.isTTY) throw new Error('Add --yes to restore without a prompt');
      const word = await ask(`This REPLACES everything in ${db.database}. Type RESTORE to go on: `);
      if (word !== 'RESTORE') throw new Error('Stopped. Nothing was changed.');
    }
    await restoreFrom(db, plain);
    console.log('Restored, with the collections and indexes of this version. Restart the API.');
    console.log('Then open Super Admin → Backups and press "Find backups in storage" to see your backups again.');
  } finally {
    await cleanup();
  }
}

async function decrypt() {
  const file = flag('decrypt');
  const out = flag('out');
  if (!file || !out) throw new Error('pnpm restore-backup --decrypt <backup.dump.enc> --out <plain.dump>');
  await decryptFile(file, out, await passphrase());
  await inspectDump(out);
  console.log(`Wrote ${out}. Restore it with mongorestore --archive --gzip, or with: pnpm restore-backup --file ${out}`);
}

const cmd = process.argv[2];
(cmd === 'backup' ? backup() : flag('decrypt') ? decrypt() : restore()).then(
  () => process.exit(0),
  (e: Error) => { console.error(e.message); process.exit(1); },
);
