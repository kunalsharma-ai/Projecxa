# MongoDB in place of PostgreSQL

Status: accepted (2026-11-09). SampTrek's data moved from PostgreSQL 16 to MongoDB 8, as the other
Sampledge systems did (SampAudience first, then SampCode).

## What stays the same

- NestJS 11 on Express, Prisma 6 (provider `mongodb`), every API route and response shape.
- The integrations: signed SampAudience links and verified completes, the SampAudience
  `project.created` notice, vendor callbacks, client unique links, SampBidX, Zoho Books.
- The rules PostgreSQL enforced: unique keys, "only one outcome per session", "never more completes
  than the target", "a unique link is given to one session only".

## How PostgreSQL behaviour is kept

All of it is in `apps/api/src/prisma/`. Use `PrismaClient` from `src/prisma/client` (or
`PrismaService`), never `new PrismaClient()` from `@prisma/client`.

- **Schema** (`prisma/schema.prisma`): every id maps to `_id`. `ChatMember`'s composite primary key
  became `@@unique` with its own `id`. Two self-referencing relations (`Project.activeRedirectVersion`,
  `Task.blockedBy`) use `NoAction`, because Prisma emulates referential actions on MongoDB and refuses
  cycles. `IpReputationRange` keeps each range's first and last address (`rangeStart`, `rangeEnd`, 32
  hex digits) in place of PostgreSQL's `inet` type.
- **Money.** MongoDB has no NUMERIC. Money fields are numbers rounded to the scale their NUMERIC
  column had (2 places, 4 for won bid amounts, 8 for exchange rates) on every write (`MONEY_SCALES`
  in `compat.ts`).
- **NULL.** PostgreSQL rows have every column; Prisma leaves unset optional fields out of a MongoDB
  document, and `{ field: null }` does not match a missing field. Every create writes `null` for the
  optional fields it was not given (nested creates too). A create that only connects relations by id
  is written with the foreign keys themselves, so those are null as well when unset.
- **Comparisons.** Prisma compares through aggregation expressions on MongoDB, where null is lower
  than every value: `lt`, `lte`, `not`, `notIn` and anything under `NOT` would match nulls. Every
  filter is rewritten to leave null out, as PostgreSQL did (`fixWhere`).
- **Sequences.** `ChatMessage.seq` (autoincrement) and the billing invoice numbers come from the
  `counters` collection (`nextSequence`), with one atomic `findAndModify` each.
- **Row locks.** Two MongoDB transactions writing the same document: one aborts with a write conflict
  (`P2034`) where PostgreSQL made it wait. `PrismaService.$transaction` runs it again, up to 8 times.
  Quota and target checks (`completes < target`) are one update that compares two fields.
- **`FOR UPDATE SKIP LOCKED`** (the client unique link handed to a session) became `claim()` in
  `mongo-compat.ts`: an update that only succeeds while the document still matches, trying the next
  candidate when another request won.
- **`ON CONFLICT DO NOTHING`.** `createMany({ skipDuplicates })` does not exist on MongoDB;
  `createManySkipDuplicates()` reads the unique keys from the schema and inserts only documents that do
  not clash, also under races.
- **JSON filters** (`path`) are not supported on MongoDB: `idsMatching()` finds the ids with a raw
  filter first.
- **Reports.** The SQL reports (fieldwork reports, finance tiles, payables, the dashboard widgets,
  redirect health, the fieldwork monitor, AI usage, traffic, uptime) are aggregation pipelines
  (`agg.ts`) or Prisma `groupBy` with the few related documents looked up after
  (`session-totals.ts`). Medians and percentiles are PostgreSQL's `percentile_cont` (interpolated),
  computed in `percentileCont()`.
- **Sorting.** PostgreSQL sorted NULL last ascending; MongoDB sorts it first. Where a screen relied
  on `nulls: 'last'` (templates, API keys, tasks, field end dates) the order is kept explicitly.

## Indexes instead of migrations

`pnpm db:deploy` (and `pnpm db:migrate` in development) runs `src/prisma/indexes.ts`: it reads
`schema.prisma` and creates every collection and index. Unique indexes on optional fields are partial,
so any number of documents can leave the field empty, as in PostgreSQL. Running it again does nothing.
It also records the schema version (`SCHEMA_VERSION`) in the `_schema` collection; backups carry it.
The SQL migrations were removed, and `prisma db push` is not used.

## Running it

- MongoDB 8.0 or newer as a **replica set** (Prisma needs one for transactions). Locally
  `docker compose up -d mongo` starts a one-member set `rs0`; CI starts the same with `docker run`.
- `DATABASE_URL=mongodb://localhost:27017/projexa?replicaSet=rs0` (it must name the database).
- Tests use `TEST_DATABASE_URL` (a `*_test` database), and `test/global-setup.ts` creates its
  collections and indexes.
- Backups are `mongodump`/`mongorestore` archives (docs/BACKUPS.md).

## Moving an existing server

There is no in-place conversion of a PostgreSQL database. `pnpm import-postgres --from <postgresql URL>`
copies all of it into MongoDB, keeping every id, with a dry run and a record-by-record check:
see docs/POSTGRES_TO_MONGODB.md for the steps.
