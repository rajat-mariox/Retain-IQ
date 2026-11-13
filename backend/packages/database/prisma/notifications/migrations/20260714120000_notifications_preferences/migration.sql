-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('ATTENDANCE', 'PRODUCTIVITY', 'PROJECT', 'AI', 'SYSTEM');
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- AlterTable: categorise / prioritise / link / archive existing notifications
ALTER TABLE "Notification"
  ADD COLUMN "category" "NotificationCategory" NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "link" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Backfill categories for the notification types that already exist.
UPDATE "Notification" SET "category" = 'ATTENDANCE' WHERE "type" LIKE 'leave.%';
UPDATE "Notification" SET "category" = 'PROJECT'    WHERE "type" LIKE 'timesheet.%';

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "push" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationSetting" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietStart" INTEGER NOT NULL DEFAULT 22,
    "quietEnd" INTEGER NOT NULL DEFAULT 8,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "digest" TEXT NOT NULL DEFAULT 'OFF',
    "digestHour" INTEGER NOT NULL DEFAULT 9,
    "lastDigestAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_orgId_recipientUserId_category_createdAt_idx" ON "Notification"("orgId", "recipientUserId", "category", "createdAt");
CREATE UNIQUE INDEX "NotificationPreference_orgId_userId_category_key" ON "NotificationPreference"("orgId", "userId", "category");
CREATE INDEX "NotificationPreference_orgId_userId_idx" ON "NotificationPreference"("orgId", "userId");
CREATE UNIQUE INDEX "NotificationSetting_orgId_userId_key" ON "NotificationSetting"("orgId", "userId");
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_orgId_userId_idx" ON "PushSubscription"("orgId", "userId");
