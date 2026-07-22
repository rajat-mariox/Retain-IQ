-- CreateTable: per-org feature overrides. Only divergent rows exist; absence
-- means "inherit the global flag", so new features need no backfill.
CREATE TABLE "OrgFeatureFlag" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "reason" TEXT,
    "updatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrgFeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one decision per (org, feature) — the upsert target.
CREATE UNIQUE INDEX "OrgFeatureFlag_orgId_feature_key" ON "OrgFeatureFlag"("orgId", "feature");
CREATE INDEX "OrgFeatureFlag_orgId_idx" ON "OrgFeatureFlag"("orgId");
CREATE INDEX "OrgFeatureFlag_feature_idx" ON "OrgFeatureFlag"("feature");

-- AddForeignKey: deleting an org drops its overrides with it.
ALTER TABLE "OrgFeatureFlag" ADD CONSTRAINT "OrgFeatureFlag_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
