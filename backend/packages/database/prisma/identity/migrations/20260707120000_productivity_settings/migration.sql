-- CreateTable
CREATE TABLE "ProductivitySetting" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "productiveApps" TEXT[],
    "productiveDomains" TEXT[],
    "distractingApps" TEXT[],
    "distractingDomains" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductivitySetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductivitySetting_orgId_key" ON "ProductivitySetting"("orgId");

-- AddForeignKey
ALTER TABLE "ProductivitySetting" ADD CONSTRAINT "ProductivitySetting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
