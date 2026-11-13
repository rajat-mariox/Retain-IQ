-- Department: first-class org unit. Teams gain a department; employees link to a
-- Department record (the legacy free-text Employee.department column is kept for
-- backfill, then deprecated).
CREATE TABLE "Department" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "leadEmployeeId" UUID,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Department_orgId_slug_key" ON "Department"("orgId", "slug");
CREATE INDEX "Department_orgId_status_idx" ON "Department"("orgId", "status");

ALTER TABLE "Team" ADD COLUMN "departmentId" UUID;
CREATE INDEX "Team_orgId_departmentId_idx" ON "Team"("orgId", "departmentId");

-- FKs (Employee.departmentId column already existed; wire it now).
ALTER TABLE "Department" ADD CONSTRAINT "Department_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Team" ADD CONSTRAINT "Team_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
