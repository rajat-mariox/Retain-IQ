-- Phase 2: per-plan feature limits. Additive; no existing data touched. Boolean
-- feature access still comes from Plan.features[]; this table only adds quotas.
CREATE TABLE "PlanFeature" (
  "id"          TEXT NOT NULL,
  "planId"      TEXT NOT NULL,
  "featureCode" TEXT NOT NULL,
  "limitValue"  INTEGER,
  "limitType"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanFeature_planId_featureCode_key" ON "PlanFeature"("planId", "featureCode");
CREATE INDEX "PlanFeature_planId_idx" ON "PlanFeature"("planId");

ALTER TABLE "PlanFeature"
  ADD CONSTRAINT "PlanFeature_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
