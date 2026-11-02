-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "paymentExportedAt" TIMESTAMP(3),
ADD COLUMN     "paymentReference" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "zohoBooksConfig" JSONB;

-- AlterTable
ALTER TABLE "VendorBill" ADD COLUMN     "paymentExportedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ZohoBooksLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "zohoId" TEXT NOT NULL,
    "state" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZohoBooksLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZohoBooksSync" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "counts" JSONB,
    "errors" JSONB,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ZohoBooksSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZohoBooksLink_organizationId_entityType_entityId_key" ON "ZohoBooksLink"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "ZohoBooksSync_organizationId_startedAt_idx" ON "ZohoBooksSync"("organizationId", "startedAt");

-- AddForeignKey
ALTER TABLE "ZohoBooksLink" ADD CONSTRAINT "ZohoBooksLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZohoBooksSync" ADD CONSTRAINT "ZohoBooksSync_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
