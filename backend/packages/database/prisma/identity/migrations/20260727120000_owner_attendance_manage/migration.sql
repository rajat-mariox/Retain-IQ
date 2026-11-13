-- Attendance policy is now editable by the org itself (not platform-admin only),
-- gated by a new attendance.manage permission. Grant it to every seeded Owner
-- system role in existing orgs, and bump the role version so cached permission
-- bundles are invalidated on the next check. (New orgs get it automatically via
-- allPermissions.) HR managers / other roles receive it by explicit grant, so
-- only the Owner role is backfilled here.
UPDATE "Role"
SET permissions = array_append(permissions, 'attendance.manage'),
    version = version + 1
WHERE "isSystem" = true
  AND name = 'Owner'
  AND NOT ('attendance.manage' = ANY(permissions));
