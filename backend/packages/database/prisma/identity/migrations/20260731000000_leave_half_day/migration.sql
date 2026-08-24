-- Half-day leave support. days becomes fractional (0.5 for a half-day); dayPart
-- names which half. Additive + behaviour-preserving: existing whole-day requests
-- keep their integer value (now stored as a float) and default to FULL.

-- Int -> double precision (Float). Existing values cast cleanly (5 -> 5.0).
ALTER TABLE "LeaveRequest"
  ALTER COLUMN "days" TYPE DOUBLE PRECISION USING "days"::double precision,
  ALTER COLUMN "days" SET DEFAULT 0;

ALTER TABLE "LeaveRequest"
  ADD COLUMN "dayPart" TEXT NOT NULL DEFAULT 'FULL';
