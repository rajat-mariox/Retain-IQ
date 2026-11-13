import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { AdjustmentService } from "./adjustment.service.js";

const createSchema = z
  .object({
    employeeId: z.string().uuid(),
    originalRecordId: z.string().uuid().nullable().optional(),
    componentCode: z.string().max(60).nullable().optional(),
    adjustmentType: z.enum(["POSITIVE", "NEGATIVE", "ARREAR", "RECOVERY", "TAX_CORRECTION", "REVERSAL"]),
    previousValue: z.coerce.number().finite().nullable().optional(),
    correctedValue: z.coerce.number().finite().nullable().optional(),
    difference: z.coerce.number().finite().nullable().optional(),
    currencyCode: z.string().length(3).optional(),
    reason: z.string().min(3).max(2000),
    evidenceKey: z.string().max(500).nullable().optional(),
  })
  .refine((v) => v.difference != null || v.previousValue != null || v.correctedValue != null, {
    message: "Provide a difference, or previous/corrected values.",
  });
const noteSchema = z.object({ note: z.string().max(2000).optional() });
const settleSchema = z.object({ settlementBatchId: z.string().uuid() });

/** Payroll adjustments / corrections (§20). */
@Controller("payroll")
@RequireFeature("payroll")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class AdjustmentController {
  constructor(private readonly adjustments: AdjustmentService) {}

  /** Correction queue, scoped to the caller's reach. */
  @Get("adjustments")
  @RequirePermissions(permissions.payrollAdjustmentReview)
  list(@Query("status") status?: string, @Query("employeeId") employeeId?: string) {
    return this.adjustments.list({ status, employeeId });
  }

  @Get("adjustments/:id")
  @RequirePermissions(permissions.payrollAdjustmentReview)
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.adjustments.get(id);
  }

  /** Raise a correction against a (locked) payroll record. */
  @Post("adjustments")
  @HttpCode(201)
  @RequirePermissions(permissions.payrollAdjustmentCreate)
  create(@Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.adjustments.create({
      employeeId: body.employeeId,
      originalRecordId: body.originalRecordId ?? null,
      componentCode: body.componentCode ?? null,
      adjustmentType: body.adjustmentType,
      previousValue: body.previousValue ?? null,
      correctedValue: body.correctedValue ?? null,
      difference: body.difference ?? null,
      currencyCode: body.currencyCode,
      reason: body.reason,
      evidenceKey: body.evidenceKey ?? null,
    });
  }

  @Post("adjustments/:id/review")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollAdjustmentReview)
  review(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>) {
    return this.adjustments.review(id, body.note);
  }

  /** Approve a reviewed correction. The requester cannot approve their own (§15). */
  @Post("adjustments/:id/approve")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollAdjustmentApprove)
  approve(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>) {
    return this.adjustments.approve(id, body.note);
  }

  @Post("adjustments/:id/reject")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollAdjustmentReview)
  reject(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>) {
    return this.adjustments.reject(id, body.note);
  }

  /** Link the settlement batch that carries an approved correction. */
  @Post("adjustments/:id/settle")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollAdjustmentApprove)
  settle(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(settleSchema)) body: z.infer<typeof settleSchema>) {
    return this.adjustments.settle(id, body.settlementBatchId);
  }
}
