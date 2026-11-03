-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "ssoConfig" JSONB;

-- CreateTable
CREATE TABLE "SsoIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SsoIdentity_userId_idx" ON "SsoIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SsoIdentity_provider_subject_key" ON "SsoIdentity"("provider", "subject");

-- AddForeignKey
ALTER TABLE "SsoIdentity" ADD CONSTRAINT "SsoIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
