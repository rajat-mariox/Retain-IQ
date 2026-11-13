-- Visibility-scoped manager/HR remarks about an employee.
CREATE TYPE "RemarkVisibility" AS ENUM ('MANAGER_ONLY', 'HR_ONLY', 'HR_AND_MANAGER', 'EMPLOYEE_VISIBLE', 'ADMIN_ONLY');

CREATE TABLE "EmployeeRemark" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"         UUID NOT NULL,
  "employeeId"    UUID NOT NULL,
  "visibility"    "RemarkVisibility" NOT NULL DEFAULT 'MANAGER_ONLY',
  "reason"        TEXT,
  "content"       TEXT NOT NULL,
  "createdBy"     UUID,
  "createdByName" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeRemark_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeRemark_orgId_employeeId_createdAt_idx" ON "EmployeeRemark" ("orgId", "employeeId", "createdAt");
ALTER TABLE "EmployeeRemark" ADD CONSTRAINT "EmployeeRemark_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
