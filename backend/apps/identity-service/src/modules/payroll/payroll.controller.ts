import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PayrollService } from "./payroll.service.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const periodSchema = z.object({ periodStart: date, periodEnd: date });
const createCycleSchema = periodSchema.extend({ note: z.string().max(300).optional() });

/**
 * Payroll cycles. Reading is payroll.read (Owner + Manager); running, locking
 * and marking paid are payroll.approve (Owner) — each moves or freezes money.
 */
@Controller("payroll/cycles")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get()
  @RequirePermissions(permissions.payrollRead)
  list() {
    return this.payroll.listCycles();
  }

  /** Dry-run a period without creating a cycle. */
  @Get("preview")
  @RequirePermissions(permissions.payrollRead)
  preview(@Query(new ZodValidationPipe(periodSchema)) query: z.infer<typeof periodSchema>) {
    return this.payroll.preview(query);
  }

  @Get(":id")
  @RequirePermissions(permissions.payrollRead)
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.payroll.get(id);
  }

  @Post()
  @RequirePermissions(permissions.payrollApprove)
  create(@Body(new ZodValidationPipe(createCycleSchema)) body: z.infer<typeof createCycleSchema>) {
    return this.payroll.createCycle(body);
  }

  /** Compute (or recompute) the cycle's lines from approved hours. */
  @Post(":id/run")
  @RequirePermissions(permissions.payrollApprove)
  run(@Param("id", ParseUUIDPipe) id: string) {
    return this.payroll.run(id);
  }

  @Post(":id/lock")
  @RequirePermissions(permissions.payrollApprove)
  lock(@Param("id", ParseUUIDPipe) id: string) {
    return this.payroll.lock(id);
  }

  @Post(":id/paid")
  @RequirePermissions(permissions.payrollApprove)
  markPaid(@Param("id", ParseUUIDPipe) id: string) {
    return this.payroll.markPaid(id);
  }
}
