import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";

/**
 * Resolved liveness of a tenant session: is the org, the membership, and the
 * user all active right now? Checked on every authenticated request (via
 * TenantGuard) so suspending or soft-deleting an org locks out its existing
 * access tokens within seconds — not only after the token's natural expiry.
 *
 * Short TTL (10s) keeps this off the DB on the hot path while bounding how long
 * a just-suspended session survives; platform-admin lifecycle actions call
 * invalidate() so the effect is immediate.
 *
 * In-memory: correct for a single instance. For multi-instance deployments back
 * this with Redis (same seam as the permission cache).
 */
export interface OrgLiveness {
  ok: boolean;
  orgStatus: string;
  membershipStatus: string;
  userStatus: string;
}

type Entry = { value: OrgLiveness; expiresAt: number };

@Injectable()
export class OrgStatusService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly store = new Map<string, Entry>();
  private readonly ttlMs = 10_000;

  private key(orgId: string, membershipId: string): string {
    return `${orgId}:${membershipId}`;
  }

  /** Resolve (cached) whether this membership's org/membership/user are all ACTIVE. */
  async resolve(orgId: string, membershipId: string): Promise<OrgLiveness> {
    const key = this.key(orgId, membershipId);
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const membership = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, orgId },
      select: { status: true, org: { select: { status: true } }, user: { select: { status: true } } },
    });

    const value: OrgLiveness = membership
      ? {
          ok: membership.org.status === "ACTIVE" && membership.status === "ACTIVE" && membership.user.status === "ACTIVE",
          orgStatus: membership.org.status,
          membershipStatus: membership.status,
          userStatus: membership.user.status,
        }
      : { ok: false, orgStatus: "MISSING", membershipStatus: "MISSING", userStatus: "MISSING" };

    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  /** Drop cached liveness for an org (all its memberships) or everything. */
  invalidate(orgId?: string): void {
    if (!orgId) {
      this.store.clear();
      return;
    }
    for (const k of this.store.keys()) {
      if (k.startsWith(`${orgId}:`)) this.store.delete(k);
    }
  }
}
