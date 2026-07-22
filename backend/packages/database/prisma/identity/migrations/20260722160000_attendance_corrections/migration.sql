-- Manual correction requests + manager-approved overtime.

CREATE TYPE "AttendanceCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- Overtime is computed, but only the approved portion is payable.
ALTER TABLE "AttendanceRecord"
  ADD COLUMN "approvedOvertimeMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "overtimeApprovedBy" UUID,
  ADD COLUMN "overtimeApprovedAt" TIMESTAMP(3);

CREATE TABLE "AttendanceCorrection" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "attendanceId" UUID,
    "day" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedCheckInAt" TIMESTAMP(3),
    "requestedCheckOutAt" TIMESTAMP(3),
    "requestedOvertimeMinutes" INTEGER,
    "status" "AttendanceCorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedBy" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "previousState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AttendanceCorrection_orgId_status_createdAt_idx" ON "AttendanceCorrection"("orgId", "status", "createdAt");
CREATE INDEX "AttendanceCorrection_orgId_employeeId_day_idx" ON "AttendanceCorrection"("orgId", "employeeId", "day");

ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_attendanceId_fkey"
  FOREIGN KEY ("attendanceId") REFERENCES "AttendanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One open request per employee per day: stops a queue of contradictory edits.
CREATE UNIQUE INDEX "AttendanceCorrection_one_pending_per_day"
  ON "AttendanceCorrection"("orgId", "employeeId", "day") WHERE "status" = 'PENDING';
