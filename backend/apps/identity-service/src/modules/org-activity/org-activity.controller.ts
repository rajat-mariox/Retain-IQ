import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { offsetPaginationQuerySchema, type OffsetPaginationQuery } from "@retainiq/contracts";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { OrgActivityService } from "./org-activity.service.js";

/**
 * The organization's own activity feed — the record of who did what across the
 * org (members invited, features changed). It's an audit log, so it isn't for
 * every employee: it needs audit.read, which the Owner has and an admin can
 * grant to a custom role. Gated by the "activityFeed" tenant feature too, so a
 * super-admin can turn it on or off per org.
 */
@Controller("activity")
@RequireFeature("activityFeed")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class OrgActivityController {
  constructor(private readonly activity: OrgActivityService) {}

  @Get()
  @RequirePermissions(permissions.auditRead)
  list(
    @Query(new ZodValidationPipe(offsetPaginationQuerySchema)) query: OffsetPaginationQuery,
    @Query("type") type?: string,
  ) {
    return this.activity.list({ ...query, type });
  }

  @Get("types")
  @RequirePermissions(permissions.auditRead)
  types() {
    return this.activity.types();
  }
}
