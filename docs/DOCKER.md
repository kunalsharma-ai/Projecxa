# Running SampTrek with Docker

`docker-compose.yml` runs the whole server: the API (`apps/api/Dockerfile`), the web app
(`apps/web/Dockerfile`), nginx (`nginx.conf`), MongoDB 8 as a one-member replica set and Redis.
Both images build from the repository root because the apps share one pnpm workspace and lockfile.

## Images

| Image | Dockerfile | Base | Runs | Port |
| --- | --- | --- | --- | --- |
| API | `apps/api/Dockerfile` | `node:26-alpine` + pnpm 10.28.0 | `node dist/main.js` (NestJS, Prisma 6 on MongoDB) | 4000 |
| Web | `apps/web/Dockerfile` | `node:26-alpine` + pnpm 10.28.0 | `node apps/web/server.js` (Next.js 15 standalone) | 3000 |

Both have a `development` target (`pnpm dev`) and a `production` target (the default), run as the
unprivileged `node` user, use `tini` as PID 1, and have a Docker healthcheck
(API: `/api/v1/public/status/ping`, which also checks the database; web: `/`).

The API image also contains:
- MongoDB Database Tools (`mongodump` / `mongorestore`) for Super Admin → Backups and `pnpm backup`.
- The Prisma schema, the scripts in `apps/api/prisma/` and `ts-node`, so `pnpm prisma:deploy`,
  `pnpm create-admin`, `pnpm backup`, `pnpm restore-backup` and `pnpm import-postgres` run inside the container.

## Settings

Put these in a `.env` file next to `docker-compose.yml`:

| Variable | Needed | Notes |
| --- | --- | --- |
| `JWT_SECRET` | yes | Long random string (`openssl rand -hex 32`). The API stops at start-up without it. |
| `MFA_ENCRYPTION_KEY` | recommended | Encrypts two-step sign-in secrets; falls back to `JWT_SECRET`. Keep it the same forever once people use 2FA. |
| `WEB_ORIGIN` | yes | e.g. `https://samptrek.sampledge.com` |
| `PUBLIC_BASE_URL` | yes | Public API address used in survey links, e.g. `https://api.samptrek.sampledge.com` |
| `NEXT_PUBLIC_API_URL` | build | Empty = same domain through nginx (`/api/v1`). Or the API domain. |
| `NEXT_PUBLIC_WEB_ORIGIN` | build | Same as `WEB_ORIGIN`. |
| `NEXT_PUBLIC_CUSTOM_DOMAINS` | build | `true` for white-label domains (docs/WHITE_LABEL.md). |
| `DATABASE_URL` | no | Defaults to the bundled `mongo` service; point it at MongoDB Atlas if you prefer. |

`NEXT_PUBLIC_*` values are baked into the web app when the image is built, so run
`docker compose build frontend` after changing them.

## First start

```bash
docker network create publicweb          # once; the nginx service joins this shared network
docker compose up -d --build
docker compose exec backend pnpm prisma:deploy      # collections + indexes (also after every update)
docker compose exec -it backend pnpm create-admin --org-name "Your Company" --email you@company.com --name "Your Name"
```

## Updating

```bash
git pull
docker compose up -d --build
docker compose exec backend pnpm prisma:deploy
```

## Data

- MongoDB: `./db/mongo/` (config, data, and `/back` for manual dumps).
- Redis: `./db/redisdata`.
- Local backups: the `backups` volume (`/app/apps/api/backups` in the API container).
- Next.js image cache: the `webcache` volume.

The MongoDB healthcheck creates the replica set `rs0` on first start with the member name `mongo:27017`,
which is the name the API container uses. A server that was first started with the earlier compose file
(member `localhost:27017`) is renamed automatically on the next start.

## Local development

Only the database is needed: `docker compose up -d mongo redis`, then follow "Run it locally" in the README.
