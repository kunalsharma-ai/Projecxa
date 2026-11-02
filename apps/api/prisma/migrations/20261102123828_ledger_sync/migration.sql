-- CreateTable
CREATE TABLE "LedgerConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "remoteId" TEXT,
    "remoteName" TEXT,
    "tokens" TEXT,
    "settings" JSONB,
    "lastError" TEXT,
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "state" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerSync" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "counts" JSONB,
    "errors" JSONB,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LedgerSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerConnection_organizationId_provider_key" ON "LedgerConnection"("organizationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerLink_organizationId_provider_entityType_entityId_key" ON "LedgerLink"("organizationId", "provider", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "LedgerSync_organizationId_provider_startedAt_idx" ON "LedgerSync"("organizationId", "provider", "startedAt");

-- AddForeignKey
ALTER TABLE "LedgerConnection" ADD CONSTRAINT "LedgerConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerLink" ADD CONSTRAINT "LedgerLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerSync" ADD CONSTRAINT "LedgerSync_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
