/**
 * Copy a SampTrek PostgreSQL database (the versions before MongoDB) into MongoDB
 * (docs/POSTGRES_TO_MONGODB.md). The PostgreSQL database is only read, never changed.
 *
 *   pnpm import-postgres --from "postgresql://user:pass@host:5432/projexa" --dry-run
 *   pnpm import-postgres --from "postgresql://user:pass@host:5432/projexa"
 *   pnpm import-postgres --from "postgresql://user:pass@host:5432/projexa" --verify
 *
 * The MongoDB database is DATABASE_URL. --from can also come from POSTGRES_URL.
 *   --dry-run   read and convert everything, write nothing, show what would be copied
 *   --verify    only compare: every record in MongoDB against PostgreSQL
 *   --force     copy into a MongoDB database that already has data from somewhere else
 *   --batch N   rows per batch (default 1000)
 *   --only A,B  only these models (for trying it out)
 *
 * Running it again is safe: records are written by their id, so they are brought up to date, never doubled.
 */
import 'dotenv/config';
import { MongoClient, type Db } from 'mongodb';
import { PrismaClient } from '../src/prisma/client';
import { syncIndexes } from '../src/prisma/indexes';
import { ImportError, LAST_POSTGRES_MIGRATION, importPlan, importPostgres, verified, verifyImport, type ImportReport } from '../src/prisma/pg-import';
import { PgSource, redactUrl } from '../src/prisma/pg-source';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** Documents already in the app's collections (not counting counters and the schema version). */
async function existingData(db: Db): Promise<number> {
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  let n = 0;
  for (const p of importPlan()) if (names.has(p.collection)) n += await db.collection(p.collection).countDocuments({}, { limit: 1 });
  return n;
}

function summary(r: ImportReport) {
  const withRows = r.models.filter((m) => (m.source ?? 0) > 0);
  const total = r.models.reduce((s, m) => s + (m.source ?? 0), 0);
  console.log(`\n${withRows.length} tables with data, ${total} records in all.`);
  const defaulted = r.models.filter((m) => m.defaulted.length);
  if (defaulted.length) console.log(`Filled with defaults (columns the old database did not have): ${defaulted.map((m) => `${m.model}.{${m.defaulted.join(',')}}`).join(' ')}`);
  const dropped = r.models.filter((m) => m.droppedColumns.length);
  if (dropped.length) console.log(`Not copied (columns the MongoDB version no longer has): ${dropped.map((m) => `${m.model}.{${m.droppedColumns.join(',')}}`).join(' ')}`);
  if (r.unknownTables.length) console.log(`Tables not copied (not part of SampTrek): ${r.unknownTables.join(', ')}`);
  if (Object.keys(r.counters).length) console.log(`Counters: ${Object.entries(r.counters).map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

async function main() {
  const from = flag('from') ?? process.env.POSTGRES_URL;
  const to = process.env.DATABASE_URL;
  if (!from || !/^postgres(ql)?:\/\//.test(from)) throw new ImportError('Give the old database: --from "postgresql://user:password@host:5432/projexa" (or POSTGRES_URL).');
  if (!to || !/^mongodb(\+srv)?:\/\//.test(to)) throw new ImportError('DATABASE_URL must be the new MongoDB database (mongodb://...?replicaSet=rs0).');
  const dryRun = has('dry-run');
  const verifyOnly = has('verify');
  const only = flag('only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const batchSize = Number(flag('batch') ?? 1000);
  const log = (line: string) => console.log(line);

  console.log(`From PostgreSQL: ${redactUrl(from)}`);
  console.log(`To MongoDB:      ${redactUrl(to)}`);
  const source = await PgSource.connect(from);
  const mongo = await MongoClient.connect(to);
  const db = mongo.db();
  try {
    const last = await source.lastMigration();
    console.log(`Old database version: ${last ?? 'unknown (no _prisma_migrations table)'}`);
    if (last && last < LAST_POSTGRES_MIGRATION) console.log(`  Older than the last PostgreSQL version (${LAST_POSTGRES_MIGRATION}). Missing columns get their defaults; updating the old server first is better.`);

    if (verifyOnly) {
      const r = await verifyImport(source, db, { only, batchSize, log });
      const ok = verified(r);
      console.log(ok ? '\nVerified: MongoDB holds exactly what PostgreSQL holds.' : '\nNOT the same. See the DIFF lines above; run the import again, then verify.');
      process.exitCode = ok ? 0 : 1;
      return;
    }

    if (!dryRun) {
      const marker = await db.collection<{ _id: string }>('_import').findOne({ _id: 'postgres' });
      const existing = await existingData(db);
      if (existing && !marker && !has('force'))
        throw new ImportError('The MongoDB database already has data that did not come from this import (for example from create-admin). Use an empty database, or add --force to copy into it anyway.');
      const prisma = new PrismaClient({ datasources: { db: { url: to } } });
      try {
        const n = await syncIndexes(prisma);
        console.log(`MongoDB collections and indexes ready (${n} indexes).`);
      } finally {
        await prisma.$disconnect();
      }
      await db.collection<{ _id: string }>('_import').updateOne(
        { _id: 'postgres' },
        { $set: { source: redactUrl(from), lastMigration: last, startedAt: new Date(), finishedAt: null } },
        { upsert: true },
      );
    }

    const report = await importPostgres(source, db, { dryRun, only, batchSize, log });
    summary(report);
    if (dryRun) {
      console.log('\nDry run: nothing was written. Run again without --dry-run to copy.');
      return;
    }
    await db.collection<{ _id: string }>('_import').updateOne(
      { _id: 'postgres' },
      { $set: { finishedAt: new Date(), counts: Object.fromEntries(report.models.map((m) => [m.model, m.written])) } },
    );
    console.log('\nCopied. Checking every record...');
    const check = await verifyImport(source, db, { only, batchSize, log: (l) => (l.startsWith('OK') ? undefined : console.log(l)) });
    const ok = verified(check);
    console.log(ok ? `Verified: all ${check.models.reduce((s, m) => s + (m.matched ?? 0), 0)} records match PostgreSQL.` : 'NOT the same. See the DIFF lines above.');
    process.exitCode = ok ? 0 : 1;
  } finally {
    await source.close();
    await mongo.close();
  }
}

main().catch((e) => {
  const code = (e as { code?: number }).code;
  const pgCode = (e as { code?: string }).code;
  if (e instanceof ImportError) console.error(`\n${e.message}`);
  else if (pgCode === '28P01' || pgCode === '28000') console.error('\nPostgreSQL refused the user name or password in --from.');
  else if (pgCode === '3D000') console.error('\nThat PostgreSQL database does not exist (check the name at the end of --from).');
  else if (pgCode === 'ECONNREFUSED' || pgCode === 'ENOTFOUND' || pgCode === 'ETIMEDOUT') console.error(`\nCannot reach the database: ${(e as Error).message}`);
  else if (code === 11000) console.error(`\nA record clashes with one already in MongoDB (same unique value, different id): ${(e as Error).message}\nUse an empty MongoDB database for the import.`);
  else console.error(e);
  process.exit(1);
});
