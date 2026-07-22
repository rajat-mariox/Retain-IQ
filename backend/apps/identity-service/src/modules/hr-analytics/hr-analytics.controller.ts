import { Controller, Get, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { HrAnalyticsService } from "./hr-analytics.service.js";

@Controller("hr-analytics")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class HrAnalyticsController {
  constructor(private readonly svc: HrAnalyticsService) {}

  @Get("overview")
  @RequirePermissions(permissions.employeeRead)
  overview() {
    return this.svc.overview();
  }

  @Get("talent-risk")
  @RequirePermissions(permissions.employeeRead)
  talentRisk() {
    return this.svc.talentRisk();
  }
}
