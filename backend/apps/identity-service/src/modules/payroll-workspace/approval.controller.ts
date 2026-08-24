import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PayrollApprovalService } from "./approval.service.js";

const approveSchema = z.object({
  stepIndex: z.coerce.number().int().min(0).max(50).optional(),
  comment: z.string().max(1000).optional(),
});
const rejectSchema = z.object({ comment: z.string().max(1000).optional() });
const holdSchema = z.object({
  reason: z.string().min(3).max(1000),
  expectedResolution: z.string().max(500).optional(),
});
const releaseSchema = z.object({ comment: z.string().max(1000).optional() });

/**
 * Maker-checker approval endpoints for a payroll batch (§15, §16). The class-level
 * guards authenticate + resolve the tenant and enforce each route's permission; the
 * service enforces separation of duties (a batch's creator cannot approve it).
 */
@Controller()
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class PayrollApprovalController {
  constructor(private readonly approvals: PayrollApprovalService) {}

  /** The batch's approval chain + hold history. */
  @Get("payroll/batches/:id/approvals")
  @RequirePermissions(permissions.payrollBatchRead)
  chain(@Param("id", ParseUUIDPipe) id: string) {
    return this.approvals.getApprovalChain(id);
  }

  /** Open the workflow: build the chain and move the batch to PENDING_APPROVAL. */
  @Post("payroll/batches/:id/submit")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollBatchSubmit)
  submit(@Param("id", ParseUUIDPipe) id: string) {
    return this.approvals.submitForApproval(id);
  }

  @Post("payroll/batches/:id/approve")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollBatchApprove)
  approve(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(approveSchema)) body: z.infer<typeof approveSchema>) {
    return this.approvals.approve(id, body);
  }

  @Post("payroll/batches/:id/reject")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollBatchReject)
  reject(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>) {
    return this.approvals.reject(id, body);
  }

  @Post("payroll/batches/:id/hold")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollBatchHold)
  hold(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(holdSchema)) body: z.infer<typeof holdSchema>) {
    return this.approvals.hold(id, body);
  }

  @Post("payroll/batches/:id/release")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollBatchRelease)
  release(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(releaseSchema)) body: z.infer<typeof releaseSchema>) {
    return this.approvals.release(id, body);
  }
}
