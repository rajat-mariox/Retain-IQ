-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'org',
    "scopeId" UUID,
    "period" TEXT NOT NULL DEFAULT 'month',
    "frequency" "ReportFrequency" NOT NULL DEFAULT 'WEEKLY',
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportSchedule_orgId_idx" ON "ReportSchedule"("orgId");

-- CreateIndex
CREATE INDEX "ReportSchedule_active_frequency_idx" ON "ReportSchedule"("active", "frequency");

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
