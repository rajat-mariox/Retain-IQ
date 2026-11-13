-- AlterTable: per-employee work model + hybrid office-day pattern.
ALTER TABLE "Employee" ADD COLUMN "workModel" TEXT;
ALTER TABLE "Employee" ADD COLUMN "officeDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
