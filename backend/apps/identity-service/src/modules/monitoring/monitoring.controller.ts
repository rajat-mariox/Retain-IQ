import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { MonitoringService } from "./monitoring.service.js";

/** Employee-monitoring read API (activity timeline, apps, websites, sessions, presence). */
@Controller("monitoring")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get("summary")
  @RequirePermissions(permissions.employeeRead)
  summary(@Query("day") day?: string, @Query("employeeId") employeeId?: string) {
    return this.monitoring.summary(day, employeeId);
  }

  @Get("presence")
  @RequirePermissions(permissions.employeeRead)
  presence(@Query("day") day?: string, @Query("employeeId") employeeId?: string) {
    return this.monitoring.presence(day, employeeId);
  }

  @Get("apps")
  @RequirePermissions(permissions.employeeRead)
  apps(@Query("day") day?: string, @Query("employeeId") employeeId?: string) {
    return this.monitoring.apps(day, employeeId);
  }

  @Get("websites")
  @RequirePermissions(permissions.employeeRead)
  websites(@Query("day") day?: string, @Query("employeeId") employeeId?: string) {
    return this.monitoring.websites(day, employeeId);
  }

  @Get("sessions")
  @RequirePermissions(permissions.employeeRead)
  sessions(@Query("day") day?: string, @Query("employeeId") employeeId?: string) {
    return this.monitoring.sessions(day, employeeId);
  }

  @Get("timeline")
  @RequirePermissions(permissions.employeeRead)
  timeline(@Query("employeeId") employeeId: string, @Query("day") day?: string) {
    return this.monitoring.timeline(employeeId, day);
  }
}
