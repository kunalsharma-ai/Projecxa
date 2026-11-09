-- CreateEnum
CREATE TYPE "ChatChannelKind" AS ENUM ('GENERAL', 'ANNOUNCEMENTS', 'PROJECT', 'DIRECT', 'GROUP');

-- CreateTable
CREATE TABLE "ChatChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "ChatChannelKind" NOT NULL,
    "name" TEXT,
    "projectId" TEXT,
    "key" TEXT,
    "adminsOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),

    CONSTRAINT "ChatChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMember" (
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "member" BOOLEAN NOT NULL DEFAULT true,
    "readSeq" INTEGER NOT NULL DEFAULT 0,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("channelId","userId")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "tone" TEXT,
    "body" TEXT NOT NULL,
    "clientId" TEXT,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_projectId_key" ON "ChatChannel"("projectId");

-- CreateIndex
CREATE INDEX "ChatChannel_organizationId_kind_idx" ON "ChatChannel"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannel_organizationId_key_key" ON "ChatChannel"("organizationId", "key");

-- CreateIndex
CREATE INDEX "ChatMember_userId_idx" ON "ChatMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_seq_key" ON "ChatMessage"("seq");

-- CreateIndex
CREATE INDEX "ChatMessage_channelId_updatedAt_idx" ON "ChatMessage"("channelId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_channelId_seq_idx" ON "ChatMessage"("channelId", "seq");

-- CreateIndex
CREATE INDEX "ChatMessage_organizationId_seq_idx" ON "ChatMessage"("organizationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_authorId_clientId_key" ON "ChatMessage"("authorId", "clientId");

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannel" ADD CONSTRAINT "ChatChannel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

