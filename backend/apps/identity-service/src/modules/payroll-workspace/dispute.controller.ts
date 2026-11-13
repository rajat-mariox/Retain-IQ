import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { DisputeService } from "./dispute.service.js";

const createSchema = z.object({
  recordId: z.string().uuid().nullable().optional(),
  category: z.enum(["INCORRECT_BASE", "MISSING_INCENTIVE", "WRONG_DEDUCTION", "TAX", "NOT_RECEIVED", "OTHER"]),
  description: z.string().min(3).max(2000),
});
const assignSchema = z.object({ assignedTo: z.string().uuid().optional() });
const resolveSchema = z.object({
  status: z.enum(["UNDER_REVIEW", "EMPLOYEE_INPUT_REQUIRED", "RESOLVED", "CLOSED"]),
  resolution: z.string().max(2000).optional(),
});
const respondSchema = z.object({ note: z.string().min(1).max(2000) });

/**
 * Payroll disputes (§19). Employees raise and track their own; HR/Finance work the
 * queue (assign → review → resolve). Empty controller prefix so both the staff
 * surface (/me/payroll/disputes) and the admin surface (/payroll/disputes) live here.
 */
@Controller()
@RequireFeature("payroll")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class DisputeController {
  constructor(private readonly disputes: DisputeService) {}

  // ---- employee (self) ----

  /** Raise a dispute about your own payout. */
  @Post("payroll/disputes")
  @HttpCode(201)
  @RequirePermissions(permissions.payrollDisputeCreate)
  create(@Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.disputes.create({ recordId: body.recordId ?? null, category: body.category, description: body.description });
  }

  /** The caller's own disputes. */
  @Get("me/payroll/disputes")
  @RequirePermissions(permissions.payrollDisputeCreate)
  mine() {
    return this.disputes.mine();
  }

  /** Supply requested input on a dispute awaiting your response. */
  @Post("me/payroll/disputes/:id/respond")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollDisputeCreate)
  respond(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(respondSchema)) body: z.infer<typeof respondSchema>) {
    return this.disputes.respond(id, body.note);
  }

  // ---- admin (HR / Finance) ----

  /** Dispute queue, scoped to the caller's reach. */
  @Get("payroll/disputes")
  @RequirePermissions(permissions.payrollDisputeRead)
  list(@Query("status") status?: string, @Query("employeeId") employeeId?: string) {
    return this.disputes.list({ status, employeeId });
  }

  @Get("payroll/disputes/:id")
  @RequirePermissions(permissions.payrollDisputeRead)
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.disputes.get(id);
  }

  /** Assign a dispute (to a specific user, or to yourself). */
  @Post("payroll/disputes/:id/assign")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollDisputeAssign)
  assign(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(assignSchema)) body: z.infer<typeof assignSchema>) {
    return this.disputes.assign(id, body.assignedTo);
  }

  /** Move a dispute forward: review / request input / resolve / close. */
  @Post("payroll/disputes/:id/resolve")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollDisputeResolve)
  resolve(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(resolveSchema)) body: z.infer<typeof resolveSchema>) {
    return this.disputes.transition(id, body.status, body.resolution);
  }
}
