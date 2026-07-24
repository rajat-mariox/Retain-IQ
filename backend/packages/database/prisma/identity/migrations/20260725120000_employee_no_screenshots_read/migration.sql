-- Employees no longer get a screenshot gallery: they see their own productivity
-- via /insights/me instead. Strip screenshots.read from every seeded Employee
-- system role in existing orgs, and bump the role version so any cached
-- permission bundles are invalidated on the next check.
UPDATE "Role"
SET permissions = array_remove(permissions, 'screenshots.read'),
    version = version + 1
WHERE "isSystem" = true
  AND name = 'Employee'
  AND 'screenshots.read' = ANY(permissions);
