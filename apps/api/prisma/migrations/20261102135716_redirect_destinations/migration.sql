-- AlterEnum
ALTER TYPE "RedirectVersionState" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "redirectSigningSecret" TEXT;

-- AlterTable
ALTER TABLE "RedirectExecution" ADD COLUMN     "apiFallback" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RedirectPolicyVersion" ADD COLUMN     "scheduleError" TEXT,
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "scheduledById" TEXT;

-- CreateIndex
CREATE INDEX "RedirectPolicyVersion_state_scheduledAt_idx" ON "RedirectPolicyVersion"("state", "scheduledAt");
