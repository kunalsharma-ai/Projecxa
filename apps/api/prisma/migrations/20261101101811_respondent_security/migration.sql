-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "captchaProviders" JSONB;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "captchaStyle" TEXT NOT NULL DEFAULT 'math',
ADD COLUMN     "gateQuestions" JSONB,
ADD COLUMN     "prescreen" JSONB;

-- AlterTable
ALTER TABLE "RespondentSession" ADD COLUMN     "answers" JSONB,
ADD COLUMN     "browserIdHash" TEXT,
ADD COLUMN     "deviceType" TEXT,
ADD COLUMN     "fingerprintHash" TEXT,
ADD COLUMN     "gatePassedAt" TIMESTAMP(3),
ADD COLUMN     "gateRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "geoCountry" TEXT,
ADD COLUMN     "humanAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "humanPassedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TorExitNode" (
    "ip" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TorExitNode_pkey" PRIMARY KEY ("ip")
);

-- CreateIndex
CREATE INDEX "RespondentSession_projectId_fingerprintHash_idx" ON "RespondentSession"("projectId", "fingerprintHash");

-- CreateIndex
CREATE INDEX "RespondentSession_projectId_browserIdHash_idx" ON "RespondentSession"("projectId", "browserIdHash");

-- CreateIndex
CREATE INDEX "RespondentSession_projectId_ipHash_idx" ON "RespondentSession"("projectId", "ipHash");
