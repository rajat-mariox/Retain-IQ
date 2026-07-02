import { Injectable } from "@nestjs/common";
import type { Permission, PermissionBundle } from "@retainiq/authz";
import { PrismaService } from "../database/prisma.service.js";
import { PermissionCache } from "./permission-cache.js";

/**
 * Resolves the effective permission bundle for an active membership from the
 * database (cached). This is the authoritative source the PermissionGuard
 * checks against — access-token claims are never trusted for authorization,
 * only for identifying which membership to load.
 */
@Injectable()
export class PermissionBundleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: PermissionCache,
  ) {}

  /**
   * Effective permissions for a user in an org = the UNION across all their
   * active role grants (multi-grant RBAC). Keyed by user (membership is 1:1 with
   * user per org). Falls back to the membership's primary role if no grants exist
   * yet (defensive — the migration backfills an ORG grant for every member).
   */
  async resolve(orgId: string, userId: string): Promise<PermissionBundle | null> {
    const key = `${orgId}:${userId}`;
    const cached = await this.cache.get(key);
    if (cached) {
      return cached;
    }

    const membership = await this.prisma.organizationMembership.findFirst({
      where: { orgId, userId, status: "ACTIVE" },
      select: { role: { select: { name: true, permissions: true, version: true } } },
    });
    if (!membership) {
      return null;
    }

    const grants = await this.prisma.roleAssignment.findMany({
      where: { orgId, userId, status: "ACTIVE" },
      select: { role: { select: { permissions: true, version: true } } },
    });

    const permissionSet = new Set<Permission>();
    let version = 0;
    if (grants.length > 0) {
      for (const g of grants) {
        for (const p of g.role.permissions as Permission[]) permissionSet.add(p);
        version += g.role.version;
      }
    } else {
      for (const p of membership.role.permissions as Permission[]) permissionSet.add(p);
      version = membership.role.version;
    }

    const bundle: PermissionBundle = { role: membership.role.name, permissions: [...permissionSet], version };
    await this.cache.set(key, bundle);
    return bundle;
  }

  /** Drops the cached bundle so the next request re-reads from the database. */
  invalidate(orgId: string, userId: string): Promise<void> {
    return this.cache.invalidate(`${orgId}:${userId}`);
  }
}
