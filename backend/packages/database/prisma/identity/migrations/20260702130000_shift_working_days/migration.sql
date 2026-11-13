-- Per-shift working days (0=Sun … 6=Sat). Existing shifts default to Mon–Fri.
ALTER TABLE "Shift" ADD COLUMN "workingDays" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5];
