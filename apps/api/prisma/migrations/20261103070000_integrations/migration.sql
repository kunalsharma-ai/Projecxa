-- Integrations set up in the app (docs/INTEGRATIONS.md)
ALTER TABLE "Organization" ADD COLUMN "platformOwner" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "IntegrationSetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "secrets" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestMessage" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationSetting_organizationId_kind_key" ON "IntegrationSetting"("organizationId", "kind");

ALTER TABLE "IntegrationSetting" ADD CONSTRAINT "IntegrationSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The oldest organisation runs the server unless one is marked.
UPDATE "Organization" SET "platformOwner" = true WHERE "id" = (SELECT "id" FROM "Organization" ORDER BY "createdAt" ASC LIMIT 1);
