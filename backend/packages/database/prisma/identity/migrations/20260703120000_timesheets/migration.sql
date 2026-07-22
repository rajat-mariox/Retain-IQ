-- Time tracking: manual/auto time entries + weekly timesheet approval.

CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

CREATE TABLE "TimeEntry" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "projectId" UUID,
    "taskId" UUID,
    "minutes" INTEGER NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TimeEntry_orgId_employeeId_date_idx" ON "TimeEntry"("orgId", "employeeId", "date");
CREATE INDEX "TimeEntry_orgId_date_idx" ON "TimeEntry"("orgId", "date");
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Timesheet" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "totalMinutes" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "decidedBy" UUID,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Timesheet_orgId_employeeId_weekStart_key" ON "Timesheet"("orgId", "employeeId", "weekStart");
CREATE INDEX "Timesheet_orgId_status_idx" ON "Timesheet"("orgId", "status");
CREATE INDEX "Timesheet_orgId_employeeId_weekStart_idx" ON "Timesheet"("orgId", "employeeId", "weekStart");
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
