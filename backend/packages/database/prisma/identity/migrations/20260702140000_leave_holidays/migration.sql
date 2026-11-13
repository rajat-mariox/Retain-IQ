-- Leave management + holidays.

CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "LeaveType" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "annualQuota" INTEGER NOT NULL DEFAULT 0,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeaveType_orgId_code_key" ON "LeaveType"("orgId", "code");
CREATE INDEX "LeaveType_orgId_status_idx" ON "LeaveType"("orgId", "status");
ALTER TABLE "LeaveType" ADD CONSTRAINT "LeaveType_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "LeaveRequest" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "leaveTypeId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "decidedBy" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeaveRequest_orgId_status_idx" ON "LeaveRequest"("orgId", "status");
CREATE INDEX "LeaveRequest_orgId_employeeId_status_idx" ON "LeaveRequest"("orgId", "employeeId", "status");
CREATE INDEX "LeaveRequest_orgId_startDate_endDate_idx" ON "LeaveRequest"("orgId", "startDate", "endDate");
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey"
    FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Holiday" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'COMPANY',
    "departmentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Holiday_orgId_date_idx" ON "Holiday"("orgId", "date");
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed common leave types per org so the module is usable immediately.
INSERT INTO "LeaveType" ("id", "orgId", "name", "code", "annualQuota", "paid", "color", "updatedAt")
SELECT gen_random_uuid(), o."id", t.name, t.code, t.quota, t.paid, t.color, CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES
  ('Annual Leave', 'AL', 18, true, '#16a34a'),
  ('Sick Leave', 'SL', 12, true, '#d97706'),
  ('Casual Leave', 'CL', 6, true, '#0284c7'),
  ('Unpaid Leave', 'LWP', 0, false, '#64748b')
) AS t(name, code, quota, paid, color);
