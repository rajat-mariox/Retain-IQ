-- CreateTable: discussion thread on a task. Authored by a member (authorUserId);
-- the author's display name is resolved at read time from their membership.
CREATE TABLE "TaskComment" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the thread read — one task's comments in posting order, tenant-scoped.
CREATE INDEX "TaskComment_orgId_taskId_createdAt_idx" ON "TaskComment"("orgId", "taskId", "createdAt");

-- AddForeignKey: deleting a task drops its discussion with it.
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
