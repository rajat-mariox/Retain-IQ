-- Employee Management: designations catalog + employee lifecycle stages.

-- 1) Lifecycle stage enum + Employee columns
CREATE TYPE "LifecycleStage" AS ENUM ('ONBOARDING', 'PROBATION', 'CONFIRMED', 'EXITED');

ALTER TABLE "Employee"
  ADD COLUMN "designationId" UUID,
  ADD COLUMN "lifecycleStage" "LifecycleStage" NOT NULL DEFAULT 'ONBOARDING',
  ADD COLUMN "probationEndsAt" TIMESTAMP(3),
  ADD COLUMN "confirmedAt" TIMESTAMP(3);

-- 2) Designation catalog
CREATE TABLE "Designation" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "level" TEXT,
    "departmentId" UUID,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Designation_orgId_status_idx" ON "Designation"("orgId", "status");
CREATE INDEX "Designation_orgId_departmentId_idx" ON "Designation"("orgId", "departmentId");

ALTER TABLE "Designation" ADD CONSTRAINT "Designation_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Designation" ADD CONSTRAINT "Designation_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Employee -> Designation FK + indexes
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_designationId_fkey"
    FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Employee_orgId_designationId_idx" ON "Employee"("orgId", "designationId");
CREATE INDEX "Employee_orgId_lifecycleStage_idx" ON "Employee"("orgId", "lifecycleStage");

-- 4) Backfill existing employees: established staff are CONFIRMED; exited stay EXITED.
UPDATE "Employee" SET "lifecycleStage" = 'EXITED' WHERE "status" = 'EXITED';
UPDATE "Employee"
   SET "lifecycleStage" = 'CONFIRMED',
       "confirmedAt" = COALESCE("joinedAt", "createdAt")
 WHERE "status" <> 'EXITED';
