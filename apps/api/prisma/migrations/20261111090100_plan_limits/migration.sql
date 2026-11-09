-- Usage limits per plan and per organisation (docs/PLAN_LIMITS.md).
ALTER TABLE "Plan" ADD COLUMN "limits" JSONB;
ALTER TABLE "Subscription" ADD COLUMN "limits" JSONB;
