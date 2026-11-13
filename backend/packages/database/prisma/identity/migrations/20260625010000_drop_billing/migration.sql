-- Billing moved to billing-service / billing-db. Drop the tables from identity-db.

DROP TABLE IF EXISTS "Invoice";
DROP TABLE IF EXISTS "Subscription";
DROP TABLE IF EXISTS "Plan";
DROP TYPE IF EXISTS "InvoiceStatus";
DROP TYPE IF EXISTS "SubscriptionStatus";
