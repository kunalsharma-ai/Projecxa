# Moving a server from PostgreSQL to MongoDB

SampTrek kept its data in PostgreSQL up to PR #73 (the package `samptrek-main-2026-11-09-PRs1-73.zip`
and older). From PR #74 it uses MongoDB 8 (`docs/MONGODB.md`). A server with real data on the old
version moves it with one command, `pnpm import-postgres`, which copies every table into MongoDB.

## What the import does

- **Copies everything.** Every table becomes its collection: organisations, users, clients, vendors,
  projects, quotas, allocations, respondents and their answers, redirects, invoices, bills, payables,
  integrations, chat, tasks, audit history, and so on (86 tables). Files and logos are stored in the
  database itself, so they come along.
- **Keeps every id.** A record has the same id in MongoDB as in PostgreSQL, so every link between
  records stays the same, and so do links people already have: respondent entry links, client unique
  links, dashboard links, API keys, webhooks.
- **Keeps the numbering.** Project codes, work orders, invoice and bill numbers carry on where they
  were. The chat message sequence and subscription invoice numbers continue after the last ones used.
- **Never changes PostgreSQL.** It only reads from it, in one read-only transaction, so it sees one
  consistent moment of the data.
- **Can be run again.** Records are written by id: a second run brings them up to date and never
  doubles anything. If it stops halfway (network, disk), just run it again.
- **Checks its work.** After copying, it reads every record again from PostgreSQL and compares it with
  MongoDB, field by field, and prints the counts. `--dry-run` first shows what would be copied and
  writes nothing.

Things it changes on the way, as the MongoDB version expects: money becomes a number with the same
decimals; a chat member gets an id of its own (made from the channel and person, so it is the same on
every run); blocked IP ranges get their first and last address. A server on an older PostgreSQL
version gets defaults for the columns it did not have yet, and the import lists them.

## Before you start

- **The secrets stay the same.** Copy the old `.env` values to the new install: above all
  `MFA_ENCRYPTION_KEY` (without it saved integration secrets and authenticator apps cannot be read),
  `JWT_SECRET`, `INTEGRATIONS_ENCRYPTION_KEY` and `ACCOUNTING_ENCRYPTION_KEY` if they are set, and the
  mail, SSO and storage settings. Only `DATABASE_URL` changes.
- **Downtime.** The app is stopped while the data is copied. Count roughly a minute per few hundred
  thousand respondent sessions; a small server takes seconds. Do it at a quiet hour.
- **Old backups.** Backups made by the PostgreSQL version (`.dump` files) cannot be restored into the
  MongoDB version. Keep them; if you ever need one, restore it into a PostgreSQL database and import
  from there.
- **An empty MongoDB database.** Do not run `pnpm create-admin` or `pnpm db:seed` on the new database
  first: the admin and organisation come from PostgreSQL. The import refuses a database that already
  has other data (`--force` overrides that).

## Step by step

Commands are run on the server, as the user that runs SampTrek. `OLD` is the current install folder,
`NEW` a new one for the MongoDB package. The PostgreSQL address is the `DATABASE_URL` in `OLD/.env`
(or `OLD/apps/api/.env`).

**1. Back up PostgreSQL.**

```bash
pg_dump -Fc "postgresql://USER:PASSWORD@localhost:5432/projexa" -f ~/samptrek-before-mongodb.dump
```

**2. Bring the old database to the last PostgreSQL version** (skip it if the server already runs the
`2026-11-09-PRs1-73` package). Unzip `samptrek-main-2026-11-09-PRs1-73.zip` over `OLD` (keep the
`.env` files), then:

```bash
cd OLD && pnpm install --frozen-lockfile && pnpm --filter @projexa/api prisma:deploy
```

The import also works on an older database (it fills the missing columns with their defaults and says
so), but this step makes the copy exact.

**3. Install MongoDB 8 as a replica set** (INSTALL.md, "Database"): for example the `mongodb-org`
packages, then in `/etc/mongod.conf` set `replication: { replSetName: rs0 }`, restart `mongod`, and run
`mongosh --eval 'rs.initiate()'` once. Install the MongoDB Database Tools as well (backups use them).

**4. Install the new package in `NEW`.** Unzip `samptrek-main.zip`, copy `OLD/.env` (and
`OLD/apps/*/.env`) into it, and change only:

```bash
DATABASE_URL="mongodb://127.0.0.1:27017/projexa?replicaSet=rs0"
```

```bash
cd NEW && pnpm install --frozen-lockfile && pnpm --filter @projexa/api prisma:generate
```

**5. Dry run** (the app can still be running):

```bash
cd NEW && pnpm import-postgres --from "postgresql://USER:PASSWORD@localhost:5432/projexa" --dry-run
```

It prints each table with its number of records and anything it fills or leaves out, and writes
nothing. Stop here if it reports an error.

**6. Stop the old app**, so nothing changes during the copy:

```bash
pm2 list                          # the names, e.g. samptrek-api / samptrek-web (older: projexa-api / projexa-web)
pm2 stop samptrek-api samptrek-web
```

**7. Copy:**

```bash
pnpm import-postgres --from "postgresql://USER:PASSWORD@localhost:5432/projexa"
```

It creates the collections and indexes, copies every table, then checks every record. It ends with
`Verified: all N records match PostgreSQL.` and exit code 0. On `NOT the same`, run step 7 again; the
lines starting with `DIFF` name the tables.

**8. Start the new version.**

```bash
cd NEW && pnpm --filter @projexa/api build && pnpm --filter @projexa/web build
pm2 delete samptrek-api samptrek-web
NODE_ENV=production pm2 start "node dist/main.js" --name samptrek-api --cwd NEW/apps/api
NODE_ENV=production pm2 start "pnpm start" --name samptrek-web --cwd NEW/apps/web
pm2 save
```

Sign in, open a project, its respondents and an invoice, and try a respondent entry link. Then take
the first MongoDB backup in Super Admin → Backups.

**9. Keep PostgreSQL for a while.** Leave the old database and `OLD` folder untouched for a few weeks.
To go back, stop the new app and start the old one again: PostgreSQL still holds everything up to
step 6 (anything entered in the new version afterwards is only in MongoDB).

## Options

| Option | What it does |
| --- | --- |
| `--from URL` | The PostgreSQL database (or set `POSTGRES_URL`). A `?schema=` in the URL is used. |
| `--dry-run` | Read and convert everything, write nothing. |
| `--verify` | Only compare MongoDB with PostgreSQL, record by record. Exit code 1 if anything differs. |
| `--force` | Copy into a MongoDB database that already has other data. |
| `--batch N` | Rows read and written at a time (default 1000). |
| `--only A,B` | Only these models, e.g. `--only Organization,User` for a quick try. |

The MongoDB database is `DATABASE_URL`. The PostgreSQL database can be on another machine: give its
address, or use an SSH tunnel (`ssh -L 5433:localhost:5432 old-server`, then `--from
postgresql://...@localhost:5433/projexa`).

The import notes when it ran in the `_import` collection (`source` without the password, times, counts).

## How it works

`apps/api/src/prisma/pg-import.ts` builds the plan from the Prisma schema: PostgreSQL had one table per
model and one column per field with the same names, so each model is read from its table in primary key
order, in batches, and written with `replaceOne(..., { upsert: true })` by `_id`. Values are converted
the way the app writes them: NUMERIC to numbers, BIGINT to 64-bit integers, BYTEA to binary, timestamps
read as UTC (Prisma stored UTC without a zone), NULL as `null`. `src/prisma/pg-source.ts` reads
PostgreSQL. Tests: `test/e2e/pg-import.e2e.spec.ts`.
