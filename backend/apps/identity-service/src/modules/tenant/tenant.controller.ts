import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { offsetPaginationQuerySchema, type OffsetPaginationQuery } from "@retainiq/contracts";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { PublicRoute } from "../../common/decorators/public-route.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { TenantService } from "./tenant.service.js";

// PermissionGuard is listed so the per-route @RequirePermissions below actually
// enforces; it's a no-op on routes that don't declare one.
@Controller("org")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  /** The caller's own organization profile (name, region, timezone). */
  @Get()
  @PublicRoute("a member's own org profile")
  getCurrentOrg() {
    return this.tenantService.getCurrentOrg(requireTenantContext());
  }

  /**
   * The full member roster — everyone's email, name, role and status. That's
   * staff directory data, so it takes employee.read rather than being readable
   * by any member.
   */
  @Get("members")
  @RequirePermissions(permissions.employeeRead)
  listMembers(@Query(new ZodValidationPipe(offsetPaginationQuerySchema)) query: OffsetPaginationQuery) {
    return this.tenantService.listMembers(requireTenantContext(), query);
  }
}
