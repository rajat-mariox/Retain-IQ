-- Platform activity feed: org-level actions logged by identity-service.
CREATE TABLE "PlatformEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID,
    "actorUserId" UUID,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlatformEvent_createdAt_idx" ON "PlatformEvent"("createdAt");
