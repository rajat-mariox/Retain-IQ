-- CreateEnum
CREATE TYPE "ReviewCycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');
CREATE TYPE "PerformanceReviewStatus" AS ENUM ('PENDING', 'SELF_REVIEW', 'IN_REVIEW', 'SUBMITTED', 'ACKNOWLEDGED');

-- CreateTable
CREATE TABLE "ReviewCycle" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "status" "ReviewCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReviewCycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PerformanceReview" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "reviewerEmployeeId" UUID,
    "status" "PerformanceReviewStatus" NOT NULL DEFAULT 'PENDING',
    "overallRating" INTEGER,
    "selfAssessment" TEXT,
    "strengths" TEXT,
    "improvements" TEXT,
    "managerComment" TEXT,
    "submittedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PerformanceReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewRating" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "competency" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    CONSTRAINT "ReviewRating_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Achievement" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "awardedOn" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewCycle_orgId_status_idx" ON "ReviewCycle"("orgId", "status");
CREATE UNIQUE INDEX "PerformanceReview_cycleId_employeeId_key" ON "PerformanceReview"("cycleId", "employeeId");
CREATE INDEX "PerformanceReview_orgId_employeeId_idx" ON "PerformanceReview"("orgId", "employeeId");
CREATE INDEX "PerformanceReview_orgId_cycleId_idx" ON "PerformanceReview"("orgId", "cycleId");
CREATE INDEX "ReviewRating_orgId_reviewId_idx" ON "ReviewRating"("orgId", "reviewId");
CREATE INDEX "Achievement_orgId_employeeId_idx" ON "Achievement"("orgId", "employeeId");

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewRating" ADD CONSTRAINT "ReviewRating_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "PerformanceReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
