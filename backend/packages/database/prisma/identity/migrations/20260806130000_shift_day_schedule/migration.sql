-- Per-weekday shift windows: optional [{ day, startMinute, endMinute, graceMinutes? }].
-- NULL preserves the existing uniform startMinute/endMinute behavior.
ALTER TABLE "Shift" ADD COLUMN "daySchedule" JSONB;
