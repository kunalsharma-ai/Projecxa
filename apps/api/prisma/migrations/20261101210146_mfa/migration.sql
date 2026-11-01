-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "mfaRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaEnabledAt" TIMESTAMP(3),
ADD COLUMN     "mfaFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mfaLastStep" INTEGER,
ADD COLUMN     "mfaLockedUntil" TIMESTAMP(3),
ADD COLUMN     "mfaPendingSecret" TEXT,
ADD COLUMN     "mfaRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mfaSecret" TEXT;
