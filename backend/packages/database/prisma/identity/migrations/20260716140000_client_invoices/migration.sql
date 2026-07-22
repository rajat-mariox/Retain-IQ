-- CreateEnum
CREATE TYPE "ClientInvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "ClientInvoice" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" "ClientInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "dueAt" DATE,
    "paidAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientInvoice_pkey" PRIMARY KEY ("id")
);

-- A period must not end before it starts.
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_period_check" CHECK ("periodEnd" >= "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "ClientInvoice_orgId_invoiceNumber_key" ON "ClientInvoice"("orgId", "invoiceNumber");
CREATE INDEX "ClientInvoice_orgId_status_idx" ON "ClientInvoice"("orgId", "status");
CREATE INDEX "ClientInvoice_orgId_clientId_periodStart_idx" ON "ClientInvoice"("orgId", "clientId", "periodStart");

-- AddForeignKey
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientInvoice" ADD CONSTRAINT "ClientInvoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ClientInvoiceLine" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "projectId" UUID,
    "employeeId" UUID,
    "description" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "billRateCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientInvoiceLine_orgId_invoiceId_idx" ON "ClientInvoiceLine"("orgId", "invoiceId");

-- AddForeignKey
ALTER TABLE "ClientInvoiceLine" ADD CONSTRAINT "ClientInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ClientInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
