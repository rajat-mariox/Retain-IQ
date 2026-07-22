-- AlterTable: rich employee profile fields
ALTER TABLE "Employee"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "dateOfBirth" DATE,
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "employmentType" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "emergencyContactName" TEXT,
  ADD COLUMN "emergencyContactPhone" TEXT;

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "fileName" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "uploadedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmploymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDocument_key_key" ON "EmployeeDocument"("key");
CREATE INDEX "EmployeeDocument_orgId_employeeId_idx" ON "EmployeeDocument"("orgId", "employeeId");
CREATE INDEX "EmploymentEvent_orgId_employeeId_effectiveDate_idx" ON "EmploymentEvent"("orgId", "employeeId", "effectiveDate");

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmploymentEvent" ADD CONSTRAINT "EmploymentEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
