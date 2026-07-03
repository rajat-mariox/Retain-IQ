-- Per-org monitoring policy (screenshot interval/enable/quality) — admin-configurable, agent-read.
CREATE TABLE "MonitoringPolicy" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "screenshotsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "screenshotIntervalSeconds" INTEGER NOT NULL DEFAULT 600,
    "screenshotQuality" INTEGER NOT NULL DEFAULT 55,
    "screenshotMaxWidth" INTEGER NOT NULL DEFAULT 1280,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MonitoringPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MonitoringPolicy_orgId_key" ON "MonitoringPolicy"("orgId");
ALTER TABLE "MonitoringPolicy" ADD CONSTRAINT "MonitoringPolicy_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
