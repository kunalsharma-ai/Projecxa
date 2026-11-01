-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "pageDesign" JSONB;

-- CreateTable
CREATE TABLE "PageAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageAsset_organizationId_projectId_idx" ON "PageAsset"("organizationId", "projectId");

-- AddForeignKey
ALTER TABLE "PageAsset" ADD CONSTRAINT "PageAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
