import type { PrismaClient } from "@retainiq/database/notifications";
import type { Audience } from "./rules.js";

// Roles that should receive org-level operational notifications.
const ADMIN_ROLES = ["Owner", "Admin", "HR Admin"];
// Roles that can approve leave (also receive leave requests).
const APPROVER_ROLES = ["Owner", "Admin", "HR Admin", "Manager"];

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

  // A specific user carried by the event (e.g. the employee who applied for leave).
  if (audience === "requester") {
    const requesterUserId = payload.requesterUserId;
    return typeof requesterUserId === "string" ? [requesterUserId] : [];
  }

  // The one manager who approved this (carried by the event) — not every manager.
  // Used for leave.cancelled, so only the person who signed it off hears about it.
  if (audience === "approver") {
    const approverUserId = payload.approverUserId;
    return typeof approverUserId === "string" ? [approverUserId] : [];
  }

  // The user a task was assigned to, carried by the event.
  if (audience === "assignee") {
    const assigneeUserId = payload.assigneeUserId;
    return typeof assigneeUserId === "string" ? [assigneeUserId] : [];
  }

  const roles = audience === "approvers" ? APPROVER_ROLES : ADMIN_ROLES;
  const recipients = await prisma.orgRecipient.findMany({
    where: { orgId, status: "ACTIVE", roleName: { in: roles } },
    select: { userId: true },
  });

  return [...new Set(recipients.map((r) => r.userId))];
}
