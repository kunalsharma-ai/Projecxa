-- CreateEnum
CREATE TYPE "VendorApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "QuoteRequestStatus" AS ENUM ('REQUESTED', 'QUOTED', 'DECLINED', 'ACCEPTED', 'CLOSED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "vendorSignupToken" TEXT;

-- CreateTable
CREATE TABLE "VendorApplication" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "VendorApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "companyName" TEXT NOT NULL,
    "website" TEXT,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "countries" TEXT[],
    "panelSize" INTEGER,
    "specialties" TEXT[],
    "message" TEXT,
    "ipHash" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "vendorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectCountryId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "QuoteRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "completesWanted" INTEGER NOT NULL,
    "loiMinutes" INTEGER NOT NULL,
    "irPercent" INTEGER NOT NULL,
    "targetGroup" TEXT,
    "note" TEXT,
    "respondBy" TIMESTAMP(3),
    "requestedById" TEXT NOT NULL,
    "cpi" DECIMAL(10,2),
    "currency" TEXT NOT NULL,
    "feasibleCompletes" INTEGER,
    "daysNeeded" INTEGER,
    "vendorNote" TEXT,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "allocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorApplication_organizationId_status_createdAt_idx" ON "VendorApplication"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VendorApplication_organizationId_email_idx" ON "VendorApplication"("organizationId", "email");

-- CreateIndex
CREATE INDEX "QuoteRequest_organizationId_status_idx" ON "QuoteRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "QuoteRequest_vendorId_status_idx" ON "QuoteRequest"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_projectCountryId_vendorId_key" ON "QuoteRequest"("projectCountryId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_vendorSignupToken_key" ON "Organization"("vendorSignupToken");

-- AddForeignKey
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_projectCountryId_fkey" FOREIGN KEY ("projectCountryId") REFERENCES "ProjectCountry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRequest" ADD CONSTRAINT "QuoteRequest_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

