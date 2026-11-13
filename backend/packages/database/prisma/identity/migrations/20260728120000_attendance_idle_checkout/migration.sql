-- Org-configurable desktop-agent idle auto-checkout. idleCheckoutMinutes = total
-- idle before auto check-out (0 = off); idleCheckoutWarnMinutes = countdown shown
-- before it.
ALTER TABLE "AttendancePolicy"
  ADD COLUMN "idleCheckoutMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "idleCheckoutWarnMinutes" INTEGER NOT NULL DEFAULT 5;
