-- Rotating shift schedules: an ordered list of shifts held for N days each,
-- repeating on a fixed cycle from an anchor date. Employees can be assigned a
-- rotation, which overrides their fixed shift when resolving the active shift.

CREATE TABLE "ShiftRotation" (
  "id"         UUID NOT NULL,
  "orgId"      UUID NOT NULL,
  "name"       TEXT NOT NULL,
  "anchorDate" DATE NOT NULL,
  "steps"      JSONB NOT NULL DEFAULT '[]',
  "status"     TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShiftRotation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShiftRotation_orgId_status_idx" ON "ShiftRotation"("orgId", "status");
ALTER TABLE "ShiftRotation" ADD CONSTRAINT "ShiftRotation_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Employee" ADD COLUMN "rotationId" UUID;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_rotationId_fkey"
  FOREIGN KEY ("rotationId") REFERENCES "ShiftRotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
