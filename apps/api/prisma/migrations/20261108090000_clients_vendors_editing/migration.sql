-- Clients, vendors and redirects editing (docs/CLIENTS_VENDORS_EDITING.md)
ALTER TABLE "Client" ADD COLUMN "website" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "redirectUrls" JSONB,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "contactEmail" TEXT,
  ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "Project" ADD COLUMN "vendorTitle" TEXT;
