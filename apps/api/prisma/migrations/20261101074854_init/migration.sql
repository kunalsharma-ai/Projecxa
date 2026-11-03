-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER', 'CLIENT_USER', 'VENDOR_USER');

-- CreateEnum
CREATE TYPE "PartyStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('AD_HOC', 'TRACKER', 'LONGITUDINAL', 'QUALITATIVE');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED', 'INVOICED');

-- CreateEnum
CREATE TYPE "RedirectMode" AS ENUM ('STATIC', 'DYNAMIC', 'HYBRID');

-- CreateEnum
CREATE TYPE "CountryStatus" AS ENUM ('DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RedirectVersionState" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RespondentStatus" AS ENUM ('STARTED', 'COMPLETE', 'TERMINATE', 'QUOTA_FULL', 'QUALITY_FAIL', 'DUPLICATE', 'SECURITY_REJECT', 'PARTIAL', 'TECHNICAL_ERROR');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('ENTRY', 'BROWSER', 'S2S', 'SYSTEM', 'QA');

-- CreateEnum
CREATE TYPE "CallbackState" AS ENUM ('PENDING', 'QUEUED', 'SENDING', 'DELIVERED', 'RETRY_SCHEDULED', 'FAILED', 'DEAD_LETTER', 'CANCELLED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "defaultRedirectConfig" JSONB,
    "redirectAllowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fallbackRedirectUrl" TEXT,
    "projectSeq" INTEGER NOT NULL DEFAULT 10000,
    "workOrderSeq" INTEGER NOT NULL DEFAULT 9000,
    "projectCodePrefix" TEXT NOT NULL DEFAULT 'PRX',
    "workOrderPrefix" TEXT NOT NULL DEFAULT 'WO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PROJECT_MANAGER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "clientId" TEXT,
    "vendorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "redirectTemplate" JSONB,
    "s2sSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "redirectAllowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "callbackUrlTemplate" TEXT,
    "callbackSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "workOrderNo" TEXT,
    "bidReference" TEXT,
    "name" TEXT NOT NULL,
    "type" "ProjectType" NOT NULL DEFAULT 'AD_HOC',
    "category" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "clientId" TEXT NOT NULL,
    "clientContactId" TEXT,
    "projectManagerId" TEXT NOT NULL,
    "salesPersonId" TEXT,
    "devices" JSONB NOT NULL,
    "security" JSONB NOT NULL,
    "redirectMode" "RedirectMode" NOT NULL DEFAULT 'HYBRID',
    "activeRedirectVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCountry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "targetGroup" TEXT,
    "status" "CountryStatus" NOT NULL DEFAULT 'DRAFT',
    "loiMinutes" INTEGER NOT NULL,
    "irPercent" INTEGER NOT NULL,
    "cpi" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "targetCompletes" INTEGER NOT NULL,
    "completes" INTEGER NOT NULL DEFAULT 0,
    "liveSurveyUrl" TEXT,
    "testSurveyUrl" TEXT,
    "sessionTtlMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCountry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaCell" (
    "id" TEXT NOT NULL,
    "projectCountryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" JSONB,
    "target" INTEGER NOT NULL,
    "completes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorAllocation" (
    "id" TEXT NOT NULL,
    "projectCountryId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "cpi" DECIMAL(12,2) NOT NULL,
    "targetCompletes" INTEGER NOT NULL,
    "completes" INTEGER NOT NULL DEFAULT 0,
    "entryCode" TEXT NOT NULL,
    "testEntryCode" TEXT NOT NULL,
    "uidParam" TEXT NOT NULL DEFAULT 'uid',
    "callbackUrlTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedirectPolicyVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "RedirectVersionState" NOT NULL DEFAULT 'DRAFT',
    "mode" "RedirectMode" NOT NULL,
    "config" JSONB NOT NULL,
    "changeReason" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "previousVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "RedirectPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RespondentSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectCountryId" TEXT NOT NULL,
    "vendorAllocationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "vendorRespondentId" TEXT NOT NULL,
    "status" "RespondentStatus" NOT NULL DEFAULT 'STARTED',
    "statusDetail" TEXT,
    "outcomeVerified" BOOLEAN NOT NULL DEFAULT false,
    "approval" "ApprovalStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "redirectVersionId" TEXT,
    "revenue" DECIMAL(12,2),
    "payout" DECIMAL(12,2),
    "ipHash" TEXT,
    "userAgent" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcomeAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RespondentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RespondentEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "RespondentStatus",
    "source" "EventSource" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RespondentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedirectExecution" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "status" "RespondentStatus" NOT NULL,
    "ruleSource" TEXT,
    "versionId" TEXT,
    "destination" TEXT NOT NULL,
    "usedFallback" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedirectExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallbackDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "body" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "state" "CallbackState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallbackDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_organizationId_code_key" ON "Client"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_organizationId_code_key" ON "Vendor"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Project_activeRedirectVersionId_key" ON "Project"("activeRedirectVersionId");

-- CreateIndex
CREATE INDEX "Project_organizationId_status_idx" ON "Project"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_organizationId_projectCode_key" ON "Project"("organizationId", "projectCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCountry_projectId_countryCode_language_key" ON "ProjectCountry"("projectId", "countryCode", "language");

-- CreateIndex
CREATE UNIQUE INDEX "VendorAllocation_entryCode_key" ON "VendorAllocation"("entryCode");

-- CreateIndex
CREATE UNIQUE INDEX "VendorAllocation_testEntryCode_key" ON "VendorAllocation"("testEntryCode");

-- CreateIndex
CREATE UNIQUE INDEX "VendorAllocation_projectCountryId_vendorId_key" ON "VendorAllocation"("projectCountryId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "RedirectPolicyVersion_projectId_version_key" ON "RedirectPolicyVersion"("projectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RespondentSession_token_key" ON "RespondentSession"("token");

-- CreateIndex
CREATE INDEX "RespondentSession_projectId_status_idx" ON "RespondentSession"("projectId", "status");

-- CreateIndex
CREATE INDEX "RespondentSession_organizationId_startedAt_idx" ON "RespondentSession"("organizationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RespondentSession_vendorAllocationId_vendorRespondentId_isT_key" ON "RespondentSession"("vendorAllocationId", "vendorRespondentId", "isTest");

-- CreateIndex
CREATE UNIQUE INDEX "RespondentEvent_idempotencyKey_key" ON "RespondentEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RespondentEvent_sessionId_idx" ON "RespondentEvent"("sessionId");

-- CreateIndex
CREATE INDEX "RedirectExecution_sessionId_idx" ON "RedirectExecution"("sessionId");

-- CreateIndex
CREATE INDEX "RedirectExecution_createdAt_idx" ON "RedirectExecution"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CallbackDelivery_idempotencyKey_key" ON "CallbackDelivery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CallbackDelivery_state_nextAttemptAt_idx" ON "CallbackDelivery"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_entityType_entityId_idx" ON "AuditEvent"("organizationId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientContactId_fkey" FOREIGN KEY ("clientContactId") REFERENCES "ClientContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_salesPersonId_fkey" FOREIGN KEY ("salesPersonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_activeRedirectVersionId_fkey" FOREIGN KEY ("activeRedirectVersionId") REFERENCES "RedirectPolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCountry" ADD CONSTRAINT "ProjectCountry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaCell" ADD CONSTRAINT "QuotaCell_projectCountryId_fkey" FOREIGN KEY ("projectCountryId") REFERENCES "ProjectCountry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAllocation" ADD CONSTRAINT "VendorAllocation_projectCountryId_fkey" FOREIGN KEY ("projectCountryId") REFERENCES "ProjectCountry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorAllocation" ADD CONSTRAINT "VendorAllocation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedirectPolicyVersion" ADD CONSTRAINT "RedirectPolicyVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RespondentSession" ADD CONSTRAINT "RespondentSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RespondentSession" ADD CONSTRAINT "RespondentSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RespondentSession" ADD CONSTRAINT "RespondentSession_projectCountryId_fkey" FOREIGN KEY ("projectCountryId") REFERENCES "ProjectCountry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RespondentSession" ADD CONSTRAINT "RespondentSession_vendorAllocationId_fkey" FOREIGN KEY ("vendorAllocationId") REFERENCES "VendorAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RespondentSession" ADD CONSTRAINT "RespondentSession_redirectVersionId_fkey" FOREIGN KEY ("redirectVersionId") REFERENCES "RedirectPolicyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RespondentEvent" ADD CONSTRAINT "RespondentEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RespondentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedirectExecution" ADD CONSTRAINT "RedirectExecution_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RespondentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallbackDelivery" ADD CONSTRAINT "CallbackDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
