-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "fraudRules" JSONB;

-- AlterTable
ALTER TABLE "RespondentSession" ADD COLUMN     "deviceHash" TEXT,
ADD COLUMN     "riskScore" INTEGER,
ADD COLUMN     "riskSignals" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "IpReputationRange" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "range" INET NOT NULL,

    CONSTRAINT "IpReputationRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpReputationSource" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "IpReputationSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpLookupCache" (
    "key" TEXT NOT NULL,
    "proxy" BOOLEAN NOT NULL,
    "type" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IpLookupCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "IpReputationRange_source_idx" ON "IpReputationRange"("source");

-- CreateIndex
CREATE INDEX "IpReputationRange_range_idx" ON "IpReputationRange" USING GIST ("range" inet_ops);

-- CreateIndex
CREATE INDEX "RespondentSession_projectId_deviceHash_idx" ON "RespondentSession"("projectId", "deviceHash");

-- CreateIndex
CREATE INDEX "RespondentSession_organizationId_fingerprintHash_idx" ON "RespondentSession"("organizationId", "fingerprintHash");

-- CreateIndex
CREATE INDEX "RespondentSession_organizationId_deviceHash_idx" ON "RespondentSession"("organizationId", "deviceHash");

-- CreateIndex
CREATE INDEX "RespondentSession_organizationId_browserIdHash_idx" ON "RespondentSession"("organizationId", "browserIdHash");

-- CreateIndex
CREATE INDEX "RespondentSession_organizationId_ipHash_idx" ON "RespondentSession"("organizationId", "ipHash");
