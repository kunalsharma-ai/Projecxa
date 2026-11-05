-- Product tour shown after sign-in (docs/PRODUCT_TOUR.md)
ALTER TABLE "User" ADD COLUMN "tourVersion" INTEGER;
ALTER TABLE "User" ADD COLUMN "tourOutcome" TEXT;
ALTER TABLE "User" ADD COLUMN "tourAt" TIMESTAMP(3);
