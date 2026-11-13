-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'RESOLVED', 'PROMOTED');

-- CreateTable
CREATE TABLE "Escalation" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "observationId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "severity" "Severity" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "status" "EscalationStatus" NOT NULL DEFAULT 'PENDING',
    "escalatedBy" UUID,
    "assignedTo" UUID,
    "reason" TEXT,
    "dueAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Escalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "escalationId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "level" INTEGER,
    "actorUserId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscalationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Escalation_observationId_key" ON "Escalation"("observationId");

-- CreateIndex
CREATE INDEX "Escalation_orgId_status_idx" ON "Escalation"("orgId", "status");

-- CreateIndex
CREATE INDEX "Escalation_orgId_assignedTo_status_idx" ON "Escalation"("orgId", "assignedTo", "status");

-- CreateIndex
CREATE INDEX "Escalation_status_dueAt_idx" ON "Escalation"("status", "dueAt");

-- CreateIndex
CREATE INDEX "EscalationEvent_escalationId_idx" ON "EscalationEvent"("escalationId");

-- AddForeignKey
ALTER TABLE "Escalation" ADD CONSTRAINT "Escalation_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationEvent" ADD CONSTRAINT "EscalationEvent_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "Escalation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
