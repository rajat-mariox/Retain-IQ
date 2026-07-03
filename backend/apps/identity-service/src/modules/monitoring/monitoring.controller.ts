import { Body, Controller, Get, Patch, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { MonitoringService } from "./monitoring.service.js";

const policySchema = z
  .object({
    screenshotsEnabled: z.boolean(),
    screenshotIntervalSeconds: z.coerce.number().int().min(60).max(3600),
    screenshotQuality: z.coerce.number().int().min(10).max(100),
    screenshotMaxWidth: z.coerce.number().int().min(320).max(3840),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });

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

  /** Effective monitoring policy — any member (the desktop agent) can read it. */
  @Get("policy")
  policy() {
    return this.monitoring.getPolicy();
  }

  /** Update the org's monitoring policy — admins only. */
  @Patch("policy")
  @RequirePermissions(permissions.securityManage)
  updatePolicy(@Body(new ZodValidationPipe(policySchema)) body: z.infer<typeof policySchema>) {
    return this.monitoring.updatePolicy(body);
  }
}
