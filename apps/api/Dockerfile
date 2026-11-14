# syntax=docker/dockerfile:1
# SampTrek API (NestJS + Prisma on MongoDB 8).
# Build from the repository root, because the API is part of the pnpm workspace:
#   docker build -f apps/api/Dockerfile -t samptrek-api .
# Targets: development (pnpm dev, hot reload) and production (default, last stage).

ARG NODE_VERSION=26
ARG PNPM_VERSION=10.28.0

# ==========================================
# Base: Node 26 + pnpm + Prisma engine needs
# ==========================================
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
# openssl: Prisma query engine. libc6-compat: native modules on musl.
# Node 25+ no longer ships corepack, so pnpm is installed from npm (version from package.json).
RUN apk add --no-cache openssl libc6-compat \
    && npm install -g pnpm@${PNPM_VERSION} \
    && npm cache clean --force
WORKDIR /app

# ==========================================
# Dependencies (API workspace package only)
# ==========================================
FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @projexa/api

# ==========================================
# Development: pnpm dev (nest start --watch)
# ==========================================
FROM dependencies AS development
ENV NODE_ENV=development
COPY apps/api apps/api
RUN pnpm --filter @projexa/api prisma:generate
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["pnpm", "dev"]

# ==========================================
# Build: Prisma client + compile NestJS
# ==========================================
FROM dependencies AS build
COPY apps/api apps/api
RUN pnpm --filter @projexa/api prisma:generate \
    && pnpm --filter @projexa/api build

# ==========================================
# Production
# ==========================================
FROM base AS production
ENV NODE_ENV=production \
    PORT=4000
# mongodb-tools: mongodump / mongorestore for Super Admin -> Backups and `pnpm backup`.
# font-dejavu: fallback fonts for PDF reports (the app also ships its own in assets/fonts).
RUN apk add --no-cache mongodb-tools font-dejavu tini

# Workspace files so `pnpm db:deploy`, `pnpm create-admin` and `pnpm backup` work in the container.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node apps/api/package.json apps/api/tsconfig.json apps/api/tsconfig.build.json ./apps/api/
COPY --chown=node:node apps/api/prisma ./apps/api/prisma
COPY --chown=node:node apps/api/assets ./apps/api/assets
COPY --chown=node:node apps/api/src ./apps/api/src
# Local backups are written to ./backups next to the API (docs/BACKUPS.md); mount a volume here.
RUN mkdir -p /app/apps/api/backups && chown node:node /app/apps/api/backups

WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/public/status/ping" > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
