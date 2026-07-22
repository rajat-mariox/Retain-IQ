-- Break tracking + per-direction source on attendance.
ALTER TABLE "AttendanceRecord"
  ADD COLUMN "breakMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "checkOutSource" TEXT;

-- One row per break; an open row (endedAt IS NULL) = currently on break.
CREATE TABLE "AttendanceBreak" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "attendanceId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'BREAK',
    "source" TEXT NOT NULL DEFAULT 'web',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceBreak_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AttendanceBreak_orgId_employeeId_startedAt_idx" ON "AttendanceBreak"("orgId", "employeeId", "startedAt");
CREATE INDEX "AttendanceBreak_attendanceId_idx" ON "AttendanceBreak"("attendanceId");

ALTER TABLE "AttendanceBreak" ADD CONSTRAINT "AttendanceBreak_attendanceId_fkey"
  FOREIGN KEY ("attendanceId") REFERENCES "AttendanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one open break per attendance day.
CREATE UNIQUE INDEX "AttendanceBreak_one_open_per_day"
  ON "AttendanceBreak"("attendanceId") WHERE "endedAt" IS NULL;
