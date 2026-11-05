-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('OPEN', 'PENDING_REVIEW', 'PAID', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "priceMonthly" DECIMAL(12,2),
ADD COLUMN     "priceYearly" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "billingInterval" "BillingInterval";

-- CreateTable
CREATE TABLE "BillingInvoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "taxName" TEXT,
    "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "method" TEXT,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "reference" TEXT,
    "paidOn" TIMESTAMP(3),
    "note" TEXT,
    "proofName" TEXT,
    "proofType" TEXT,
    "proofData" BYTEA,
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_number_key" ON "BillingInvoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_providerOrderId_key" ON "BillingInvoice"("providerOrderId");

-- CreateIndex
CREATE INDEX "BillingInvoice_organizationId_createdAt_idx" ON "BillingInvoice"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingInvoice_status_idx" ON "BillingInvoice"("status");

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invoice numbers SUB-<year>-<n>
CREATE SEQUENCE "billing_invoice_seq";
