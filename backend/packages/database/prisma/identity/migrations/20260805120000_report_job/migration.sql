-- CreateEnum
CREATE TYPE "ReportJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "ReportJob" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "requestedBy" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "status" "ReportJobStatus" NOT NULL DEFAULT 'PENDING',
    "fileKey" TEXT,
    "fileName" TEXT,
    "rowCount" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportJob_orgId_requestedBy_idx" ON "ReportJob"("orgId", "requestedBy");

-- CreateIndex
CREATE INDEX "ReportJob_status_createdAt_idx" ON "ReportJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ReportJob" ADD CONSTRAINT "ReportJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
