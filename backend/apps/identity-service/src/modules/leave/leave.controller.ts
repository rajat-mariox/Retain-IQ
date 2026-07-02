import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { LeaveService } from "./leave.service.js";

const createTypeSchema = z.object({
  name: z.string().min(1).max(60),
  code: z.string().min(1).max(10),
  annualQuota: z.coerce.number().int().min(0).max(365).optional(),
  paid: z.boolean().optional(),
  color: z.string().max(9).nullable().optional(),
});
const updateTypeSchema = z
  .object({ name: z.string().min(1).max(60), annualQuota: z.coerce.number().int().min(0).max(365), paid: z.boolean(), color: z.string().max(9).nullable(), status: z.enum(["ACTIVE", "ARCHIVED"]) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });
const createRequestSchema = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(500).optional(),
});
const decisionSchema = z.object({ approve: z.boolean(), note: z.string().max(500).optional() });

@Controller("leave")
@RequireFeature("attendance")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get("types")
  listTypes() {
    return this.leave.listTypes();
  }

  @Post("types")
  @RequirePermissions(permissions.attendanceApprove)
  createType(@Body(new ZodValidationPipe(createTypeSchema)) body: z.infer<typeof createTypeSchema>) {
    return this.leave.createType(body);
  }

  @Patch("types/:id")
  @RequirePermissions(permissions.attendanceApprove)
  updateType(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateTypeSchema)) body: z.infer<typeof updateTypeSchema>) {
    return this.leave.updateType(id, body);
  }

  /** The caller's own leave balances. */
  @Get("me/balances")
  myBalances(@Query("year") year?: string) {
    return this.leave.balances(undefined, year ? Number(year) : undefined);
  }

  /** Any employee's balances — managers/admins. */
  @Get("balances")
  @RequirePermissions(permissions.attendanceRead)
  balances(@Query("employeeId") employeeId?: string, @Query("year") year?: string) {
    return this.leave.balances(employeeId, year ? Number(year) : undefined);
  }

  /** The caller's own leave requests. */
  @Get("requests")
  myRequests(@Query("status") status?: string) {
    return this.leave.listRequests({ scope: "mine", status });
  }

  /** Org-wide leave requests (approval center) — managers/admins. */
  @Get("requests/all")
  @RequirePermissions(permissions.attendanceRead)
  allRequests(@Query("status") status?: string, @Query("employeeId") employeeId?: string) {
    return this.leave.listRequests({ scope: "all", status, employeeId });
  }

  @Post("requests")
  createRequest(@Body(new ZodValidationPipe(createRequestSchema)) body: z.infer<typeof createRequestSchema>) {
    return this.leave.createRequest(body);
  }

  @Post("requests/:id/decision")
  @RequirePermissions(permissions.attendanceApprove)
  decide(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(decisionSchema)) body: z.infer<typeof decisionSchema>) {
    return this.leave.decide(id, body.approve, body.note);
  }

  @Post("requests/:id/cancel")
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.leave.cancel(id);
  }
}
