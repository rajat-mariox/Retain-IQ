-- Payslip publish lifecycle + tax/statutory engine (schema added in c410fdd without a migration).

-- AlterTable
ALTER TABLE "PayrollSetting" ADD COLUMN     "taxEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PayrollStatement" ADD COLUMN     "contentType" TEXT NOT NULL DEFAULT 'application/pdf',
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "TaxRuleSet" (
    "id" UUID NOT NULL,
    "orgId" UUID,
    "countryCode" TEXT NOT NULL,
    "regime" TEXT NOT NULL DEFAULT 'DEFAULT',
    "taxYear" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "standardDeduction" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 4,
    "rebateLimit" DECIMAL(18,4),
    "rebateMaxAmount" DECIMAL(18,4),
    "surchargePercent" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "cessPercent" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxSlab" (
    "id" UUID NOT NULL,
    "ruleSetId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "lowerBound" DECIMAL(18,4) NOT NULL,
    "upperBound" DECIMAL(18,4),
    "ratePercent" DECIMAL(6,4) NOT NULL,

    CONSTRAINT "TaxSlab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatutoryRule" (
    "id" UUID NOT NULL,
    "orgId" UUID,
    "countryCode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "employerRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "wageCeiling" DECIMAL(18,4),
    "applicableUpto" DECIMAL(18,4),
    "flatAmount" DECIMAL(18,4),
    "baseComponents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "config" JSONB,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatutoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeTaxProfile" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "taxYear" TEXT NOT NULL,
    "regime" TEXT NOT NULL DEFAULT 'DEFAULT',
    "exemptions" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeTaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollFiling" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'IN',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "totalWages" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalEmployee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalEmployer" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalTax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "notes" TEXT,
    "generatedBy" UUID,
    "reviewedBy" UUID,
    "approvedBy" UUID,
    "submittedBy" UUID,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollFilingLine" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "filingId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "wageBase" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "employeeAmt" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "employerAmt" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmt" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "meta" JSONB,

    CONSTRAINT "PayrollFilingLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxRuleSet_countryCode_regime_effectiveFrom_idx" ON "TaxRuleSet"("countryCode", "regime", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TaxRuleSet_orgId_idx" ON "TaxRuleSet"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxSlab_ruleSetId_seq_key" ON "TaxSlab"("ruleSetId", "seq");

-- CreateIndex
CREATE INDEX "StatutoryRule_countryCode_kind_effectiveFrom_idx" ON "StatutoryRule"("countryCode", "kind", "effectiveFrom");

-- CreateIndex
CREATE INDEX "StatutoryRule_orgId_idx" ON "StatutoryRule"("orgId");

-- CreateIndex
CREATE INDEX "EmployeeTaxProfile_orgId_employeeId_idx" ON "EmployeeTaxProfile"("orgId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeTaxProfile_orgId_employeeId_taxYear_key" ON "EmployeeTaxProfile"("orgId", "employeeId", "taxYear");

-- CreateIndex
CREATE INDEX "PayrollFiling_orgId_kind_periodStart_idx" ON "PayrollFiling"("orgId", "kind", "periodStart");

-- CreateIndex
CREATE INDEX "PayrollFiling_orgId_status_idx" ON "PayrollFiling"("orgId", "status");

-- CreateIndex
CREATE INDEX "PayrollFilingLine_orgId_filingId_idx" ON "PayrollFilingLine"("orgId", "filingId");

ALTER TABLE "TaxSlab" ADD CONSTRAINT "TaxSlab_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "TaxRuleSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollFilingLine" ADD CONSTRAINT "PayrollFilingLine_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "PayrollFiling"("id") ON DELETE CASCADE ON UPDATE CASCADE;

