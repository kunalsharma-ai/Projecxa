-- CreateTable
CREATE TABLE "SampleonOutboundEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "envelope" JSONB NOT NULL,
    "state" "CallbackState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "SampleonOutboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SampleonOutboundEvent_eventId_key" ON "SampleonOutboundEvent"("eventId");

-- CreateIndex
CREATE INDEX "SampleonOutboundEvent_state_nextAttemptAt_idx" ON "SampleonOutboundEvent"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SampleonOutboundEvent_organizationId_projectId_idx" ON "SampleonOutboundEvent"("organizationId", "projectId");

-- AddForeignKey
ALTER TABLE "SampleonOutboundEvent" ADD CONSTRAINT "SampleonOutboundEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

