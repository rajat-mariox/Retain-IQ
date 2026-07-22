-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Client" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "contactEmail" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_orgId_name_key" ON "Client"("orgId", "name");
CREATE INDEX "Client_orgId_status_idx" ON "Client"("orgId", "status");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: link projects to a client
ALTER TABLE "Project" ADD COLUMN "clientId" UUID;

-- CreateIndex
CREATE INDEX "Project_orgId_clientId_idx" ON "Project"("orgId", "clientId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: billable flag on time entries. Existing rows backfill to billable
-- (the default), matching the common client-facing-work case.
ALTER TABLE "TimeEntry" ADD COLUMN "billable" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "TimeEntry_orgId_billable_date_idx" ON "TimeEntry"("orgId", "billable", "date");
