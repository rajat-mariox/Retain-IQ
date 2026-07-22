-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED');
CREATE TYPE "InterviewOutcome" AS ENUM ('PENDING', 'PASS', 'FAIL', 'HOLD');
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- AlterTable: enrich requisitions
ALTER TABLE "Requisition"
  ADD COLUMN "designationId" UUID,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "employmentType" TEXT,
  ADD COLUMN "description" TEXT;

-- CreateTable
CREATE TABLE "Candidate" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT,
    "resumeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "requisitionId" UUID NOT NULL,
    "stage" "ApplicationStage" NOT NULL DEFAULT 'APPLIED',
    "rating" INTEGER,
    "notes" TEXT,
    "rejectedReason" TEXT,
    "hiredEmployeeId" UUID,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Interview" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "round" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "interviewer" TEXT,
    "mode" TEXT,
    "outcome" "InterviewOutcome" NOT NULL DEFAULT 'PENDING',
    "rating" INTEGER,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Offer" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "title" TEXT,
    "salary" TEXT,
    "joiningDate" TIMESTAMP(3),
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Candidate_orgId_createdAt_idx" ON "Candidate"("orgId", "createdAt");
CREATE INDEX "Application_orgId_stage_idx" ON "Application"("orgId", "stage");
CREATE INDEX "Application_orgId_requisitionId_idx" ON "Application"("orgId", "requisitionId");
CREATE INDEX "Interview_orgId_applicationId_idx" ON "Interview"("orgId", "applicationId");
CREATE INDEX "Offer_orgId_applicationId_idx" ON "Offer"("orgId", "applicationId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Application" ADD CONSTRAINT "Application_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
