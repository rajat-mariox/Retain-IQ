-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ObservationSource" AS ENUM ('AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "ObservationType" AS ENUM ('PRODUCTIVITY_DROP', 'BURNOUT_RISK', 'LOW_ENGAGEMENT', 'ATTENDANCE_ANOMALY', 'LATE_PATTERN', 'BEHAVIOUR', 'OTHER');

-- CreateEnum
CREATE TYPE "ObservationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'ESCALATED', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "Observation" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "source" "ObservationSource" NOT NULL,
    "type" "ObservationType" NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "status" "ObservationStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "metricJson" JSONB,
    "assignedTo" UUID,
    "createdBy" UUID,
    "dedupeKey" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObservationEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "observationId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "actorUserId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObservationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObservationComment" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "observationId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObservationComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObservationEvidence" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "observationId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "uploadedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObservationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Observation_dedupeKey_key" ON "Observation"("dedupeKey");

-- CreateIndex
CREATE INDEX "Observation_orgId_status_idx" ON "Observation"("orgId", "status");

-- CreateIndex
CREATE INDEX "Observation_orgId_employeeId_idx" ON "Observation"("orgId", "employeeId");

-- CreateIndex
CREATE INDEX "Observation_orgId_assignedTo_status_idx" ON "Observation"("orgId", "assignedTo", "status");

-- CreateIndex
CREATE INDEX "ObservationEvent_observationId_idx" ON "ObservationEvent"("observationId");

-- CreateIndex
CREATE INDEX "ObservationComment_observationId_idx" ON "ObservationComment"("observationId");

-- CreateIndex
CREATE UNIQUE INDEX "ObservationEvidence_key_key" ON "ObservationEvidence"("key");

-- CreateIndex
CREATE INDEX "ObservationEvidence_orgId_observationId_idx" ON "ObservationEvidence"("orgId", "observationId");

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservationEvent" ADD CONSTRAINT "ObservationEvent_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservationComment" ADD CONSTRAINT "ObservationComment_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservationEvidence" ADD CONSTRAINT "ObservationEvidence_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
