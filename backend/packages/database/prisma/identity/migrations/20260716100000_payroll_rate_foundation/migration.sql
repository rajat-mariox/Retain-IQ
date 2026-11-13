-- CreateEnum
CREATE TYPE "PayrollCycleFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateTable: employee cost rate (payroll) + default charge-out rate.
CREATE TABLE "EmployeeRate" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "costRateCents" INTEGER NOT NULL,
    "billRateCents" INTEGER,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "note" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeRate_orgId_employeeId_effectiveFrom_idx" ON "EmployeeRate"("orgId", "employeeId", "effectiveFrom");
CREATE INDEX "EmployeeRate_orgId_effectiveTo_idx" ON "EmployeeRate"("orgId", "effectiveTo");

-- At most one open (current) rate per employee. Closed history rows are
-- unconstrained, so superseding is append-only.
CREATE UNIQUE INDEX "EmployeeRate_one_open_per_employee"
    ON "EmployeeRate"("orgId", "employeeId")
    WHERE "effectiveTo" IS NULL;

-- AddForeignKey
ALTER TABLE "EmployeeRate" ADD CONSTRAINT "EmployeeRate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeRate" ADD CONSTRAINT "EmployeeRate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: charge-out rate overrides (project/client/employee scoped).
CREATE TABLE "BillRate" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "clientId" UUID,
    "projectId" UUID,
    "employeeId" UUID,
    "billRateCents" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillRate_pkey" PRIMARY KEY ("id")
);

-- A bill rate must anchor to exactly one of client or project; an employee-only
-- default belongs on EmployeeRate.billRateCents, not here.
ALTER TABLE "BillRate" ADD CONSTRAINT "BillRate_scope_check"
    CHECK (num_nonnulls("clientId", "projectId") = 1);

-- CreateIndex
CREATE INDEX "BillRate_orgId_projectId_effectiveFrom_idx" ON "BillRate"("orgId", "projectId", "effectiveFrom");
CREATE INDEX "BillRate_orgId_clientId_effectiveFrom_idx" ON "BillRate"("orgId", "clientId", "effectiveFrom");
CREATE INDEX "BillRate_orgId_effectiveTo_idx" ON "BillRate"("orgId", "effectiveTo");

-- AddForeignKey
ALTER TABLE "BillRate" ADD CONSTRAINT "BillRate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillRate" ADD CONSTRAINT "BillRate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillRate" ADD CONSTRAINT "BillRate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillRate" ADD CONSTRAINT "BillRate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: per-org payroll rules (singleton).
CREATE TABLE "PayrollSetting" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "overtimeAfterMins" INTEGER NOT NULL DEFAULT 2400,
    "overtimeMultiplier" INTEGER NOT NULL DEFAULT 150,
    "cycleFrequency" "PayrollCycleFrequency" NOT NULL DEFAULT 'MONTHLY',
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "requireApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSetting_orgId_key" ON "PayrollSetting"("orgId");

-- AddForeignKey
ALTER TABLE "PayrollSetting" ADD CONSTRAINT "PayrollSetting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
