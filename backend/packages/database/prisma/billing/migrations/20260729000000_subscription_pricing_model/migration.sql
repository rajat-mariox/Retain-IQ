-- Phase 1: seat-based pricing model + subscription rate-lock.
-- Additive and behaviour-preserving: new columns default so the total equals the
-- old flat `seats * pricePerSeat` until a super-admin sets a real base/included model.

-- Plan: base + included + additional-seat pricing, and seat-capacity policy.
ALTER TABLE "Plan"
  ADD COLUMN "basePrice"           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "includedSeats"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "additionalSeatPrice" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "minSeats"            INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "maxSeats"            INTEGER,
  ADD COLUMN "allowCustomSeats"    BOOLEAN NOT NULL DEFAULT true;

-- Backfill existing plans to preserve today's bill exactly:
--   total = 0 base + (seats - 0 included) * pricePerSeat  ==  seats * pricePerSeat.
UPDATE "Plan"
   SET "additionalSeatPrice" = "pricePerSeat",
       "maxSeats"            = "seatLimit";

-- Subscription: rate-lock snapshot (null on existing rows → fall back to live plan).
ALTER TABLE "Subscription"
  ADD COLUMN "lockedBasePrice"           INTEGER,
  ADD COLUMN "lockedAdditionalSeatPrice" INTEGER,
  ADD COLUMN "lockedIncludedSeats"       INTEGER,
  ADD COLUMN "lockedTotalPrice"          INTEGER;

-- Backfill the lock on existing subscriptions from their current plan's (now
-- backfilled) pricing, at the licensed seat quantity, so historical rate is pinned
-- from here on without changing any current amount.
UPDATE "Subscription" s
   SET "lockedBasePrice"           = p."basePrice",
       "lockedAdditionalSeatPrice" = p."additionalSeatPrice",
       "lockedIncludedSeats"       = p."includedSeats",
       "lockedTotalPrice"          = p."basePrice"
                                     + GREATEST(0, s."seats" - p."includedSeats") * p."additionalSeatPrice"
  FROM "Plan" p
 WHERE s."planId" = p."id";
