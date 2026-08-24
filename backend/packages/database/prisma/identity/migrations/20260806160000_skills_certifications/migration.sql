-- Skills & Certifications: catalog, employee-skill edges, and structured certs.
CREATE TYPE "SkillProficiency" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');
CREATE TYPE "SkillVerificationStatus" AS ENUM ('SELF_DECLARED', 'VERIFIED', 'REJECTED');

CREATE TABLE "SkillCatalog" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"       UUID NOT NULL,
  "name"        TEXT NOT NULL,
  "category"    TEXT,
  "description" TEXT,
  "status"      TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdBy"   UUID,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillCatalog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SkillCatalog_orgId_name_key" ON "SkillCatalog" ("orgId", "name");
CREATE INDEX "SkillCatalog_orgId_status_idx" ON "SkillCatalog" ("orgId", "status");
ALTER TABLE "SkillCatalog" ADD CONSTRAINT "SkillCatalog_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "EmployeeSkill" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"          UUID NOT NULL,
  "employeeId"     UUID NOT NULL,
  "skillId"        UUID NOT NULL,
  "proficiency"    "SkillProficiency" NOT NULL DEFAULT 'INTERMEDIATE',
  "yearsOfExp"     DOUBLE PRECISION,
  "verification"   "SkillVerificationStatus" NOT NULL DEFAULT 'SELF_DECLARED',
  "verifiedBy"     UUID,
  "verifiedAt"     TIMESTAMP(3),
  "endorsements"   INTEGER NOT NULL DEFAULT 0,
  "lastAssessedAt" TIMESTAMP(3),
  "note"           TEXT,
  "createdBy"      UUID,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeSkill_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployeeSkill_employeeId_skillId_key" ON "EmployeeSkill" ("employeeId", "skillId");
CREATE INDEX "EmployeeSkill_orgId_employeeId_idx" ON "EmployeeSkill" ("orgId", "employeeId");
CREATE INDEX "EmployeeSkill_orgId_skillId_idx" ON "EmployeeSkill" ("orgId", "skillId");
ALTER TABLE "EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "SkillCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmployeeCertification" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"            UUID NOT NULL,
  "employeeId"       UUID NOT NULL,
  "name"             TEXT NOT NULL,
  "issuer"           TEXT,
  "credentialId"     TEXT,
  "issueDate"        DATE,
  "expiresAt"        DATE,
  "verification"     "SkillVerificationStatus" NOT NULL DEFAULT 'SELF_DECLARED',
  "verifiedBy"       UUID,
  "verifiedAt"       TIMESTAMP(3),
  "documentKey"      TEXT,
  "documentName"     TEXT,
  "lastRemindedDays" INTEGER,
  "createdBy"        UUID,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeCertification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeCertification_orgId_employeeId_idx" ON "EmployeeCertification" ("orgId", "employeeId");
CREATE INDEX "EmployeeCertification_orgId_expiresAt_idx" ON "EmployeeCertification" ("orgId", "expiresAt");
ALTER TABLE "EmployeeCertification" ADD CONSTRAINT "EmployeeCertification_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
