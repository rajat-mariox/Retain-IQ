import type { PrismaClient } from "@retainiq/database/notifications";
import type { Audience } from "./rules.js";

// Roles that should receive org-level operational notifications.
const ADMIN_ROLES = ["Owner", "Admin", "HR Admin"];

/**
 * Resolves the set of recipient userIds for a notification audience within an
 * org. `owner` reads the event payload; `org-admins` queries the LOCAL
 * OrgRecipient read model (projected from identity `org.member.upserted` events)
 * — never the identity database. Tenant-scoped by orgId.
 */
export async function resolveRecipients(
  prisma: PrismaClient,
  orgId: string,
  audience: Audience,
  payload: Record<string, unknown>,
): Promise<string[]> {
  if (audience === "owner") {
    const ownerUserId = payload.ownerUserId;
    return typeof ownerUserId === "string" ? [ownerUserId] : [];
  }

  const recipients = await prisma.orgRecipient.findMany({
    where: { orgId, status: "ACTIVE", roleName: { in: ADMIN_ROLES } },
    select: { userId: true },
  });

  return [...new Set(recipients.map((r) => r.userId))];
}
