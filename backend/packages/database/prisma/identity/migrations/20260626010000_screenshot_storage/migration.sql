-- Screenshot storage metadata (binaries live in S3/MinIO).
CREATE TABLE "ScreenshotObject" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID,
    "key" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScreenshotObject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScreenshotObject_key_key" ON "ScreenshotObject"("key");
CREATE INDEX "ScreenshotObject_orgId_capturedAt_idx" ON "ScreenshotObject"("orgId", "capturedAt");

ALTER TABLE "ScreenshotObject" ADD CONSTRAINT "ScreenshotObject_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScreenshotObject" ADD CONSTRAINT "ScreenshotObject_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
