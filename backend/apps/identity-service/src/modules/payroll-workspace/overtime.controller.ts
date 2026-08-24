import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { OvertimeService } from "./overtime.service.js";

const overtimeSchema = z.object({
  employeeId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.coerce.number().positive().max(24),
  dayType: z.enum(["WEEKDAY", "WEEKEND", "HOLIDAY", "NIGHT"]),
  multiplier: z.coerce.number().min(1).max(5).optional(),
  note: z.string().max(500).optional(),
});

const chooseSchema = z.object({ choice: z.enum(["PAID", "COMP_OFF"]) });

/**
 * Overtime & comp-off (§14).
 *
 * Recording overtime (and resolving an employee's PAID/comp-off choice) requires
 * payroll.overtime.approve — the caller signing off IS the approval. Reading a
 * comp-off balance requires payroll.record.read and is scoped to the caller's reach.
 */
@Controller("payroll")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class OvertimeController {
  constructor(private readonly overtime: OvertimeService) {}

  /** Record a block of overtime; the org OT policy decides paid vs comp-off. */
  @Post("overtime")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollOvertimeApprove)
  record(@Body(new ZodValidationPipe(overtimeSchema)) body: z.infer<typeof overtimeSchema>) {
    return this.overtime.record(body);
  }

  /** Resolve an EMPLOYEE_CHOICE overtime record into paid or comp-off. */
  @Post("overtime/:id/choose")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollOvertimeApprove)
  choose(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(chooseSchema)) body: z.infer<typeof chooseSchema>) {
    return this.overtime.chooseMode(id, body.choice);
  }

  /** An employee's comp-off balance and ledger. */
  @Get("employees/:id/comp-off")
  @RequirePermissions(permissions.payrollRecordRead)
  compOff(@Param("id", ParseUUIDPipe) id: string) {
    return this.overtime.compOff(id);
  }
}
