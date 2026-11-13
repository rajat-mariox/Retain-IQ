-- Hiring requisitions (job openings) — powers the executive "Open positions" metric.
CREATE TYPE "RequisitionStatus" AS ENUM ('OPEN', 'ON_HOLD', 'FILLED', 'CLOSED');

CREATE TABLE "Requisition" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" UUID,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Requisition_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Requisition_orgId_status_idx" ON "Requisition"("orgId", "status");

ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
