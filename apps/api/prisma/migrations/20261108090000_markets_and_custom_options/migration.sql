-- The same country can now be a market more than once (one per target group).
DROP INDEX "ProjectCountry_projectId_countryCode_language_key";
CREATE INDEX "ProjectCountry_projectId_idx" ON "ProjectCountry"("projectId");

-- Options people add to dropdowns themselves ("Add +").
CREATE TABLE "CustomOption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomOption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomOption_organizationId_field_value_key" ON "CustomOption"("organizationId", "field", "value");
ALTER TABLE "CustomOption" ADD CONSTRAINT "CustomOption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
