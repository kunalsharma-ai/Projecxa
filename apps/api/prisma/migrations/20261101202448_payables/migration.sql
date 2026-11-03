-- CreateEnum
CREATE TYPE "VendorBillStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'VOID');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxName" TEXT,
ADD COLUMN     "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "billSeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "billTaxName" TEXT,
ADD COLUMN     "billTaxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "invoiceTaxName" TEXT,
ADD COLUMN     "invoiceTaxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RespondentSession" ADD COLUMN     "vendorBillId" TEXT;

-- CreateTable
CREATE TABLE "VendorBill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "VendorBillStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "periodTo" TIMESTAMP(3),
    "lines" JSONB NOT NULL,
    "completes" INTEGER NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxName" TEXT,
    "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "vendorReference" TEXT,
    "paymentReference" TEXT,
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorBill_organizationId_status_idx" ON "VendorBill"("organizationId", "status");

-- CreateIndex
CREATE INDEX "VendorBill_vendorId_idx" ON "VendorBill"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBill_organizationId_number_key" ON "VendorBill"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_organizationId_currency_key" ON "ExchangeRate"("organizationId", "currency");

-- CreateIndex
CREATE INDEX "RespondentSession_vendorBillId_idx" ON "RespondentSession"("vendorBillId");

-- AddForeignKey
ALTER TABLE "RespondentSession" ADD CONSTRAINT "RespondentSession_vendorBillId_fkey" FOREIGN KEY ("vendorBillId") REFERENCES "VendorBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing invoices had no tax: the subtotal is the total.
UPDATE "Invoice" SET "subtotal" = "total";
