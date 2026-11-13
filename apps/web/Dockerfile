
# ==========================================
# Base Stage
# ==========================================
FROM node:24-alpine AS base

WORKDIR /app

RUN apk add --no-cache libc6-compat

# ==========================================
# Dependencies Stage
# ==========================================
FROM base AS dependencies

COPY package*.json ./

RUN npm install


# ==========================================
# Development Stage
# ==========================================
FROM dependencies AS development

WORKDIR /app

ENV NODE_ENV=development

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]


# ==========================================
# Build Stage
# ==========================================
FROM dependencies AS build

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY . .

RUN npm run build


# ==========================================
# Production Stage
# ==========================================
FROM node:24-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache libc6-compat \
    && addgroup -S nodeapp \
    && adduser -S nodeapp -G nodeapp

# Next.js standalone output
COPY --from=build --chown=nodeapp:nodeapp /app/.next/standalone ./

# Static assets
COPY --from=build --chown=nodeapp:nodeapp /app/.next/static ./.next/static

# Public assets (if available)
COPY --from=build --chown=nodeapp:nodeapp /app/public ./public

USER nodeapp

EXPOSE 3000

CMD ["node", "server.js"]
