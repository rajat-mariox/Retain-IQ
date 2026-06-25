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

-- CreateTable
CREATE TABLE "EmployeeDayFact" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "idleSeconds" INTEGER NOT NULL DEFAULT 0,
    "productiveSeconds" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "productivityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "focusScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDayFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsumedEvent_orgId_consumedAt_idx" ON "ConsumedEvent"("orgId", "consumedAt");

-- CreateIndex
CREATE INDEX "ConsumedEvent_eventType_consumedAt_idx" ON "ConsumedEvent"("eventType", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumedEvent_eventId_consumer_key" ON "ConsumedEvent"("eventId", "consumer");

-- CreateIndex
CREATE INDEX "EmployeeDayFact_orgId_day_idx" ON "EmployeeDayFact"("orgId", "day");

-- CreateIndex
CREATE INDEX "EmployeeDayFact_orgId_employeeId_day_idx" ON "EmployeeDayFact"("orgId", "employeeId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDayFact_orgId_employeeId_day_key" ON "EmployeeDayFact"("orgId", "employeeId", "day");

