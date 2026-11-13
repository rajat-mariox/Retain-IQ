import { Controller, Get, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { DashboardService } from "./dashboard.service.js";

/** Payout dashboard (§6) — scoped, owner-excluded payroll aggregates for the current period. */
@Controller("payroll")
@RequireFeature("payroll")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("dashboard")
  @RequirePermissions(permissions.payrollDashboardRead)
  summary() {
    return this.dashboard.summary();
  }
}
