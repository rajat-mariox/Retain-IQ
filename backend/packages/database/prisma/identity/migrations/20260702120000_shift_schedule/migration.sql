-- Work shifts / schedules — drives shift-relative late & early-exit detection.

CREATE TABLE "Shift" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Shift_orgId_status_idx" ON "Shift"("orgId", "status");
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Employee" ADD COLUMN "shiftId" UUID;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Employee_orgId_shiftId_idx" ON "Employee"("orgId", "shiftId");

-- Seed a default "General" shift (09:00–17:30, 15-min grace) per org so existing
-- employees resolve to a real shift instead of the legacy hard-coded constants.
INSERT INTO "Shift" ("id", "orgId", "name", "startMinute", "endMinute", "graceMinutes", "isDefault", "status", "updatedAt")
SELECT gen_random_uuid(), o."id", 'General (9:00–5:30)', 540, 1050, 15, true, 'ACTIVE', CURRENT_TIMESTAMP
FROM "Organization" o;
