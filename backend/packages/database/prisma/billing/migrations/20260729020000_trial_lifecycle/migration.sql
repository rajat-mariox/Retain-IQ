-- Phase 3: trial lifecycle. Additive. Adds the EXPIRED status, per-plan trial
-- policy, and trial timestamps on the subscription. Existing trials get their
-- trialStartedAt backfilled from createdAt so days-elapsed is computable.

-- New enum value (Postgres requires ALTER TYPE ... ADD VALUE, cannot run in a tx
-- block with other statements on some versions, so it's first and alone-ish).
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- Per-plan trial policy.
ALTER TABLE "Plan"
  ADD COLUMN "trialEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "trialDays"    INTEGER NOT NULL DEFAULT 14;

-- Trial lifecycle timestamps on the subscription.
ALTER TABLE "Subscription"
  ADD COLUMN "trialStartedAt"   TIMESTAMP(3),
  ADD COLUMN "trialConvertedAt" TIMESTAMP(3),
  ADD COLUMN "trialExpiredAt"   TIMESTAMP(3);

-- Backfill: existing trialing subs get a start date so "day N of trial" works.
UPDATE "Subscription"
   SET "trialStartedAt" = "createdAt"
 WHERE status = 'TRIALING' AND "trialStartedAt" IS NULL;
