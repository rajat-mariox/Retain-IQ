-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "ConsumedEvent" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "orgId" UUID,
    "payload" JSONB NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsumedEvent_orgId_consumedAt_idx" ON "ConsumedEvent"("orgId", "consumedAt");

-- CreateIndex
CREATE INDEX "ConsumedEvent_eventType_consumedAt_idx" ON "ConsumedEvent"("eventType", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumedEvent_eventId_consumer_key" ON "ConsumedEvent"("eventId", "consumer");

