-- Correct the base-grant scope for regular employees: the initial backfill made
-- every membership an ORG-scoped grant, but Employees must see only their OWN
-- data. Move active Employee-role grants from ORG to SELF. Owner/Manager keep ORG
-- (preserving their prior org-wide visibility; managers can be re-scoped to a
-- department via the Access & roles UI).
UPDATE "RoleAssignment" ra
SET "scopeType" = 'SELF'
FROM "Role" r
WHERE ra."roleId" = r."id"
  AND r."name" = 'Employee'
  AND ra."scopeType" = 'ORG'
  AND ra."status" = 'ACTIVE';
