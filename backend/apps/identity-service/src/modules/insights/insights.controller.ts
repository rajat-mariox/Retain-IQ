import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { PublicRoute } from "../../common/decorators/public-route.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { InsightsService } from "./insights.service.js";

const targetSchema = z.object({ target: z.coerce.number().int().min(0).max(100).nullable() });

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

  /**
   * Productivity rolled up by department and by team (averages of productivity,
   * focus, active hours + headcount + burnout count). Same sensitivity/gating as
   * /team; scope-aware in the service.
   */
  @Get("by-group")
  @RequireFeature("aiInsights")
  @RequirePermissions(permissions.employeeRead)
  byGroup() {
    return this.insights.byGroup();
  }

  /**
   * Dashboard overview: workforce headcount, health score, attrition,
   * productivity — SCOPE-AWARE. Available to any member; the data is filtered by
   * the caller's RBAC/ABAC scope (Owner → whole org, scoped manager → their
   * department/reports, employee → only themselves), so no permission gate is
   * needed — breadth is enforced in the service, not the route.
   */
  @Get("executive")
  @PublicRoute("a scope-limited dashboard overview every member gets")
  executive() {
    return this.insights.executiveOverview();
  }

  /** The org's productivity target (%). */
  @Get("productivity-target")
  @RequireFeature("aiInsights")
  @RequirePermissions(permissions.employeeRead)
  getProductivityTarget() {
    return this.insights.getProductivityTarget();
  }

  /** Set or clear the org's productivity target (managers/admins). */
  @Post("productivity-target")
  @RequireFeature("aiInsights")
  @RequirePermissions(permissions.employeeWrite)
  setProductivityTarget(@Body(new ZodValidationPipe(targetSchema)) body: z.infer<typeof targetSchema>) {
    return this.insights.setProductivityTarget(body.target);
  }
}
