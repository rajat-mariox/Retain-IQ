import { SYSTEM_ROLES } from "@retainiq/authz";
import type { Prisma } from "@retainiq/database/identity";

/**
 * Ensures the built-in system roles exist for an org and returns a name→id map.
 * Idempotent so it can run on create-org, member-invite, boot, etc. Run inside
 * the caller's transaction.
 *
 * Built-in roles still at version 1 (never edited by the org) are re-synced to
 * the code definition, so a change to a default propagates to existing orgs.
 * Once an admin edits a built-in role's permissions (RbacService.updateRole bumps
 * `version`), the org owns that set and it's left alone. The Owner role is
 * always kept at the full code definition — it can't be edited.
 */
export async function ensureSystemRoles(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const role of SYSTEM_ROLES) {
    const existing = await tx.role.findUnique({ where: { orgId_name: { orgId, name: role.name } } });
    if (!existing) {
      const created = await tx.role.create({
        data: { orgId, name: role.name, description: role.description, permissions: role.permissions, isSystem: true },
      });
      byName.set(role.name, created.id);
      continue;
    }
    const customized = role.name !== OWNER_ROLE && existing.version > 1;
    if (!customized) {
      await tx.role.update({
        where: { id: existing.id },
        data: { description: role.description, permissions: role.permissions, isSystem: true },
      });
    }
    byName.set(role.name, existing.id);
  }
  return byName;
}

/** The one built-in role that stays fixed (editing it could lock the org out). */
export const OWNER_ROLE = "Owner";
