-- Organisation's own gate survey question sets (docs/GATE_QUESTION_SETS.md).
CREATE TABLE "QuestionSet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "questions" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuestionSet_organizationId_key_key" ON "QuestionSet"("organizationId", "key");

ALTER TABLE "QuestionSet" ADD CONSTRAINT "QuestionSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
