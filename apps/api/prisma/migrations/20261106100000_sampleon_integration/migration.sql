-- SAMPLEON integration: audience requests for PROJEXA projects (SAMPLEON docs/ECOSYSTEM_ARCHITECTURE.md).
CREATE TABLE "SampleonAudienceRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "audienceRequestId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requiredCompletes" INTEGER NOT NULL,
    "completes" INTEGER NOT NULL DEFAULT 0,
    "remaining" INTEGER,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "progressSequence" INTEGER NOT NULL DEFAULT 0,
    "lastEventType" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SampleonAudienceRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SampleonAudienceRequest_audienceRequestId_key" ON "SampleonAudienceRequest"("audienceRequestId");
CREATE INDEX "SampleonAudienceRequest_organizationId_projectId_idx" ON "SampleonAudienceRequest"("organizationId", "projectId");
ALTER TABLE "SampleonAudienceRequest" ADD CONSTRAINT "SampleonAudienceRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SampleonInboundEvent" (
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "audienceRequestId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SampleonInboundEvent_pkey" PRIMARY KEY ("eventId")
);
