-- Minimum minutes after check-in before a break / check-out is allowed (0 = off).
-- Prevents checking in and immediately taking a break or checking out.
ALTER TABLE "AttendancePolicy"
  ADD COLUMN "minMinutesBeforeBreak" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "minMinutesBeforeCheckOut" INTEGER NOT NULL DEFAULT 0;
