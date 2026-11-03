-- CreateEnum
CREATE TYPE "AlertState" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "alertSettings" JSONB,
ADD COLUMN     "alertWebhookSecret" TEXT,
ADD COLUMN     "alertWebhookUrl" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "autopilot" JSONB,
ADD COLUMN     "fieldEndAt" TIMESTAMP(3),
ADD COLUMN     "fieldStartAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "projectCountryId" TEXT,
    "vendorAllocationId" TEXT,
    "rule" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "metrics" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "state" "AlertState" NOT NULL DEFAULT 'OPEN',
    "autoAction" TEXT,
    "webhookStatus" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Alert_organizationId_state_idx" ON "Alert"("organizationId", "state");

-- CreateIndex
CREATE INDEX "Alert_organizationId_dedupeKey_idx" ON "Alert"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Alert_projectId_state_idx" ON "Alert"("projectId", "state");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
