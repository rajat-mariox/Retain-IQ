-- Append-only billing lifecycle events for the platform activity feed.
CREATE TABLE "BillingEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "planId" TEXT,
    "amountCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BillingEvent_createdAt_idx" ON "BillingEvent"("createdAt");
