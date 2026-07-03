-- Dynamic per-shift breaks (lunch/dinner/tea) — deducted from worked hours.
ALTER TABLE "Shift" ADD COLUMN "breaks" JSONB NOT NULL DEFAULT '[]';
