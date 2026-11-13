import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ReportJobsService } from "./report-jobs.service.js";

const enqueueSchema = z.object({
  kind: z.enum(["attendance"]),
  format: z.enum(["csv", "xlsx"]).optional(),
  params: z.record(z.string(), z.any()).default({}),
});

/**
 * Async report generation — queue a large report, poll its status, download when
 * ready. Gated by attendance.read (the kinds supported are attendance reports).
 */
@Controller("reports/jobs")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class ReportJobsController {
  constructor(private readonly jobs: ReportJobsService) {}

  @Get()
  @RequirePermissions(permissions.attendanceRead)
  list() {
    return this.jobs.list();
  }

  @Post()
  @RequirePermissions(permissions.attendanceRead)
  enqueue(@Body(new ZodValidationPipe(enqueueSchema)) body: z.infer<typeof enqueueSchema>) {
    return this.jobs.enqueue(body);
  }

  @Get(":id/download")
  @RequirePermissions(permissions.attendanceRead)
  download(@Param("id", ParseUUIDPipe) id: string) {
    return this.jobs.downloadUrl(id);
  }
}
