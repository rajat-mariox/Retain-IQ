import { Controller, Get, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { PublicRoute } from "../../common/decorators/public-route.decorator.js";
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
  @PublicRoute("a person's own productivity")
  me() {
    return this.insights.me();
  }

  /**
   * Org-wide workforce analytics (AI Analytics — derived): every employee's
   * productivity, focus and burnout-risk. Same sensitivity as /executive, so it
   * takes the same permission — without this any member could read the whole
   * team's productivity profile.
   */
  @Get("team")
  @RequireFeature("aiInsights")
  @RequirePermissions(permissions.employeeRead)
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
