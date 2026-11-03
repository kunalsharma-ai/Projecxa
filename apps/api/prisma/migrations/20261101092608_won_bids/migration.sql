-- CreateEnum
CREATE TYPE "WonBidStatus" AS ENUM ('NEW', 'PROJECT_CREATED', 'DISMISSED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "bidzoWebhookSecret" TEXT;

-- CreateTable
CREATE TABLE "WonBid" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'BIDZO',
    "externalId" TEXT NOT NULL,
    "bidNumber" TEXT NOT NULL,
    "bidVersion" INTEGER,
    "projectName" TEXT NOT NULL,
    "description" TEXT,
    "projectType" TEXT,
    "projectCategory" TEXT,
    "clientName" TEXT NOT NULL,
    "clientExternalId" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "bidderName" TEXT,
    "currency" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,4),
    "countries" JSONB NOT NULL,
    "wonAt" TIMESTAMP(3) NOT NULL,
    "status" "WonBidStatus" NOT NULL DEFAULT 'NEW',
    "dismissReason" TEXT,
    "projectId" TEXT,
    "lastEventId" TEXT,
    "payload" JSONB NOT NULL,
    "deliveries" INTEGER NOT NULL DEFAULT 1,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WonBid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WonBid_projectId_key" ON "WonBid"("projectId");

-- CreateIndex
CREATE INDEX "WonBid_organizationId_status_idx" ON "WonBid"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WonBid_organizationId_source_externalId_key" ON "WonBid"("organizationId", "source", "externalId");

-- AddForeignKey
ALTER TABLE "WonBid" ADD CONSTRAINT "WonBid_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WonBid" ADD CONSTRAINT "WonBid_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
