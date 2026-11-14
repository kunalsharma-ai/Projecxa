# syntax=docker/dockerfile:1
# SampTrek web (Next.js 15).
# Build from the repository root, because the web app is part of the pnpm workspace:
#   docker build -f apps/web/Dockerfile -t samptrek-web \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.samptrek.sampledge.com \
#     --build-arg NEXT_PUBLIC_WEB_ORIGIN=https://samptrek.sampledge.com .
# NEXT_PUBLIC_* values are baked into the browser bundle at build time, so pass them as
# build args (setting them only at run time has no effect on the browser code).
# Targets: development (pnpm dev) and production (default, last stage, Next.js standalone server).

ARG NODE_VERSION=26
ARG PNPM_VERSION=10.28.0

# ==========================================
# Base: Node 26 + pnpm
# ==========================================
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
# Node 25+ no longer ships corepack, so pnpm is installed from npm (version from package.json).
RUN apk add --no-cache libc6-compat \
    && npm install -g pnpm@${PNPM_VERSION} \
    && npm cache clean --force
WORKDIR /app

# ==========================================
# Dependencies (web workspace package only)
# ==========================================
FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @projexa/web

# ==========================================
# Development: pnpm dev (next dev -p 3000)
# ==========================================
FROM dependencies AS development
ENV NODE_ENV=development
COPY apps/web apps/web
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "dev"]

# ==========================================
# Build: next build (standalone output)
# ==========================================
FROM dependencies AS build
# Empty NEXT_PUBLIC_API_URL = the browser calls the API on the same domain (/api/v1 through nginx).
ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_WEB_ORIGIN=http://localhost:3000
ARG NEXT_PUBLIC_CUSTOM_DOMAINS=false
ARG NEXT_PUBLIC_SAMPBIDX_URL=""
# Where the web server forwards /api/v1 for custom domains (docs/WHITE_LABEL.md); fixed at build time.
ARG API_INTERNAL_URL=http://backend:4000
ENV NODE_ENV=production \
    NEXT_OUTPUT=standalone \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_WEB_ORIGIN=${NEXT_PUBLIC_WEB_ORIGIN} \
    NEXT_PUBLIC_CUSTOM_DOMAINS=${NEXT_PUBLIC_CUSTOM_DOMAINS} \
    NEXT_PUBLIC_SAMPBIDX_URL=${NEXT_PUBLIC_SAMPBIDX_URL} \
    API_INTERNAL_URL=${API_INTERNAL_URL}
COPY apps/web apps/web
RUN pnpm --filter @projexa/web build

# ==========================================
# Production: Next.js standalone server
# ==========================================
FROM node:${NODE_VERSION}-alpine AS production
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apk add --no-cache libc6-compat tini
WORKDIR /app

# Standalone output keeps the monorepo layout: the server is apps/web/server.js.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
# Image optimisation cache; mount a volume here to keep it across restarts.
RUN mkdir -p /app/apps/web/.next/cache && chown -R node:node /app/apps/web/.next/cache

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/" > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
