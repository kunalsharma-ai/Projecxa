-- SAMPLEON: map PROJEXA quota questions onto SUPPLY360 profile attributes.
ALTER TABLE "Project" ADD COLUMN "sampleonQuotaMap" JSONB;
ALTER TABLE "SampleonAudienceRequest" ADD COLUMN "usesProjectQuotas" BOOLEAN NOT NULL DEFAULT false;
