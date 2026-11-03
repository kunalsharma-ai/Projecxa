-- AlterTable
ALTER TABLE "QuotaCell" ADD COLUMN     "conditions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "group" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "isOpen" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "RespondentSession" ADD COLUMN     "quotaCellIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "QuotaCell_projectCountryId_idx" ON "QuotaCell"("projectCountryId");
