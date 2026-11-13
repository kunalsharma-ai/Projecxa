
# ==========================================
# Base Stage
# ==========================================
FROM node:24-alpine AS base

WORKDIR /app

ENV NODE_ENV=development

# Required for Prisma engines and native dependencies
RUN apk add --no-cache openssl libc6-compat

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

COPY . .

# Generate Prisma Client
RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "run", "dev"]


# ==========================================
# Build Stage
# ==========================================
FROM dependencies AS build

WORKDIR /app

COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Compile NestJS
RUN npm run build


# ==========================================
# Production Dependencies
# ==========================================
FROM base AS production-dependencies

WORKDIR /app

COPY package*.json ./

RUN npm install 


# ==========================================
# Production Stage
# ==========================================
FROM node:24-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache openssl libc6-compat \
    && addgroup -S nodeapp \
    && adduser -S nodeapp -G nodeapp

# Production node_modules
COPY --from=production-dependencies --chown=nodeapp:nodeapp /app/node_modules ./node_modules

# Compiled application
COPY --from=build --chown=nodeapp:nodeapp /app/dist ./dist

# Prisma schema and configuration (if required at runtime)
COPY --from=build --chown=nodeapp:nodeapp /app/prisma ./prisma

# Package metadata
COPY --chown=nodeapp:nodeapp package*.json ./

USER nodeapp

EXPOSE 3000

CMD ["node", "dist/main.js"]
