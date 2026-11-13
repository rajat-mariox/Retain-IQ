import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ProbationService } from "./probation.service.js";

const startSchema = z.object({
  durationMonths: z.coerce.number().int().min(1).max(24).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const reviewSchema = z.object({
  recommendation: z.enum(["CONFIRM", "EXTEND", "TERMINATE"]),
  performanceNote: z.string().max(1000).optional(),
  attendanceNote: z.string().max(1000).optional(),
  reviewNote: z.string().max(1000).optional(),
  extendMonths: z.coerce.number().int().min(1).max(12).optional(),
  exitReason: z.enum(["TERMINATION", "CONTRACT_END", "OTHER"]).optional(),
});

/**
 * Structured probation & confirmation under the employee resource. Starting and
 * reviewing need employee.write; the service ABAC-scopes the subject employee.
 */
@Controller("employees")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class ProbationController {
  constructor(private readonly probation: ProbationService) {}

  @Post(":employeeId/probation")
  @RequirePermissions(permissions.employeeWrite)
  start(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>) {
    return this.probation.start(employeeId, body);
  }

  @Get(":employeeId/probations")
  @RequirePermissions(permissions.employeeRead)
  list(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.probation.listForEmployee(employeeId);
  }

  @Post("probations/:probationId/review")
  @RequirePermissions(permissions.employeeWrite)
  review(@Param("probationId", ParseUUIDPipe) probationId: string, @Body(new ZodValidationPipe(reviewSchema)) body: z.infer<typeof reviewSchema>) {
    return this.probation.review(probationId, body);
  }
}
