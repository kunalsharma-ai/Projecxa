-- Live client dashboard links (docs/CLIENT_DASHBOARD_LINKS.md)
CREATE TABLE "ClientDashboardLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "showMoney" BOOLEAN NOT NULL DEFAULT false,
    "showVendors" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientDashboardLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientDashboardLink_token_key" ON "ClientDashboardLink"("token");
CREATE INDEX "ClientDashboardLink_projectId_idx" ON "ClientDashboardLink"("projectId");

ALTER TABLE "ClientDashboardLink" ADD CONSTRAINT "ClientDashboardLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientDashboardLink" ADD CONSTRAINT "ClientDashboardLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
