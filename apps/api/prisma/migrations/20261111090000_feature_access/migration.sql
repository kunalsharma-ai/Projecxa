-- Admin layer of feature control (docs/FEATURE_ACCESS.md): who in the organisation gets each feature.
ALTER TABLE "Organization" ADD COLUMN "featureAccess" JSONB;

-- Features that used to sit under a bigger feature now have their own switch. Plans that already
-- included the bigger feature keep them, so nobody loses anything. Team chat is new and is left out:
-- the Super Admin adds it to the plans that should have it.
UPDATE "Plan" SET "features" = "features" || ARRAY(SELECT k FROM unnest(ARRAY['collaboration','client_dashboards','vendor_routing','fraud_checks']) k WHERE NOT k = ANY("features"))
  WHERE 'projects' = ANY("features");
UPDATE "Plan" SET "features" = "features" || ARRAY['forecasting'] WHERE 'monitor' = ANY("features") AND NOT 'forecasting' = ANY("features");
UPDATE "Plan" SET "features" = "features" || ARRAY['languages'] WHERE NOT 'languages' = ANY("features");
UPDATE "Plan" SET "mobileFeatures" = "mobileFeatures" || ARRAY['collaboration'] WHERE 'projects' = ANY("mobileFeatures") AND NOT 'collaboration' = ANY("mobileFeatures");
UPDATE "Plan" SET "mobileFeatures" = "mobileFeatures" || ARRAY['forecasting'] WHERE 'monitor' = ANY("mobileFeatures") AND NOT 'forecasting' = ANY("mobileFeatures");
UPDATE "Plan" SET "mobileFeatures" = "mobileFeatures" || ARRAY['languages'] WHERE NOT 'languages' = ANY("mobileFeatures");
