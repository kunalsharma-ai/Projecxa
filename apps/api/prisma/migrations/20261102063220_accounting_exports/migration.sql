-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "exportedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "accountingConfig" JSONB;

-- AlterTable
ALTER TABLE "VendorBill" ADD COLUMN     "exportedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AccountingExport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "invoiceCount" INTEGER NOT NULL,
    "billCount" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountingExport_organizationId_createdAt_idx" ON "AccountingExport"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AccountingExport" ADD CONSTRAINT "AccountingExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
