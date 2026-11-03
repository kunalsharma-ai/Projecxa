-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "retention" JSONB,
ADD COLUMN     "retentionRunAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RespondentSession" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "consentAt" TIMESTAMP(3),
ADD COLUMN     "consentVersion" INTEGER;

-- CreateTable
CREATE TABLE "ConsentPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "privacyUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsentPolicy_organizationId_countryCode_key" ON "ConsentPolicy"("organizationId", "countryCode");

-- AddForeignKey
ALTER TABLE "ConsentPolicy" ADD CONSTRAINT "ConsentPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

