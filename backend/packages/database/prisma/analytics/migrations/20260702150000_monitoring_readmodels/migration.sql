-- Employee-monitoring detail read models (sessions, app/website usage, timeline).

CREATE TABLE "WorkSession" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "idleSeconds" INTEGER NOT NULL DEFAULT 0,
    "breakSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkSession_orgId_employeeId_sessionKey_key" ON "WorkSession"("orgId", "employeeId", "sessionKey");
CREATE INDEX "WorkSession_orgId_employeeId_day_idx" ON "WorkSession"("orgId", "employeeId", "day");
CREATE INDEX "WorkSession_orgId_day_idx" ON "WorkSession"("orgId", "day");

CREATE TABLE "AppUsageDaily" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "appName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppUsageDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppUsageDaily_orgId_employeeId_day_appName_key" ON "AppUsageDaily"("orgId", "employeeId", "day", "appName");
CREATE INDEX "AppUsageDaily_orgId_day_idx" ON "AppUsageDaily"("orgId", "day");
CREATE INDEX "AppUsageDaily_orgId_employeeId_day_idx" ON "AppUsageDaily"("orgId", "employeeId", "day");

CREATE TABLE "WebsiteUsageDaily" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "domain" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebsiteUsageDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebsiteUsageDaily_orgId_employeeId_day_domain_key" ON "WebsiteUsageDaily"("orgId", "employeeId", "day", "domain");
CREATE INDEX "WebsiteUsageDaily_orgId_day_idx" ON "WebsiteUsageDaily"("orgId", "day");
CREATE INDEX "WebsiteUsageDaily_orgId_employeeId_day_idx" ON "WebsiteUsageDaily"("orgId", "employeeId", "day");

CREATE TABLE "ActivityEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT,
    "detail" TEXT,
    "category" TEXT,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityEvent_orgId_employeeId_day_occurredAt_idx" ON "ActivityEvent"("orgId", "employeeId", "day", "occurredAt");
CREATE INDEX "ActivityEvent_orgId_day_idx" ON "ActivityEvent"("orgId", "day");
CREATE INDEX "ActivityEvent_orgId_employeeId_occurredAt_idx" ON "ActivityEvent"("orgId", "employeeId", "occurredAt");
