-- Multi-grant RBAC: RoleAssignment (user → role @ scope).
CREATE TYPE "ScopeType" AS ENUM ('ORG', 'DEPARTMENT', 'TEAM', 'SELF');

CREATE TABLE "RoleAssignment" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "employeeId" UUID,
    "roleId" UUID NOT NULL,
    "scopeType" "ScopeType" NOT NULL DEFAULT 'ORG',
    "scopeId" UUID,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RoleAssignment_orgId_userId_roleId_scopeType_scopeId_key" ON "RoleAssignment"("orgId", "userId", "roleId", "scopeType", "scopeId");
CREATE INDEX "RoleAssignment_orgId_userId_status_idx" ON "RoleAssignment"("orgId", "userId", "status");
CREATE INDEX "RoleAssignment_orgId_roleId_idx" ON "RoleAssignment"("orgId", "roleId");
CREATE INDEX "RoleAssignment_scopeType_scopeId_idx" ON "RoleAssignment"("scopeType", "scopeId");

ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every active membership becomes an ORG-scoped grant of its current
-- role, so effective permissions are unchanged after the resolver switches to
-- unioning grants. Idempotent via the unique index.
INSERT INTO "RoleAssignment" ("id", "orgId", "userId", "employeeId", "roleId", "scopeType", "scopeId", "status", "createdAt")
SELECT gen_random_uuid(), m."orgId", m."userId", m."employeeId", m."roleId", 'ORG', NULL, 'ACTIVE', now()
FROM "OrganizationMembership" m
WHERE m."status" = 'ACTIVE'
ON CONFLICT ("orgId", "userId", "roleId", "scopeType", "scopeId") DO NOTHING;
