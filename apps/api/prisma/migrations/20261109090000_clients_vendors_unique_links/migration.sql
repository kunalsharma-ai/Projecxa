-- CreateEnum
CREATE TYPE "ClientLinkStatus" AS ENUM ('UNUSED', 'ASSIGNED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "lastWorkOrderNo" TEXT,
ADD COLUMN     "uidPrefix" TEXT;

-- AlterTable
ALTER TABLE "ProjectCountry" ADD COLUMN     "useClientLinks" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ClientUniqueLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectCountryId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "status" "ClientLinkStatus" NOT NULL DEFAULT 'UNUSED',
    "sessionId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "label" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientUniqueLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyLogo" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "vendorId" TEXT,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "hash" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyLogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientUniqueLink_sessionId_key" ON "ClientUniqueLink"("sessionId");

-- CreateIndex
CREATE INDEX "ClientUniqueLink_projectCountryId_status_seq_idx" ON "ClientUniqueLink"("projectCountryId", "status", "seq");

-- CreateIndex
CREATE INDEX "ClientUniqueLink_projectId_idx" ON "ClientUniqueLink"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientUniqueLink_projectCountryId_url_key" ON "ClientUniqueLink"("projectCountryId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "PartyLogo_clientId_key" ON "PartyLogo"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyLogo_vendorId_key" ON "PartyLogo"("vendorId");

-- AddForeignKey
ALTER TABLE "ClientUniqueLink" ADD CONSTRAINT "ClientUniqueLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientUniqueLink" ADD CONSTRAINT "ClientUniqueLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientUniqueLink" ADD CONSTRAINT "ClientUniqueLink_projectCountryId_fkey" FOREIGN KEY ("projectCountryId") REFERENCES "ProjectCountry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientUniqueLink" ADD CONSTRAINT "ClientUniqueLink_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RespondentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyLogo" ADD CONSTRAINT "PartyLogo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyLogo" ADD CONSTRAINT "PartyLogo_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyLogo" ADD CONSTRAINT "PartyLogo_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

