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

  async resolve(orgId: string, membershipId: string): Promise<PermissionBundle | null> {
    const key = `${orgId}:${membershipId}`;
    const cached = await this.cache.get(key);
    if (cached) {
      return cached;
    }

    const membership = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, orgId, status: "ACTIVE" },
      select: {
        role: { select: { name: true, permissions: true, version: true } },
      },
    });

    if (!membership) {
      return null;
    }

    const bundle: PermissionBundle = {
      role: membership.role.name,
      permissions: membership.role.permissions as Permission[],
      version: membership.role.version,
    };

    await this.cache.set(key, bundle);
    return bundle;
  }

  /** Drops the cached bundle so the next request re-reads from the database. */
  invalidate(orgId: string, membershipId: string): Promise<void> {
    return this.cache.invalidate(`${orgId}:${membershipId}`);
  }
}
