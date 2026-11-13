-- Platform-approval flow for org seat/plan changes. Additive; no existing data touched.
-- An org's seat/plan change is recorded here as PENDING and only applied on approval.
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "SubscriptionChangeRequest" (
  "id"                  UUID NOT NULL,
  "orgId"               UUID NOT NULL,
  "fromPlanId"          TEXT NOT NULL,
  "toPlanId"            TEXT NOT NULL,
  "fromSeats"           INTEGER NOT NULL,
  "toSeats"             INTEGER NOT NULL,
  "estimatedTotalPrice" INTEGER NOT NULL,
  "estimatedDeltaPrice" INTEGER NOT NULL,
  "status"              "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedByUserId"   UUID,
  "requestedByEmail"    TEXT,
  "note"                TEXT,
  "decidedByName"       TEXT,
  "decisionNote"        TEXT,
  "decidedAt"           TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriptionChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubscriptionChangeRequest_status_createdAt_idx" ON "SubscriptionChangeRequest"("status", "createdAt");
CREATE INDEX "SubscriptionChangeRequest_orgId_idx" ON "SubscriptionChangeRequest"("orgId");
