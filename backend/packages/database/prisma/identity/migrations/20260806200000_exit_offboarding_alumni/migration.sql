-- Structured exit process, offboarding checklist, and alumni projection.
CREATE TYPE "ExitReason" AS ENUM ('RESIGNATION', 'TERMINATION', 'RETIREMENT', 'CONTRACT_END', 'LAYOFF', 'OTHER');
CREATE TYPE "ExitStatus" AS ENUM ('INITIATED', 'NOTICE_PERIOD', 'CLEARANCE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "OffboardingTaskStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

CREATE TABLE "EmployeeExit" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"             UUID NOT NULL,
  "employeeId"        UUID NOT NULL,
  "reason"            "ExitReason" NOT NULL,
  "status"            "ExitStatus" NOT NULL DEFAULT 'INITIATED',
  "reasonNote"        TEXT,
  "noticeStartDate"   DATE,
  "lastWorkingDay"    DATE,
  "exitInterviewNote" TEXT,
  "rehireEligible"    BOOLEAN NOT NULL DEFAULT true,
  "rehireRating"      INTEGER,
  "initiatedBy"       UUID,
  "initiatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"       TIMESTAMP(3),
  "cancelledAt"       TIMESTAMP(3),
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeExit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeExit_orgId_status_idx" ON "EmployeeExit" ("orgId", "status");
CREATE INDEX "EmployeeExit_orgId_employeeId_idx" ON "EmployeeExit" ("orgId", "employeeId");
ALTER TABLE "EmployeeExit" ADD CONSTRAINT "EmployeeExit_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeExit" ADD CONSTRAINT "EmployeeExit_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OffboardingTask" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"       UUID NOT NULL,
  "exitId"      UUID NOT NULL,
  "title"       TEXT NOT NULL,
  "category"    TEXT NOT NULL,
  "assignee"    TEXT NOT NULL,
  "order"       INTEGER NOT NULL DEFAULT 0,
  "status"      "OffboardingTaskStatus" NOT NULL DEFAULT 'PENDING',
  "completedAt" TIMESTAMP(3),
  "completedBy" UUID,
  "note"        TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OffboardingTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OffboardingTask_orgId_exitId_idx" ON "OffboardingTask" ("orgId", "exitId");
ALTER TABLE "OffboardingTask" ADD CONSTRAINT "OffboardingTask_exitId_fkey"
  FOREIGN KEY ("exitId") REFERENCES "EmployeeExit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmployeeAlumni" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"           UUID NOT NULL,
  "employeeId"      UUID NOT NULL,
  "fullName"        TEXT NOT NULL,
  "workEmail"       TEXT,
  "personalEmail"   TEXT,
  "joiningDate"     DATE,
  "exitDate"        DATE,
  "lastDesignation" TEXT,
  "lastDepartment"  TEXT,
  "exitReason"      "ExitReason",
  "rehireEligible"  BOOLEAN NOT NULL DEFAULT true,
  "rehireRating"    INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeAlumni_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployeeAlumni_employeeId_key" ON "EmployeeAlumni" ("employeeId");
CREATE INDEX "EmployeeAlumni_orgId_rehireEligible_idx" ON "EmployeeAlumni" ("orgId", "rehireEligible");
CREATE INDEX "EmployeeAlumni_orgId_lastDepartment_idx" ON "EmployeeAlumni" ("orgId", "lastDepartment");
ALTER TABLE "EmployeeAlumni" ADD CONSTRAINT "EmployeeAlumni_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeAlumni" ADD CONSTRAINT "EmployeeAlumni_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
