-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "passwordResetTokenHash" TEXT,
  ADD COLUMN "passwordResetTokenExpiresAt" TIMESTAMP(3);

ALTER TABLE "PlatformAdmin"
  ADD COLUMN "passwordResetTokenHash" TEXT,
  ADD COLUMN "passwordResetTokenExpiresAt" TIMESTAMP(3);
