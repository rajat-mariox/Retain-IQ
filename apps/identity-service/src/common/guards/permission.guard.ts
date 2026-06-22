import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { missingPermissions, type Permission } from "@retainiq/authz";
import { getRequestContext } from "../context/request-context.store.js";
import { PermissionBundleService } from "../security/permission-bundle.service.js";
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator.js";

/**
 * Enforces @RequirePermissions by loading the membership's effective permission
 * bundle from the database (cached). Fails closed: any missing context, unknown
 * membership, or missing permission denies the request.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionBundleService: PermissionBundleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (required.length === 0) {
      return true;
    }

    const ctx = getRequestContext();
    if (!ctx.orgId || !ctx.membershipId) {
      throw new ForbiddenException("Authorization context is missing.");
    }

    const bundle = await this.permissionBundleService.resolve(ctx.orgId, ctx.membershipId);
    if (!bundle) {
      throw new ForbiddenException("Membership is not active.");
    }

    const missing = missingPermissions(bundle.permissions, required);
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing required permission(s): ${missing.join(", ")}.`);
    }

    return true;
  }
}
