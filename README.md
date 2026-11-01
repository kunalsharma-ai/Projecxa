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

## Milestone 2: client and vendor portals

- **Vendor portal** (`/portal/vendor`): the vendor's own projects with entry and test links, CPI, LOI, IR and progress; respondents with status, approval and payout (CSV); callback delivery log; payout totals by approval state.
- **Client portal** (`/portal/client`): the client's own live, test, on-hold and closed projects; progress by market; spend; review completes by the respondent ID their survey received, download CSV, approve or reject.
- **Portal access** (staff): create client and vendor logins, deactivate them instantly.
- Portal users cannot reach any staff endpoint, and each portal only returns its own company's data (covered by e2e tests).

## Milestone 3: fieldwork reports

The five reports of the current Fieldwork platform, at `/reports`, with one filter bar (date range in UTC days, client, project, vendor, market):

- **Overall**: clicks, completes (pending and rejected), conversion, median LOI, revenue, payout and profit per currency, completes per day, outcome mix, top clients, vendors and projects.
- **Conversion**: one row per respondent with UID, project, client, market, vendor, status, approval, S2S check, LOI, revenue and payout; status filter, paging, CSV export (up to 50,000 rows).
- **Clients** and **Vendors**: the same metrics grouped by client (or market) and by vendor (optionally split by market), with totals and CSV.
- **Clicks**: the respondent event log (entries, outcomes, repeat entries, repeated or conflicting outcomes), with CSV.

Test traffic never counts. Revenue and payout leave out rejected completes. Money stays in each market's currency until FX conversion exists. The demo seed now adds three weeks of synthetic traffic so the reports have data.

## Milestone 4: design system, themes and new workspace shell

Applies the frontend design prompt (see `docs/FRONTEND_DESIGN_SYSTEM.md` for the full audit, tokens, components and phases):

- **Theme Studio** (`/settings/appearance`): 8 themes (Midnight Intelligence, Arctic Executive, Emerald Matrix, Obsidian Gold, Royal Sapphire, Aurora Rose, Graphite Minimal, Solar Executive), each in light and dark, plus accents, surfaces, sidebar style, border, gradient and glass strength, font size, density, corner radius, motion level (Essential, Refined, Cinematic) and chart palette. Saved per user; contrast is kept at WCAG AA automatically.
- **Shell**: collapsible sidebar with favorites and recent projects, command bar with `Ctrl/⌘ K` search and commands, quick create, alerts, theme switcher and a hideable insights panel (rules-based alerts and recent activity).
- **Command center** dashboard with a 14-day completes trend and quota achievement.
- Shortcuts: `Ctrl/⌘ K` or `/` search, `[` sidebar, `]` insights.

## Milestone 5: won bids from Bidzo

- When a bid is won in Bidzo, it shows up automatically in **Won bids** (`/won-bids`), with a count badge in the sidebar and an item in the insights panel.
- **Set up project** opens the new-project wizard prefilled from the bid: name, description, bid number, category, client (or one click to add the client), and one market per bid country with LOI, IR, CPI, currency and sample size as target. Each won bid becomes at most one project.
- Bids that will not run can be dismissed with a reason and restored later.
- Admins connect Bidzo under **Settings → Bidzo connection** (endpoint, tenant and a signing secret shown once). The webhook contract for the Bidzo side is in `docs/BIDZO_INTEGRATION.md`.
- The demo seed adds three synthetic won bids.

## Milestone 6: gate survey, question builder and respondent security

- **Gate & security tab** on each project: every security setting now blocks for real (entry link signing, device types, TOR, geolocation, duplicates by IP, fingerprint and cookie, browser language, time zone), with a note when something needs server setup.
- **Respondent gate page** before the client survey: human check → gate survey → prescreener → browser checks → client survey. Phone-first, no branding, test links run every check but never block.
- **Question builder** for gate survey and prescreener questions: single choice, multiple choice, dropdown, number, text and grid, with validations (required, ranges, whole numbers, number of choices, length, format) and rules (screen out, must pick one of, qualifying number range). Standard demographics, financial and education questions come from a library.
- **Captcha style per project**, free options only: math, logic, picture text, invisible, Cloudflare Turnstile and hCaptcha (admins add those keys in Settings). Google reCAPTCHA is left out because its free tier stops at 10,000 checks a month.
- **Answers** tab on each project and an **Answers** report: per-question counts, filter by any answer, status and market, and CSV export.
- Details: `docs/RESPONDENT_SECURITY.md`.

