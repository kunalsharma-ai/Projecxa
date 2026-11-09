-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "migration" TEXT,
    "tables" INTEGER,
    "durationMs" INTEGER,
    "error" TEXT,
    "createdById" TEXT,
    "createdBy" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastVerifyOk" BOOLEAN,
    "restoredAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UptimeCheck" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "components" JSONB NOT NULL,
    "dbLatencyMs" INTEGER,

    CONSTRAINT "UptimeCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusIncident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "components" TEXT[],
    "updates" JSONB NOT NULL DEFAULT '[]',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatusIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Backup_name_key" ON "Backup"("name");

-- CreateIndex
CREATE INDEX "Backup_startedAt_idx" ON "Backup"("startedAt");

-- CreateIndex
CREATE INDEX "UptimeCheck_at_idx" ON "UptimeCheck"("at");

-- CreateIndex
CREATE INDEX "StatusIncident_startsAt_idx" ON "StatusIncident"("startsAt");

