-- Structured probation + confirmation: records, extensions, and org config.
CREATE TYPE "ProbationStatus" AS ENUM ('ACTIVE', 'EXTENDED', 'CONFIRMED', 'TERMINATED');
CREATE TYPE "ProbationRecommendation" AS ENUM ('CONFIRM', 'EXTEND', 'TERMINATE');

ALTER TABLE "WorkforceSetting" ADD COLUMN "probationMonths" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE "WorkforceSetting" ADD COLUMN "probationReminderDays" INTEGER[] NOT NULL DEFAULT ARRAY[30, 15, 7];

CREATE TABLE "ProbationRecord" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"            UUID NOT NULL,
  "employeeId"       UUID NOT NULL,
  "startDate"        DATE NOT NULL,
  "endDate"          DATE NOT NULL,
  "originalEndDate"  DATE NOT NULL,
  "durationMonths"   INTEGER NOT NULL,
  "status"           "ProbationStatus" NOT NULL DEFAULT 'ACTIVE',
  "performanceNote"  TEXT,
  "attendanceNote"   TEXT,
  "reviewNote"       TEXT,
  "recommendation"   "ProbationRecommendation",
  "reviewedBy"       UUID,
  "reviewedAt"       TIMESTAMP(3),
  "lastRemindedDays" INTEGER,
  "createdBy"        UUID,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProbationRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProbationRecord_orgId_employeeId_idx" ON "ProbationRecord" ("orgId", "employeeId");
CREATE INDEX "ProbationRecord_orgId_status_idx" ON "ProbationRecord" ("orgId", "status");
CREATE INDEX "ProbationRecord_status_endDate_idx" ON "ProbationRecord" ("status", "endDate");
ALTER TABLE "ProbationRecord" ADD CONSTRAINT "ProbationRecord_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProbationRecord" ADD CONSTRAINT "ProbationRecord_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProbationExtension" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"       UUID NOT NULL,
  "probationId" UUID NOT NULL,
  "fromEndDate" DATE NOT NULL,
  "toEndDate"   DATE NOT NULL,
  "reason"      TEXT,
  "extendedBy"  UUID,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProbationExtension_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProbationExtension_orgId_probationId_idx" ON "ProbationExtension" ("orgId", "probationId");
ALTER TABLE "ProbationExtension" ADD CONSTRAINT "ProbationExtension_probationId_fkey"
  FOREIGN KEY ("probationId") REFERENCES "ProbationRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
