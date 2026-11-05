-- CreateEnum
CREATE TYPE "UniqueLinkStatus" AS ENUM ('UNUSED', 'USED', 'REVOKED');

-- AlterTable
ALTER TABLE "RespondentSession" ADD COLUMN     "uniqueLinkId" TEXT;

-- AlterTable
ALTER TABLE "VendorAllocation" ADD COLUMN     "uniqueLinksOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "UniqueLinkBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "label" TEXT,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UniqueLinkBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UniqueLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "UniqueLinkStatus" NOT NULL DEFAULT 'UNUSED',
    "usedAt" TIMESTAMP(3),
    "blockedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastBlockedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UniqueLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UniqueLinkBatch_projectId_createdAt_idx" ON "UniqueLinkBatch"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UniqueLink_key_key" ON "UniqueLink"("key");

-- CreateIndex
CREATE INDEX "UniqueLink_projectId_status_idx" ON "UniqueLink"("projectId", "status");

-- CreateIndex
CREATE INDEX "UniqueLink_vendorAllocationId_status_idx" ON "UniqueLink"("vendorAllocationId", "status");

-- CreateIndex
CREATE INDEX "UniqueLink_batchId_idx" ON "UniqueLink"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "RespondentSession_uniqueLinkId_key" ON "RespondentSession"("uniqueLinkId");

-- AddForeignKey
ALTER TABLE "RespondentSession" ADD CONSTRAINT "RespondentSession_uniqueLinkId_fkey" FOREIGN KEY ("uniqueLinkId") REFERENCES "UniqueLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniqueLinkBatch" ADD CONSTRAINT "UniqueLinkBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniqueLinkBatch" ADD CONSTRAINT "UniqueLinkBatch_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniqueLink" ADD CONSTRAINT "UniqueLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniqueLink" ADD CONSTRAINT "UniqueLink_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniqueLink" ADD CONSTRAINT "UniqueLink_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UniqueLinkBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

