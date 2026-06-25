-- Temp-password / first-login flow + employee department/title.

ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Employee" ADD COLUMN "department" TEXT;
ALTER TABLE "Employee" ADD COLUMN "title" TEXT;
