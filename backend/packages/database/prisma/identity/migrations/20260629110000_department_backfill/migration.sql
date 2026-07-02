-- Backfill: create a Department per distinct legacy Employee.department text
-- (per org), then point employees at it. Idempotent (slug unique + DO NOTHING).
INSERT INTO "Department" ("id", "orgId", "name", "slug", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), e."orgId", e."department",
       lower(regexp_replace(trim(e."department"), '[^a-zA-Z0-9]+', '-', 'g')),
       'ACTIVE', now(), now()
FROM (
  SELECT DISTINCT "orgId", "department"
  FROM "Employee"
  WHERE "department" IS NOT NULL AND trim("department") <> ''
) e
ON CONFLICT ("orgId", "slug") DO NOTHING;

UPDATE "Employee" e
SET "departmentId" = d."id"
FROM "Department" d
WHERE d."orgId" = e."orgId"
  AND d."slug" = lower(regexp_replace(trim(e."department"), '[^a-zA-Z0-9]+', '-', 'g'))
  AND e."department" IS NOT NULL AND trim(e."department") <> ''
  AND e."departmentId" IS NULL;
