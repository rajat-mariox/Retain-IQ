-- Phase 1: supporting-document upload on leave requests. Additive; no existing
-- data touched. Binaries live in S3/MinIO; this table holds metadata + object key.
CREATE TABLE "LeaveAttachment" (
  "id"             UUID NOT NULL,
  "orgId"          UUID NOT NULL,
  "leaveRequestId" UUID NOT NULL,
  "fileName"       TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "sizeBytes"      BIGINT NOT NULL,
  "contentType"    TEXT NOT NULL DEFAULT 'application/octet-stream',
  "uploadedBy"     UUID,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaveAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaveAttachment_key_key" ON "LeaveAttachment"("key");
CREATE INDEX "LeaveAttachment_orgId_leaveRequestId_idx" ON "LeaveAttachment"("orgId", "leaveRequestId");

ALTER TABLE "LeaveAttachment"
  ADD CONSTRAINT "LeaveAttachment_leaveRequestId_fkey"
  FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
