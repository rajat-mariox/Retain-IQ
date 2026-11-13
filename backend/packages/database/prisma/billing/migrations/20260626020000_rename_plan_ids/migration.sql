-- Rename plan ids: starter -> basic, growth -> professional (display names are
-- already Basic / Professional). Subscription.planId has ON UPDATE CASCADE, so
-- existing subscriptions follow automatically. No-op on a fresh DB (plans are
-- seeded with the new ids by billing-service afterward); idempotent on re-run.
UPDATE "Plan" SET id = 'basic' WHERE id = 'starter';
UPDATE "Plan" SET id = 'professional' WHERE id = 'growth';
