-- Project the member's email/name alongside the membership so the EMAIL channel
-- can address recipients without cross-service reads into the identity database.
ALTER TABLE "OrgRecipient"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "name" TEXT;
