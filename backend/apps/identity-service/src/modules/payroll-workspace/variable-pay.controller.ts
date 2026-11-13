import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { VariablePayStatus } from "@retainiq/database/identity";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { VariablePayService } from "./variable-pay.service.js";

const statusValues = [
  "DRAFT",
  "MANAGER_APPROVAL",
  "REVIEW",
  "APPROVED",
  "INCLUDED_IN_PAYROLL",
  "REJECTED",
  "CANCELLED",
] as const;

const listQuerySchema = z.object({
  status: z.enum(statusValues).optional(),
  employeeId: z.string().uuid().optional(),
});

const bonusSchema = z.object({
  employeeId: z.string().uuid(),
  bonusType: z.enum(["ONE_TIME", "PERFORMANCE", "FESTIVAL", "RETENTION", "REFERRAL", "SALES", "CUSTOM"]),
  amount: z.coerce.number().positive().max(100_000_000),
  currencyCode: z.string().length(3).optional(),
  reason: z.string().max(500).optional(),
  sourceType: z.string().max(60).optional(),
  sourceRef: z.string().max(200).optional(),
  periodId: z.string().uuid().optional(),
});

const incentiveSchema = z.object({
  employeeId: z.string().uuid(),
  incentiveType: z.string().min(2).max(60),
  amount: z.coerce.number().positive().max(100_000_000),
  currencyCode: z.string().length(3).optional(),
  sourceType: z.string().max(60).optional(),
  sourceRef: z.string().max(200).optional(),
  periodId: z.string().uuid().optional(),
});

const reimbursementSchema = z.object({
  employeeId: z.string().uuid(),
  category: z.enum(["TRAVEL", "FOOD", "EQUIPMENT", "CUSTOM"]),
  claimedAmount: z.coerce.number().positive().max(100_000_000),
  currencyCode: z.string().length(3).optional(),
  taxable: z.boolean().optional(),
  sourceType: z.string().max(60).optional(),
  sourceRef: z.string().max(200).optional(),
  receiptKey: z.string().max(500).optional(),
  periodId: z.string().uuid().optional(),
});

/** Advance one step in the chain. `batchId` is required only for the final step into payroll. */
const approveSchema = z.object({
  batchId: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
});
/** Same, plus the finance-capped approved amount for reimbursements. */
const approveReimbursementSchema = approveSchema.extend({
  approvedAmount: z.coerce.number().min(0).max(100_000_000).optional(),
});
const rejectSchema = z.object({ note: z.string().max(500).optional() });

/**
 * Variable pay — bonuses, incentives, reimbursements (§13).
 *
 * Reads require payroll.record.read (scoped to the caller's reach by the service).
 * Raising a request requires payroll.record.update; advancing an approval step
 * requires payroll.variable_pay.approve. The service additionally enforces
 * separation of duties (a requester cannot approve their own request) and the
 * no-double-include rule regardless of permissions.
 */
@Controller("payroll")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class VariablePayController {
  constructor(private readonly variablePay: VariablePayService) {}

  // ---- Bonuses ----

  @Get("bonuses")
  @RequirePermissions(permissions.payrollRecordRead)
  listBonuses(@Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    return this.variablePay.listBonuses({ status: q.status as VariablePayStatus | undefined, employeeId: q.employeeId });
  }

  @Post("bonuses")
  @RequirePermissions(permissions.payrollRecordUpdate)
  createBonus(@Body(new ZodValidationPipe(bonusSchema)) body: z.infer<typeof bonusSchema>) {
    return this.variablePay.createBonus(body);
  }

  @Post("bonuses/:id/approve")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollVariablePayApprove)
  approveBonus(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(approveSchema)) body: z.infer<typeof approveSchema>) {
    return this.variablePay.approveBonus(id, body);
  }

  @Post("bonuses/:id/reject")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollVariablePayApprove)
  rejectBonus(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>) {
    return this.variablePay.rejectBonus(id, body.note);
  }

  @Post("bonuses/:id/cancel")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollRecordUpdate)
  cancelBonus(@Param("id", ParseUUIDPipe) id: string) {
    return this.variablePay.cancelBonus(id);
  }

  // ---- Incentives ----

  @Get("incentives")
  @RequirePermissions(permissions.payrollRecordRead)
  listIncentives(@Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    return this.variablePay.listIncentives({ status: q.status as VariablePayStatus | undefined, employeeId: q.employeeId });
  }

  @Post("incentives")
  @RequirePermissions(permissions.payrollRecordUpdate)
  createIncentive(@Body(new ZodValidationPipe(incentiveSchema)) body: z.infer<typeof incentiveSchema>) {
    return this.variablePay.createIncentive(body);
  }

  @Post("incentives/:id/approve")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollVariablePayApprove)
  approveIncentive(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(approveSchema)) body: z.infer<typeof approveSchema>) {
    return this.variablePay.approveIncentive(id, body);
  }

  @Post("incentives/:id/reject")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollVariablePayApprove)
  rejectIncentive(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>) {
    return this.variablePay.rejectIncentive(id, body.note);
  }

  @Post("incentives/:id/cancel")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollRecordUpdate)
  cancelIncentive(@Param("id", ParseUUIDPipe) id: string) {
    return this.variablePay.cancelIncentive(id);
  }

  // ---- Reimbursements ----

  @Get("reimbursements")
  @RequirePermissions(permissions.payrollRecordRead)
  listReimbursements(@Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    return this.variablePay.listReimbursements({ status: q.status as VariablePayStatus | undefined, employeeId: q.employeeId });
  }

  @Post("reimbursements")
  @RequirePermissions(permissions.payrollRecordUpdate)
  createReimbursement(@Body(new ZodValidationPipe(reimbursementSchema)) body: z.infer<typeof reimbursementSchema>) {
    return this.variablePay.createReimbursement(body);
  }

  @Post("reimbursements/:id/approve")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollVariablePayApprove)
  approveReimbursement(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(approveReimbursementSchema)) body: z.infer<typeof approveReimbursementSchema>,
  ) {
    return this.variablePay.approveReimbursement(id, body);
  }

  @Post("reimbursements/:id/reject")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollVariablePayApprove)
  rejectReimbursement(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>) {
    return this.variablePay.rejectReimbursement(id, body.note);
  }

  @Post("reimbursements/:id/cancel")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollRecordUpdate)
  cancelReimbursement(@Param("id", ParseUUIDPipe) id: string) {
    return this.variablePay.cancelReimbursement(id);
  }
}
