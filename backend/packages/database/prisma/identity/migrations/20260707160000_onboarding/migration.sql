-- CreateEnum
CREATE TYPE "OnboardingItemCategory" AS ENUM ('TASK', 'DOCUMENT', 'POLICY', 'ACCESS', 'TRAINING');
CREATE TYPE "OnboardingAssignee" AS ENUM ('EMPLOYEE', 'HR', 'MANAGER', 'IT');
CREATE TYPE "OnboardingTaskStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');
CREATE TYPE "OnboardingJourneyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "OnboardingTemplate" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OnboardingTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingTemplateItem" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "OnboardingItemCategory" NOT NULL DEFAULT 'TASK',
    "assignee" "OnboardingAssignee" NOT NULL DEFAULT 'HR',
    "order" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "OnboardingTemplateItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingJourney" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "templateId" UUID,
    "status" "OnboardingJourneyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "OnboardingJourney_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingTask" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "OnboardingItemCategory" NOT NULL DEFAULT 'TASK',
    "assignee" "OnboardingAssignee" NOT NULL DEFAULT 'HR',
    "order" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "OnboardingTaskStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "completedBy" UUID,
    "note" TEXT,
    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingTemplate_orgId_idx" ON "OnboardingTemplate"("orgId");
CREATE INDEX "OnboardingTemplateItem_orgId_templateId_idx" ON "OnboardingTemplateItem"("orgId", "templateId");
CREATE UNIQUE INDEX "OnboardingJourney_employeeId_key" ON "OnboardingJourney"("employeeId");
CREATE INDEX "OnboardingJourney_orgId_status_idx" ON "OnboardingJourney"("orgId", "status");
CREATE INDEX "OnboardingTask_orgId_journeyId_idx" ON "OnboardingTask"("orgId", "journeyId");

-- AddForeignKey
ALTER TABLE "OnboardingTemplate" ADD CONSTRAINT "OnboardingTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OnboardingTemplateItem" ADD CONSTRAINT "OnboardingTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OnboardingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnboardingJourney" ADD CONSTRAINT "OnboardingJourney_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OnboardingJourney" ADD CONSTRAINT "OnboardingJourney_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnboardingJourney" ADD CONSTRAINT "OnboardingJourney_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OnboardingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "OnboardingJourney"("id") ON DELETE CASCADE ON UPDATE CASCADE;
