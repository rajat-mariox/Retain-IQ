import { Controller, Get, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { InsightsService } from "./insights.service.js";

// Gated per-route: /me is Time Tracking, /team is AI Analytics — two different
// feature flags, so the gate can't sit on the whole controller. PermissionGuard
// is a no-op unless a route declares @RequirePermissions.
@Controller("insights")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** The caller's own time/productivity (Time Tracking). */
  @Get("me")
  @RequireFeature("timeTracking")
  me() {
    return this.insights.me();
  }

  /** Org-wide workforce analytics (AI Analytics — derived). */
  @Get("team")
  @RequireFeature("aiInsights")
  team() {
    return this.insights.team();
  }

  /** Executive Overview: workforce headcount, health score, attrition, productivity. */
  @Get("executive")
  @RequirePermissions(permissions.employeeRead)
  executive() {
    return this.insights.executiveOverview();
  }
}
