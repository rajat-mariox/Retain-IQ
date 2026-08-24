-- CreateEnum
CREATE TYPE "PayFrequency" AS ENUM ('MONTHLY', 'WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'DAILY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('OPEN', 'INPUT_CUTOFF', 'PROCESSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "PaymentBasis" AS ENUM ('FIXED', 'HOURLY', 'DAILY');

-- CreateEnum
CREATE TYPE "ComponentDirection" AS ENUM ('EARNING', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "ComponentCalcType" AS ENUM ('FIXED', 'PERCENTAGE', 'FORMULA', 'INPUT_BASED', 'PER_UNIT');

-- CreateEnum
CREATE TYPE "PayrollBatchStatus" AS ENUM ('DRAFT', 'INPUT_COLLECTION', 'CALCULATION', 'VALIDATION', 'REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'PAYMENT_PROCESSING', 'PAID', 'CLOSED', 'REJECTED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollRecordStatus" AS ENUM ('DRAFT', 'CALCULATED', 'VALIDATION_FAILED', 'VALIDATED', 'PENDING_APPROVAL', 'APPROVED', 'PAYMENT_PROCESSING', 'PAID', 'CLOSED', 'ON_HOLD', 'REJECTED', 'PAYMENT_FAILED', 'CANCELLED', 'CORRECTION_REQUIRED');

-- CreateEnum
CREATE TYPE "VariablePayStatus" AS ENUM ('DRAFT', 'MANAGER_APPROVAL', 'REVIEW', 'APPROVED', 'INCLUDED_IN_PAYROLL', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PayrollCalendar" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "legalEntityId" UUID,
    "name" TEXT NOT NULL,
    "frequency" "PayFrequency" NOT NULL DEFAULT 'MONTHLY',
    "countryCode" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "cutoffDay" INTEGER,
    "payDay" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "PayrollCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "calendarId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "payDate" DATE,
    "cutoffAt" TIMESTAMP(3),
    "taxYear" INTEGER,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollProfile" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollProfileVersion" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "legalEntityId" UUID,
    "payrollEntityId" UUID,
    "workCountry" TEXT,
    "payrollCountry" TEXT,
    "taxResidencyCountry" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "payFrequency" "PayFrequency" NOT NULL DEFAULT 'MONTHLY',
    "paymentBasis" "PaymentBasis" NOT NULL DEFAULT 'FIXED',
    "baseAmount" DECIMAL(18,4) NOT NULL,
    "calendarId" UUID,
    "taxRegime" TEXT,
    "prorationPolicy" TEXT NOT NULL DEFAULT 'CALENDAR_DAYS',
    "overtimePolicyMode" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "compOffPolicy" JSONB,
    "bankRef" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "joinDate" DATE,
    "exitDate" DATE,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollComponent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollComponentVersion" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "componentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "direction" "ComponentDirection" NOT NULL,
    "calcType" "ComponentCalcType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "countryCode" TEXT,
    "legalEntityId" UUID,
    "currencyCode" TEXT,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "statutory" BOOLEAN NOT NULL DEFAULT false,
    "employerPaid" BOOLEAN NOT NULL DEFAULT false,
    "proratable" BOOLEAN NOT NULL DEFAULT true,
    "minAmount" DECIMAL(18,4),
    "maxAmount" DECIMAL(18,4),
    "rounding" TEXT NOT NULL DEFAULT 'HALF_UP',
    "payslipVisible" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollComponentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollBatch" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "legalEntityId" UUID,
    "payrollEntityId" UUID,
    "periodId" UUID NOT NULL,
    "countryCode" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "name" TEXT NOT NULL,
    "status" "PayrollBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "grossTotal" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "deductionTotal" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "netTotal" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "employerCost" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdBy" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollBatchEmployee" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "excludeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollBatchEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollInputSnapshot" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "scheduledDays" DECIMAL(8,2),
    "workingDays" DECIMAL(8,2),
    "presentDays" DECIMAL(8,2),
    "paidLeaveDays" DECIMAL(8,2),
    "unpaidLeaveDays" DECIMAL(8,2),
    "holidays" DECIMAL(8,2),
    "weeklyOffs" DECIMAL(8,2),
    "payableDays" DECIMAL(8,2),
    "regularHours" DECIMAL(10,2),
    "overtimeHours" DECIMAL(10,2),
    "nightHours" DECIMAL(10,2),
    "sources" JSONB NOT NULL DEFAULT '{}',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "overrideBy" UUID,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollInputSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRecord" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "profileVersionId" UUID,
    "regularEarnings" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "variableEarnings" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "overtimeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reimbursements" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grossEarnings" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "preTaxDeductions" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxableIncome" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxDeduction" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "employeeStatutory" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "postTaxDeductions" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "adjustments" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netPayable" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "employerContrib" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "employerCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "prorationFactor" DECIMAL(8,4) NOT NULL DEFAULT 1,
    "status" "PayrollRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "calcVersion" INTEGER NOT NULL DEFAULT 1,
    "calculatedAt" TIMESTAMP(3),
    "statementStatus" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRecordComponent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "ComponentDirection" NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "statutory" BOOLEAN NOT NULL DEFAULT false,
    "employerPaid" BOOLEAN NOT NULL DEFAULT false,
    "payslipVisible" BOOLEAN NOT NULL DEFAULT true,
    "calcType" TEXT,
    "formula" TEXT,
    "inputs" JSONB,
    "componentVersionId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRecordComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollBonus" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "bonusType" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "status" "VariablePayStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" TEXT,
    "sourceRef" TEXT,
    "reason" TEXT,
    "periodId" UUID,
    "batchId" UUID,
    "requestedBy" UUID,
    "approvedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollBonus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollIncentive" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "incentiveType" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "status" "VariablePayStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" TEXT,
    "sourceRef" TEXT,
    "periodId" UUID,
    "batchId" UUID,
    "requestedBy" UUID,
    "approvedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollIncentive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollReimbursement" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "claimedAmount" DECIMAL(18,4) NOT NULL,
    "approvedAmount" DECIMAL(18,4),
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "status" "VariablePayStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" TEXT,
    "sourceRef" TEXT,
    "receiptKey" TEXT,
    "periodId" UUID,
    "batchId" UUID,
    "requestedBy" UUID,
    "managerApprovedBy" UUID,
    "financeApprovedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollReimbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollOvertime" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "dayType" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "multiplier" DECIMAL(6,3),
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "approvedBy" UUID,
    "batchId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollOvertime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollCompOff" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "deltaMinutes" INTEGER NOT NULL,
    "entryType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" UUID,
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollCompOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollApproval" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedBy" UUID,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollHold" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "batchId" UUID,
    "recordId" UUID,
    "employeeId" UUID,
    "reason" TEXT NOT NULL,
    "expectedResolution" TEXT,
    "heldBy" UUID,
    "releasedBy" UUID,
    "releasedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayment" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "method" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentDate" TIMESTAMP(3),
    "processedBy" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPaymentAttempt" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "providerRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPaymentProof" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT,
    "uploadedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPaymentProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollStatement" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PAYOUT_STATEMENT',
    "documentVersion" INTEGER NOT NULL DEFAULT 1,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "grossAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollDispute" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "recordId" UUID,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "assignedTo" UUID,
    "hrCaseRef" UUID,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollAdjustment" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "originalRecordId" UUID,
    "componentCode" TEXT,
    "adjustmentType" TEXT NOT NULL,
    "previousValue" DECIMAL(18,4),
    "correctedValue" DECIMAL(18,4),
    "difference" DECIMAL(18,4) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "reason" TEXT NOT NULL,
    "evidenceKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CORRECTION_REQUESTED',
    "settlementBatchId" UUID,
    "createdBy" UUID,
    "approvedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollCalendar_orgId_active_idx" ON "PayrollCalendar"("orgId", "active");

-- CreateIndex
CREATE INDEX "PayrollPeriod_orgId_status_idx" ON "PayrollPeriod"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_calendarId_periodStart_periodEnd_key" ON "PayrollPeriod"("calendarId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "PayrollProfile_orgId_status_idx" ON "PayrollProfile"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollProfile_orgId_employeeId_key" ON "PayrollProfile"("orgId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollProfileVersion_orgId_profileId_idx" ON "PayrollProfileVersion"("orgId", "profileId");

-- CreateIndex
CREATE INDEX "PayrollProfileVersion_orgId_effectiveFrom_idx" ON "PayrollProfileVersion"("orgId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollProfileVersion_profileId_version_key" ON "PayrollProfileVersion"("profileId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollComponent_orgId_code_key" ON "PayrollComponent"("orgId", "code");

-- CreateIndex
CREATE INDEX "PayrollComponentVersion_orgId_direction_effectiveFrom_idx" ON "PayrollComponentVersion"("orgId", "direction", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollComponentVersion_componentId_version_key" ON "PayrollComponentVersion"("componentId", "version");

-- CreateIndex
CREATE INDEX "PayrollBatch_orgId_status_idx" ON "PayrollBatch"("orgId", "status");

-- CreateIndex
CREATE INDEX "PayrollBatch_orgId_periodId_idx" ON "PayrollBatch"("orgId", "periodId");

-- CreateIndex
CREATE INDEX "PayrollBatchEmployee_orgId_employeeId_idx" ON "PayrollBatchEmployee"("orgId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollBatchEmployee_batchId_employeeId_key" ON "PayrollBatchEmployee"("batchId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollInputSnapshot_orgId_employeeId_idx" ON "PayrollInputSnapshot"("orgId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollInputSnapshot_batchId_employeeId_key" ON "PayrollInputSnapshot"("batchId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollRecord_orgId_employeeId_idx" ON "PayrollRecord"("orgId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollRecord_orgId_status_idx" ON "PayrollRecord"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRecord_batchId_employeeId_key" ON "PayrollRecord"("batchId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollRecordComponent_orgId_recordId_idx" ON "PayrollRecordComponent"("orgId", "recordId");

-- CreateIndex
CREATE INDEX "PayrollBonus_orgId_employeeId_status_idx" ON "PayrollBonus"("orgId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "PayrollIncentive_orgId_employeeId_status_idx" ON "PayrollIncentive"("orgId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "PayrollReimbursement_orgId_employeeId_status_idx" ON "PayrollReimbursement"("orgId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "PayrollOvertime_orgId_employeeId_workDate_idx" ON "PayrollOvertime"("orgId", "employeeId", "workDate");

-- CreateIndex
CREATE INDEX "PayrollCompOff_orgId_employeeId_idx" ON "PayrollCompOff"("orgId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollApproval_orgId_batchId_idx" ON "PayrollApproval"("orgId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollApproval_batchId_stepIndex_key" ON "PayrollApproval"("batchId", "stepIndex");

-- CreateIndex
CREATE INDEX "PayrollHold_orgId_active_idx" ON "PayrollHold"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayment_idempotencyKey_key" ON "PayrollPayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PayrollPayment_orgId_status_idx" ON "PayrollPayment"("orgId", "status");

-- CreateIndex
CREATE INDEX "PayrollPayment_orgId_recordId_idx" ON "PayrollPayment"("orgId", "recordId");

-- CreateIndex
CREATE INDEX "PayrollPaymentAttempt_orgId_paymentId_idx" ON "PayrollPaymentAttempt"("orgId", "paymentId");

-- CreateIndex
CREATE INDEX "PayrollPaymentProof_orgId_paymentId_idx" ON "PayrollPaymentProof"("orgId", "paymentId");

-- CreateIndex
CREATE INDEX "PayrollStatement_orgId_employeeId_idx" ON "PayrollStatement"("orgId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollStatement_recordId_documentVersion_key" ON "PayrollStatement"("recordId", "documentVersion");

-- CreateIndex
CREATE INDEX "PayrollDispute_orgId_status_idx" ON "PayrollDispute"("orgId", "status");

-- CreateIndex
CREATE INDEX "PayrollDispute_orgId_employeeId_idx" ON "PayrollDispute"("orgId", "employeeId");

-- CreateIndex
CREATE INDEX "PayrollAdjustment_orgId_employeeId_status_idx" ON "PayrollAdjustment"("orgId", "employeeId", "status");

-- AddForeignKey
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "PayrollCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollProfileVersion" ADD CONSTRAINT "PayrollProfileVersion_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "PayrollProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollComponentVersion" ADD CONSTRAINT "PayrollComponentVersion_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "PayrollComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollBatch" ADD CONSTRAINT "PayrollBatch_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollBatchEmployee" ADD CONSTRAINT "PayrollBatchEmployee_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PayrollBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PayrollBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRecordComponent" ADD CONSTRAINT "PayrollRecordComponent_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "PayrollRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPaymentAttempt" ADD CONSTRAINT "PayrollPaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PayrollPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPaymentProof" ADD CONSTRAINT "PayrollPaymentProof_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PayrollPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

