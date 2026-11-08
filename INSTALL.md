# Installing SampTrek

This is the production install guide for SampTrek (source: `main` of
github.com/kunalsharma-ai/Projecxa; a downloaded package notes its commit in `VERSION.txt`).
It is a pnpm monorepo with two apps:

| App | Folder | Tech | Default port |
| --- | --- | --- | --- |
| API | `apps/api` | NestJS 11, Prisma 6 | 4000 |
| Web | `apps/web` | Next.js 15, Tailwind | 3000 |

Data lives in PostgreSQL 16. Redis is listed in `docker-compose.yml` but is not used yet.
Background jobs (callbacks, webhooks, monitor, schedulers) run inside the API process.

## 1. Prerequisites

- Linux server (Ubuntu 22.04/24.04 is fine), 2 vCPU, 4 GB RAM minimum.
- Node.js 26 (26.13.0 or newer, the current LTS). With nvm: `nvm install 26 && nvm use 26`
  (the repo's `.nvmrc` says 26). Older Node versions are no longer supported.
- pnpm 10: `npm install -g pnpm@10.28.0`. Node 26 no longer ships Corepack, so the old
  `corepack enable` step does not work any more.
- PostgreSQL 16, either a managed database or `docker compose up -d postgres`.
- PostgreSQL client tools of the same version or newer, for backups (`pg_dump`, `pg_restore`, `psql`):
  `sudo apt install postgresql-client-16`. See docs/BACKUPS.md.
- A reverse proxy with TLS (Nginx, Caddy or a load balancer) and two DNS names, for example
  `app.yourcompany.com` (web) and `api.yourcompany.com` (API).

## 2. Get the code and install packages

```bash
unzip projexa-main.zip -d projexa && cd projexa
pnpm install --frozen-lockfile
```

## 3. Server settings

Copy the examples and fill in **only these values**. Everything else (email, SSO,
AI copilot, Zoho Books, Xero, QuickBooks, Tally, SampBidx) is set up later in the app
at **Settings → Integrations**, so leave the "Optional fallbacks" part of the file empty.

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

`apps/api/.env`

| Variable | Example | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://projexa:STRONGPASS@db-host:5432/projexa` | |
| `JWT_SECRET` | output of `openssl rand -hex 32` | Signs sign-in sessions |
| `MFA_ENCRYPTION_KEY` | another `openssl rand -hex 32` | Master key for saved secrets. **Set once, back it up, never change it**, or saved integrations and authenticator apps stop working |
| `PUBLIC_BASE_URL` | `https://api.yourcompany.com` | Public API address, used in respondent links and SSO redirect URIs |
| `WEB_ORIGIN` | `https://app.yourcompany.com` | Web app address (comma-separate if more than one) |
| `PORT` | `4000` | |

Sampledge's own server uses `samptrek.sampledge.com` (it was `projexa.sampledge.com`). To move an
existing server, follow `docs/SAMPTREK_ADDRESS.md`.

`apps/web/.env.local`

| Variable | Example | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://api.yourcompany.com` | Read at **build time**: rebuild the web app after changing it |
| `NEXT_PUBLIC_WEB_ORIGIN` | `https://app.yourcompany.com` | |
| `API_INTERNAL_URL` | `http://127.0.0.1:4000` | Only used with custom domains |
| `NEXT_PUBLIC_CUSTOM_DOMAINS` | `false` | Set `true` only when using white-label custom domains (`docs/WHITE_LABEL.md`) |

Running more than one API instance? Set `REPORT_SCHEDULER_ENABLED`, `REDIRECT_SCHEDULER_ENABLED`,
`PRIVACY_SCHEDULER_ENABLED` and `MONITOR_ENABLED` to `false` on all but one instance.

## 4. Database

```bash
pnpm --filter @projexa/api prisma:generate
pnpm db:deploy                               # applies all migrations (production)
```

Use `db:deploy`, not `db:migrate` (that one is for development).

### First admin

Create your organisation and its first admin (no demo data):

```bash
pnpm create-admin --org-name "Frequent Research" --email you@yourcompany.com --name "Your Name"
```

It asks for the password twice (at least 10 characters, hidden while typing). In a script, set
`ADMIN_PASSWORD='...'` before the command instead. Options:

- `--slug frequent-research`: the organisation's short name (default: made from `--org-name`).
- Run it again with the same `--slug` and another `--email` to add a second admin.

The first organisation on a server is the server owner: its admins set up sign-in (Google,
Microsoft, Zoho) and the Xero, QuickBooks and Tally apps for the whole server.

After signing in, invite the rest of the team from Settings → Team (needs email set up first, see step 7).

Do **not** run `pnpm db:seed` on a production server: it creates a demo organisation with demo
logins and synthetic data. It is only for local development and demos.

## 5. Build

```bash
pnpm --filter @projexa/api build
pnpm --filter @projexa/web build
```

## 6. Run

```bash
# API
cd apps/api && NODE_ENV=production node dist/main.js
# Web (separate process)
cd apps/web && NODE_ENV=production pnpm start
```

Run both under a process manager such as systemd or pm2, for example:

```bash
npm i -g pm2
pm2 start "node dist/main.js" --name projexa-api --cwd apps/api
pm2 start "pnpm start" --name projexa-web --cwd apps/web
pm2 save && pm2 startup
```

### Reverse proxy and TLS

- `app.yourcompany.com` → `127.0.0.1:3000`
- `api.yourcompany.com` → `127.0.0.1:4000`

Pass the real client IP (`X-Forwarded-For`) to the API. If you are behind Cloudflare or another CDN,
set `GEO_COUNTRY_HEADER=cf-ipcountry` (or your CDN's header) so respondent geo checks work.

Example Caddy file (gets certificates automatically):

```
app.yourcompany.com {
  reverse_proxy 127.0.0.1:3000
}
api.yourcompany.com {
  reverse_proxy 127.0.0.1:4000
}
```

Check: open `https://app.yourcompany.com`; the sign-in page should load and signing in should work (that proves the web app reaches the API).

## 7. Integrations, all in the app

Sign in as an admin and open **Settings → Integrations** (`/settings/integrations`). Each card has
step-by-step help, the redirect URI to copy, and **Save and test**:

- Email sending (Zoho Mail SMTP): set this first; invitations, password resets and scheduled reports need it.
- Sign in with Google, Microsoft and Zoho.
- AI copilot and voice (Google Gemini).
- Zoho Books, Xero, QuickBooks Online, Tally Prime.
- SampBidx link.

Captcha keys, the SampBidx webhook secret, alert webhooks and API keys are set under Settings and
Settings → API and webhooks. Full detail: `docs/INTEGRATIONS.md`.

## 8. Updating later

```bash
git pull        # or unzip a newer package over the folder, keeping the .env files
pnpm install --frozen-lockfile
pnpm --filter @projexa/api prisma:generate
pnpm --filter @projexa/api prisma:deploy
pnpm --filter @projexa/api build && pnpm --filter @projexa/web build
pm2 restart projexa-api projexa-web
```

**Moving an existing server from Node 22 to Node 26** (one time, with this package or newer):

```bash
pm2 save                                   # run this first, still on Node 22
nvm install 26 && nvm alias default 26     # or install Node 26 from nodesource / your OS
npm install -g pnpm@10.28.0 pm2            # global tools are per Node version
rm -rf node_modules apps/*/node_modules    # native packages (Prisma) are rebuilt for Node 26
pnpm install --frozen-lockfile
pnpm --filter @projexa/api prisma:generate
pnpm --filter @projexa/api build && pnpm --filter @projexa/web build
pm2 kill && pm2 resurrect                  # restart pm2 itself so it runs on Node 26
node -v                                    # should print v26.x
```

## 9. Backups and the status page

- Backups are set up in the app: **Settings → Integrations → Backup storage** (a folder on the server,
  or a free Cloudflare R2 / Backblaze B2 bucket, with an encryption passphrase), then **Super Admin →
  Backups**: Back up now, a daily schedule, Test, Download and a guarded Restore. See docs/BACKUPS.md.
- If the app cannot start, restore a downloaded backup on the server with
  `pnpm restore-backup --file <file>`, then `pnpm db:deploy`. `pnpm backup` takes one from a cron job.
- Keep a safe copy of `MFA_ENCRYPTION_KEY`, `JWT_SECRET` and the backup passphrase. A database restore
  without the same `MFA_ENCRYPTION_KEY` cannot read saved integration secrets.
- The public status page is at `https://<web>/status` (Super Admin → Status page). Add
  `https://<api>/api/v1/public/status/ping` to a free outside monitor such as UptimeRobot to be alerted
  when the server is down. See docs/STATUS_PAGE.md.

## 10. Checking an install

```bash
pnpm --filter @projexa/api typecheck
pnpm --filter @projexa/web typecheck
pnpm --filter @projexa/web test
```

The API test suite (`pnpm --filter @projexa/api test`) needs `TEST_DATABASE_URL` pointing at a
throwaway database, because it resets it.

## More documentation

`README.md` lists every feature by milestone. The `docs/` folder has one guide per area
(redirects, quotas, security, portals, finance, SSO, MFA, privacy, white-label and more).
Local development: see "Run it locally" in `README.md`.
