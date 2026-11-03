# PROJEXA by Sampledge

Research project management and fieldwork automation: multi-country projects, vendor allocation, secure survey links, hybrid redirects, callbacks and reconciliation.

This is **milestone 1**: the foundation, multi-country project setup, and the survey link / redirect engine (Module 5 and 5.1 of the spec). See `docs/` for the feature inventory, gap matrix and architecture plan.

## What's in milestone 1

- **Foundation**: multi-tenant organizations, login (httpOnly cookie or bearer token), roles (admin, project manager, sales, viewer), audit log.
- **Projects**: one master project across many countries, with shared settings and per-country overrides (language, LOI, IR, CPI, currency, completes, survey links). Excel paste, country cloning, the 11 security toggles from the current platform, devices, status workflow with a go-live check.
- **Vendors**: per-country allocations with CPI and targets, live and test entry links, pause/resume.
- **Survey engine**: opaque session tokens (the vendor UID never reaches the client survey), idempotent outcomes, duplicate detection, atomic quota control (overquotas are counted, never billed), signed server-to-server confirmation, complete approval.
- **Redirects**: static, dynamic and hybrid (default) modes; all 8 statuses; UID / vendor ID / country code parameters with per-vendor names; project, country, vendor and vendor+country overrides; client template and organization default; domain allowlist; versioning with approve/activate and rollback; QA studio and effective-routing view.
- **Callbacks**: outbox with retries, backoff with jitter, dead letter and replay; HMAC-signed requests.

## Run it locally

Requirements: Node 20+, pnpm 10, PostgreSQL 16 (or Docker).

```bash
docker compose up -d                 # Postgres + Redis (or use your own Postgres)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm install
pnpm db:migrate                      # create the schema
pnpm db:seed                         # synthetic demo data
pnpm dev                             # API on :4000, web on :3000
```

Sign in at http://localhost:3000 with `pm@projexa.local` or `admin@projexa.local`, password `projexa-demo-2026` (set `SEED_ADMIN_PASSWORD` to change it). The demo project has US, GB and DE with two vendors and a hybrid redirect setup that points at local mock survey and vendor pages, so you can open a test link from the QA studio and click through a full respondent journey.

## Tests

```bash
createdb projexa_test                # once; or set TEST_DATABASE_URL
pnpm --filter @projexa/api test      # unit + e2e (uses the *_test database only)
pnpm --filter @projexa/web typecheck
```

## Layout

```
apps/api   NestJS API, Prisma schema and migrations, tests
apps/web   Next.js web app (App Router, Tailwind)
docs/      Phase 0 documents and integration guide
```