## Milestone 7: designed respondent pages

- **Respondent pages tab** on each project: pick one of six templates (Aurora, Minimal, Split, Spotlight, Bold, Playful), a colour palette or your own colours (with a readability warning), font, corner style, brand name, logo, hero picture and footer.
- **Words per page**: own heading, message and an optional https button for complete, terminate, quota full, quality fail, duplicate, security reject, partial and technical error. Blank fields fall back to friendly defaults.
- **Live preview** of every page and the gate page, at desktop and phone width, before saving.
- **Confetti** on complete (skipped when the respondent turns off motion), and an optional **countdown page** shown before a vendor's own return link.
- The gate page uses the same design. Pages are server-rendered with a strict nonce CSP, no outside fonts or scripts; images are checked by their bytes and served from `/pa/:id`.
- Details: `docs/RESPONDENT_PAGES.md`.

## Milestone 8: reconciliation, invoicing and finance dashboard

- **Reconcile & invoice tab** on each project: paste or load the client's ID list (session tokens or vendor UIDs), choose final list, approve listed or reject listed, preview exactly what changes, then apply. IDs that match nothing or that we recorded as another outcome are flagged for the client. Every run is kept in a history.
- **Invoices** from approved completes: one draft per currency with a line per market and price, then sent (with payment terms), paid or void. Invoiced completes are locked; voiding releases them. Printable invoice page (print or save as PDF), invoice list with filters and CSV.
- **Command center**: date range with trend % against the previous period, reconciliation and invoicing tiles, top 5 vendors, projects and clients, and a revenue, payout and profit chart (daily, weekly or monthly; bars or lines; table view).
- **Projects list**: link status (live links / all links) and CSV export of every matching project.
- Details: `docs/FINANCE.md`.

## Milestone 9: fieldwork monitor and autopilot

- **Fieldwork monitor** page: every live market with pace (per day against needed per day, ETA, days left), IR and LOI against plan, last-24h entries, and vendor links with quality and drop-out shares. Pause or reactivate a link in place.
- **Alerts** checked every five minutes or on demand: stalled, behind pace or overdue, low incidence, LOI too short or long, quality spike, drop-out, near target, target reached and failed callbacks. One alert per problem; it clears itself when the problem goes away, or can be acknowledged and resolved.
- **Autopilot** per project: pause a vendor link on a quality spike, close a link once it hits its target. Every action is audited.
- **Project Monitor tab** with field start and end dates; **Settings → Fieldwork alerts** for thresholds and a signed webhook (Slack or Teams relay).
- Details: `docs/FIELDWORK_MONITOR.md`.

## Milestone 10: quota cells

- **Quotas tab** on each project: split a market's target into cells by device or by answers to the gate survey and prescreener (choices or number ranges such as age 18–34). Conditions combine, so cells can interlock (women aged 18–34). Quick add creates one cell per answer with an even split of the target.
- **Enforced** at entry (device cells), after the gate page (answer cells) and again at the complete, atomically with the market and vendor targets: a respondent whose cell is full or closed goes to quota full, and a complete that would overfill a cell is recorded as overquota.
- Cells show completes, respondents still in the survey, and can be closed or reopened in one click. The fieldwork monitor shows them per market and raises an alert when one fills.
- Details: `docs/QUOTAS.md`.

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

Sign in at http://localhost:3000 with `pm@projexa.local` or `admin@projexa.local`, password `projexa-demo-2026` (set `SEED_ADMIN_PASSWORD` to change it). Portal demo logins: `client@projexa.local` (Acme Insights) and `vendor@projexa.local` (Panel Alpha), same password. The demo project has US, GB and DE with two vendors and a hybrid redirect setup that points at local mock survey and vendor pages, so you can open a test link from the QA studio and click through a full respondent journey.

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
