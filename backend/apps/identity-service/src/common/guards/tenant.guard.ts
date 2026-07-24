import { CanActivate, ForbiddenException, Injectable } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.store.js";
import { OrgStatusService } from "../security/org-status.service.js";

/**
 * Ensures an authenticated tenant principal is present AND still active before
 * tenant-scoped handlers run. AuthGuard populates the context from the JWT; this
 * guard guarantees the org/membership pair exists and re-validates (via a
 * short-TTL cache) that the org, membership, and user are all ACTIVE — so a
 * suspended or soft-deleted org's still-valid access tokens are rejected within
 * seconds rather than serving data until the token expires.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly orgStatus: OrgStatusService) {}

  async canActivate(): Promise<boolean> {
    const context = getRequestContext();

    if (!context.orgId || !context.membershipId) {
      throw new ForbiddenException("Tenant context is missing.");
    }

    const liveness = await this.orgStatus.resolve(context.orgId, context.membershipId);
    if (!liveness.ok) {
      if (liveness.orgStatus === "SUSPENDED") throw new ForbiddenException("This organization is suspended.");
      throw new ForbiddenException("This account is no longer active.");
    }

    return true;
  }
}
