-- Promotion/Transfer change requests, approval chain, immutable career history,
-- and org-level approval-chain settings.
CREATE TYPE "ChangeRequestKind" AS ENUM ('PROMOTION', 'TRANSFER');
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'APPLIED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ChangeStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

CREATE TABLE "EmployeeChangeRequest" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"         UUID NOT NULL,
  "employeeId"    UUID NOT NULL,
  "kind"          "ChangeRequestKind" NOT NULL,
  "status"        "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "proposed"      JSONB NOT NULL,
  "previous"      JSONB NOT NULL,
  "reason"        TEXT,
  "effectiveDate" DATE NOT NULL,
  "requestedBy"   UUID,
  "decidedAt"     TIMESTAMP(3),
  "appliedAt"     TIMESTAMP(3),
  "cancelledAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeChangeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeChangeRequest_orgId_employeeId_idx" ON "EmployeeChangeRequest" ("orgId", "employeeId");
CREATE INDEX "EmployeeChangeRequest_orgId_status_idx" ON "EmployeeChangeRequest" ("orgId", "status");
CREATE INDEX "EmployeeChangeRequest_status_effectiveDate_idx" ON "EmployeeChangeRequest" ("status", "effectiveDate");
ALTER TABLE "EmployeeChangeRequest" ADD CONSTRAINT "EmployeeChangeRequest_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeChangeRequest" ADD CONSTRAINT "EmployeeChangeRequest_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChangeApprovalStep" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"      UUID NOT NULL,
  "requestId"  UUID NOT NULL,
  "order"      INTEGER NOT NULL,
  "role"       TEXT NOT NULL,
  "assignedTo" UUID,
  "status"     "ChangeStepStatus" NOT NULL DEFAULT 'PENDING',
  "decidedBy"  UUID,
  "decidedAt"  TIMESTAMP(3),
  "note"       TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChangeApprovalStep_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChangeApprovalStep_orgId_requestId_order_idx" ON "ChangeApprovalStep" ("orgId", "requestId", "order");
ALTER TABLE "ChangeApprovalStep" ADD CONSTRAINT "ChangeApprovalStep_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "EmployeeChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmployeeCareerHistory" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"               UUID NOT NULL,
  "employeeId"          UUID NOT NULL,
  "changeType"          TEXT NOT NULL,
  "previousDesignation" TEXT,
  "newDesignation"      TEXT,
  "previousDepartment"  TEXT,
  "newDepartment"       TEXT,
  "previousManager"     TEXT,
  "newManager"          TEXT,
  "previousLocation"    TEXT,
  "newLocation"         TEXT,
  "reason"              TEXT,
  "effectiveFrom"       DATE NOT NULL,
  "approvedBy"          UUID,
  "requestId"           UUID,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeCareerHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeCareerHistory_orgId_employeeId_effectiveFrom_idx" ON "EmployeeCareerHistory" ("orgId", "employeeId", "effectiveFrom");
ALTER TABLE "EmployeeCareerHistory" ADD CONSTRAINT "EmployeeCareerHistory_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkforceSetting" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"          UUID NOT NULL,
  "promotionChain" TEXT[] NOT NULL DEFAULT ARRAY['MANAGER', 'HR', 'FINANCE'],
  "transferChain"  TEXT[] NOT NULL DEFAULT ARRAY['MANAGER', 'NEW_MANAGER', 'HR'],
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkforceSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkforceSetting_orgId_key" ON "WorkforceSetting" ("orgId");
ALTER TABLE "WorkforceSetting" ADD CONSTRAINT "WorkforceSetting_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
