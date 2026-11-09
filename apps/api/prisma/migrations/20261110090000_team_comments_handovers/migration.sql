-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('OPEN', 'ACCEPTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ProjectComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mentionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectHandover" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "note" TEXT,
    "status" "HandoverStatus" NOT NULL DEFAULT 'OPEN',
    "items" JSONB NOT NULL,
    "makeManager" BOOLEAN NOT NULL DEFAULT true,
    "acceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectHandover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectComment_projectId_createdAt_idx" ON "ProjectComment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectComment_organizationId_createdAt_idx" ON "ProjectComment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectHandover_projectId_createdAt_idx" ON "ProjectHandover"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectHandover_toUserId_status_idx" ON "ProjectHandover"("toUserId", "status");

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectHandover" ADD CONSTRAINT "ProjectHandover_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
