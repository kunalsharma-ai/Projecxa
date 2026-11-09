-- CreateTable
CREATE TABLE "RoutingRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectCountryId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "actorId" TEXT,
    "moves" JSONB NOT NULL,
    "targets" JSONB NOT NULL,
    "explanation" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,

    CONSTRAINT "RoutingRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutingRun_projectId_createdAt_idx" ON "RoutingRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "RoutingRun_projectCountryId_createdAt_idx" ON "RoutingRun"("projectCountryId", "createdAt");

-- AddForeignKey
ALTER TABLE "RoutingRun" ADD CONSTRAINT "RoutingRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRun" ADD CONSTRAINT "RoutingRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRun" ADD CONSTRAINT "RoutingRun_projectCountryId_fkey" FOREIGN KEY ("projectCountryId") REFERENCES "ProjectCountry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
