import { CanActivate, ForbiddenException, Injectable } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.store.js";

/**
 * Ensures an authenticated tenant principal is present before tenant-scoped
 * handlers run. AuthGuard populates the context; this guard guarantees the
 * org/membership pair exists so downstream repositories can scope by orgId.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(): boolean {
    const context = getRequestContext();

    if (!context.orgId || !context.membershipId) {
      throw new ForbiddenException("Tenant context is missing.");
    }

    return true;
  }
}
