-- Attendance redesign: sessions become the source of truth, AttendanceRecord
-- becomes a derived per-day roll-up. Existing data is migrated, not dropped:
-- every current record becomes exactly one session so history stays intact.

-- 1. New state enum ---------------------------------------------------------
CREATE TYPE "AttendanceState" AS ENUM (
  'NOT_CHECKED_IN', 'WORKING', 'ON_BREAK', 'CHECKED_OUT',
  'COMPLETED', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKEND'
);

-- 2. Extend the day roll-up -------------------------------------------------
ALTER TABLE "AttendanceRecord"
  ADD COLUMN "unpaidBreakMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "overtimeMinutes"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lateMinutes"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "earlyExitMinutes"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "workLocation"       TEXT,
  ADD COLUMN "state" "AttendanceState" NOT NULL DEFAULT 'NOT_CHECKED_IN';

CREATE INDEX "AttendanceRecord_orgId_day_state_idx" ON "AttendanceRecord"("orgId", "day", "state");

-- 3. Sessions ---------------------------------------------------------------
CREATE TABLE "AttendanceSession" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "attendanceId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "startSource" TEXT NOT NULL DEFAULT 'web',
    "endSource" TEXT,
    "workLocation" TEXT,
    "startIp" TEXT,
    "endIp" TEXT,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AttendanceSession_orgId_employeeId_startedAt_idx" ON "AttendanceSession"("orgId", "employeeId", "startedAt");
CREATE INDEX "AttendanceSession_attendanceId_sequence_idx" ON "AttendanceSession"("attendanceId", "sequence");
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_attendanceId_fkey"
  FOREIGN KEY ("attendanceId") REFERENCES "AttendanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one OPEN session per day — the core guard against double check-in.
CREATE UNIQUE INDEX "AttendanceSession_one_open_per_day"
  ON "AttendanceSession"("attendanceId") WHERE "endedAt" IS NULL;

-- 4. Breaks: attach to a session, add paid flag ------------------------------
ALTER TABLE "AttendanceBreak"
  ADD COLUMN "sessionId" UUID,
  ADD COLUMN "paid" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "AttendanceBreak_sessionId_idx" ON "AttendanceBreak"("sessionId");
ALTER TABLE "AttendanceBreak" ADD CONSTRAINT "AttendanceBreak_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Event audit trail ------------------------------------------------------
CREATE TABLE "AttendanceEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "attendanceId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "fromState" "AttendanceState",
    "toState" "AttendanceState",
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'web',
    "actorUserId" UUID,
    "workLocation" TEXT,
    "ipAddress" TEXT,
    "note" TEXT,
    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AttendanceEvent_orgId_employeeId_occurredAt_idx" ON "AttendanceEvent"("orgId", "employeeId", "occurredAt");
CREATE INDEX "AttendanceEvent_attendanceId_occurredAt_idx" ON "AttendanceEvent"("attendanceId", "occurredAt");
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_attendanceId_fkey"
  FOREIGN KEY ("attendanceId") REFERENCES "AttendanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Per-org policy (owned by the platform admin) ---------------------------
CREATE TABLE "AttendancePolicy" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "allowMultipleSessions" BOOLEAN NOT NULL DEFAULT false,
    "allowReEntry" BOOLEAN NOT NULL DEFAULT false,
    "maxSessionsPerDay" INTEGER NOT NULL DEFAULT 1,
    "maxBreaksPerDay" INTEGER NOT NULL DEFAULT 0,
    "maxBreakMinutesPerDay" INTEGER NOT NULL DEFAULT 0,
    "maxSingleBreakMinutes" INTEGER NOT NULL DEFAULT 0,
    "paidBreakMinutesPerDay" INTEGER NOT NULL DEFAULT 0,
    "allowCheckOutOnBreak" BOOLEAN NOT NULL DEFAULT false,
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "autoCheckOutAtShiftEnd" BOOLEAN NOT NULL DEFAULT false,
    "autoCheckOutAfterMinutes" INTEGER NOT NULL DEFAULT 120,
    "overtimeAfterMinutes" INTEGER NOT NULL DEFAULT 0,
    "minHoursForPresent" INTEGER NOT NULL DEFAULT 240,
    "workModel" TEXT NOT NULL DEFAULT 'WFO',
    "allowedLocations" TEXT[] DEFAULT ARRAY['OFFICE','HOME','CLIENT_SITE','REMOTE']::TEXT[],
    "requireLocation" BOOLEAN NOT NULL DEFAULT false,
    "allowManualCorrection" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendancePolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AttendancePolicy_orgId_key" ON "AttendancePolicy"("orgId");
ALTER TABLE "AttendancePolicy" ADD CONSTRAINT "AttendancePolicy_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Backfill: one session per existing record ------------------------------
INSERT INTO "AttendanceSession"
  ("id","orgId","employeeId","attendanceId","sequence","startedAt","endedAt","minutes",
   "startSource","endSource","createdAt")
SELECT gen_random_uuid(), r."orgId", r."employeeId", r.id, 1,
       r."checkInAt",
       r."checkOutAt",
       -- Gross session minutes; breaks stay accounted for on the day roll-up.
       CASE WHEN r."checkInAt" IS NOT NULL AND r."checkOutAt" IS NOT NULL
            THEN GREATEST(0, (EXTRACT(EPOCH FROM (r."checkOutAt" - r."checkInAt")) / 60)::int)
            ELSE 0 END,
       COALESCE(r."source", 'web'), r."checkOutSource", r."createdAt"
FROM "AttendanceRecord" r
WHERE r."checkInAt" IS NOT NULL;

-- Point existing breaks at the session that now covers their day.
UPDATE "AttendanceBreak" b
SET "sessionId" = s.id
FROM "AttendanceSession" s
WHERE s."attendanceId" = b."attendanceId" AND b."sessionId" IS NULL;

-- 8. Backfill derived state on existing days --------------------------------
UPDATE "AttendanceRecord" r SET "state" =
  CASE
    WHEN r."checkInAt" IS NULL THEN 'NOT_CHECKED_IN'::"AttendanceState"
    WHEN EXISTS (SELECT 1 FROM "AttendanceBreak" b
                 WHERE b."attendanceId" = r.id AND b."endedAt" IS NULL)
      THEN 'ON_BREAK'::"AttendanceState"
    WHEN r."checkOutAt" IS NOT NULL THEN 'CHECKED_OUT'::"AttendanceState"
    ELSE 'WORKING'::"AttendanceState"
  END;

-- Existing break minutes were all treated as unpaid, matching prior behaviour.
UPDATE "AttendanceRecord" SET "unpaidBreakMinutes" = "breakMinutes" WHERE "breakMinutes" > 0;
