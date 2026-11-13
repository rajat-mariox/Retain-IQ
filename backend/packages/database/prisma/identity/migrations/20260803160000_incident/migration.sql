-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('ATTENDANCE', 'PRODUCTIVITY', 'BEHAVIOUR', 'SECURITY', 'COMPLIANCE');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "Incident" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "employeeId" UUID,
    "escalationId" UUID,
    "category" "IncidentCategory" NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "assignedTo" UUID,
    "openedBy" UUID,
    "investigationNote" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "actorUserId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentComment" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEvidence" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "uploadedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Incident_escalationId_key" ON "Incident"("escalationId");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_orgId_reference_key" ON "Incident"("orgId", "reference");

-- CreateIndex
CREATE INDEX "Incident_orgId_status_idx" ON "Incident"("orgId", "status");

-- CreateIndex
CREATE INDEX "Incident_orgId_category_status_idx" ON "Incident"("orgId", "category", "status");

-- CreateIndex
CREATE INDEX "IncidentEvent_incidentId_idx" ON "IncidentEvent"("incidentId");

-- CreateIndex
CREATE INDEX "IncidentComment_incidentId_idx" ON "IncidentComment"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentEvidence_key_key" ON "IncidentEvidence"("key");

-- CreateIndex
CREATE INDEX "IncidentEvidence_orgId_incidentId_idx" ON "IncidentEvidence"("orgId", "incidentId");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "Escalation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentComment" ADD CONSTRAINT "IncidentComment_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvidence" ADD CONSTRAINT "IncidentEvidence_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
