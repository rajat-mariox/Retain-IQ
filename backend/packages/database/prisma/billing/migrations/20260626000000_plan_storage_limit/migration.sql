-- Per-plan screenshot storage quota (MB). NULL = unlimited (Enterprise).
ALTER TABLE "Plan" ADD COLUMN "storageLimitMb" INTEGER;
