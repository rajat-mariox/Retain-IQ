-- Org-level overtime compensation policy: PAY (default, unchanged) | COMP_OFF.
ALTER TABLE "PayrollSetting" ADD COLUMN "overtimeHandling" TEXT NOT NULL DEFAULT 'PAY';

-- Comp-off balance ledger (balance = SUM(deltaDays) per employee).
CREATE TABLE "CompOffLedger" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "orgId"      UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "deltaDays"  DOUBLE PRECISION NOT NULL,
  "source"     TEXT NOT NULL,
  "sourceRef"  UUID,
  "note"       TEXT,
  "grantedBy"  UUID,
  "expiresAt"  TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompOffLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompOffLedger_orgId_employeeId_idx" ON "CompOffLedger" ("orgId", "employeeId");
CREATE INDEX "CompOffLedger_orgId_source_sourceRef_idx" ON "CompOffLedger" ("orgId", "source", "sourceRef");

ALTER TABLE "CompOffLedger" ADD CONSTRAINT "CompOffLedger_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompOffLedger" ADD CONSTRAINT "CompOffLedger_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
