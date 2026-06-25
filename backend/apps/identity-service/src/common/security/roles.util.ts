import { SYSTEM_ROLES } from "@retainiq/authz";
import type { Prisma } from "@retainiq/database/identity";

/**
 * Ensures the Owner/Manager/Employee system roles exist for an org and returns
 * a name→id map. Idempotent (upsert by orgId+name) so it can run on create-org,
 * member-invite, etc. Run inside the caller's transaction.
 */
export async function ensureSystemRoles(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  for (const role of SYSTEM_ROLES) {
    const row = await tx.role.upsert({
      where: { orgId_name: { orgId, name: role.name } },
      create: { orgId, name: role.name, description: role.description, permissions: role.permissions, isSystem: true },
      update: { description: role.description, permissions: role.permissions },
    });
    byName.set(role.name, row.id);
  }
  return byName;
}
