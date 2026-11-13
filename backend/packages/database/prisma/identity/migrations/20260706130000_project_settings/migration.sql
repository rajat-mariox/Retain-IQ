-- CreateTable
CREATE TABLE "ProjectSetting" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "statuses" JSONB NOT NULL DEFAULT '[]',
    "priorities" JSONB NOT NULL DEFAULT '[]',
    "defaultProjectStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "defaultTaskPriority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "workflow" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSetting_orgId_key" ON "ProjectSetting"("orgId");

-- AddForeignKey
ALTER TABLE "ProjectSetting" ADD CONSTRAINT "ProjectSetting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
