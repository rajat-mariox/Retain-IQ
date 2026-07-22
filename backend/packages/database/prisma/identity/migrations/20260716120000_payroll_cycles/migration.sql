-- CreateEnum
CREATE TYPE "PayrollCycleStatus" AS ENUM ('DRAFT', 'LOCKED', 'PAID');

-- CreateTable
CREATE TABLE "PayrollCycle" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "PayrollCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "runAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedBy" UUID,
    "paidAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollCycle_pkey" PRIMARY KEY ("id")
);

-- A period must not end before it starts.
ALTER TABLE "PayrollCycle" ADD CONSTRAINT "PayrollCycle_period_check" CHECK ("periodEnd" >= "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollCycle_orgId_periodStart_periodEnd_key" ON "PayrollCycle"("orgId", "periodStart", "periodEnd");
CREATE INDEX "PayrollCycle_orgId_status_idx" ON "PayrollCycle"("orgId", "status");

-- AddForeignKey
ALTER TABLE "PayrollCycle" ADD CONSTRAINT "PayrollCycle_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "regularMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "billableMinutes" INTEGER NOT NULL DEFAULT 0,
    "costRateCents" INTEGER NOT NULL,
    "regularPayCents" INTEGER NOT NULL DEFAULT 0,
    "overtimePayCents" INTEGER NOT NULL DEFAULT 0,
    "grossPayCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollLine_cycleId_employeeId_key" ON "PayrollLine"("cycleId", "employeeId");
CREATE INDEX "PayrollLine_orgId_cycleId_idx" ON "PayrollLine"("orgId", "cycleId");

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PayrollCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
