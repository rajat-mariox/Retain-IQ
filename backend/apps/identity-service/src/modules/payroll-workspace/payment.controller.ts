import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PaymentService } from "./payment.service.js";

const processSchema = z.object({ batchId: z.string().uuid() });
const markPaidSchema = z.object({
  paymentDate: z.string().datetime().optional(),
  // Money as a string keeps decimal precision; a number is accepted for convenience.
  amount: z.union([z.number(), z.string()]).optional(),
  method: z.enum(["BANK_TRANSFER", "UPI", "CHEQUE", "CASH", "PROVIDER"]),
  reference: z.string().max(140).optional(),
});
const failSchema = z.object({ error: z.string().max(500).optional() });
const proofSchema = z.object({
  kind: z.enum(["RECEIPT", "BANK_RESPONSE", "ATTACHMENT"]),
  storageKey: z.string().min(1).max(1024),
  checksum: z.string().max(128).optional(),
});

/**
 * Payout endpoints (§16, §17). Reads are scoped + bank references masked in the
 * service; every mutating route carries its own payroll.payment.* permission.
 */
@Controller()
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class PayrollPaymentController {
  constructor(private readonly payments: PaymentService) {}

  /** List payments (optionally by batch/status), scoped to the caller's reach. */
  @Get("payroll/payments")
  @RequirePermissions(permissions.payrollPaymentRead)
  list(@Query("batchId") batchId?: string, @Query("status") status?: string) {
    return this.payments.listPayments({ batchId, status });
  }

  /** One payment with its attempts + proofs. */
  @Get("payroll/payments/:id")
  @RequirePermissions(permissions.payrollPaymentRead)
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.payments.getPayment(id);
  }

  /** Open a payment per approved record in a batch (idempotent). */
  @Post("payroll/payments")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollPaymentProcess)
  process(@Body(new ZodValidationPipe(processSchema)) body: z.infer<typeof processSchema>) {
    return this.payments.processBatch(body.batchId);
  }

  /** Mark a record's payout as paid (records a settlement attempt). */
  @Post("payroll/records/:id/mark-paid")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollPaymentMarkPaid)
  markPaid(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(markPaidSchema)) body: z.infer<typeof markPaidSchema>) {
    return this.payments.markPaid(id, body);
  }

  /** Record a failed settlement on a payment (enables retry). */
  @Post("payroll/payments/:id/fail")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollPaymentProcess)
  fail(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(failSchema)) body: z.infer<typeof failSchema>) {
    return this.payments.markFailed(id, body);
  }

  /** Retry a FAILED payment. */
  @Post("payroll/payments/:id/retry")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollPaymentRetry)
  retry(@Param("id", ParseUUIDPipe) id: string) {
    return this.payments.retry(id);
  }

  /** Attach a proof document (receipt / bank response) to a payment. */
  @Post("payroll/payments/:id/proof")
  @HttpCode(200)
  @RequirePermissions(permissions.payrollPaymentProofUpload)
  uploadProof(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(proofSchema)) body: z.infer<typeof proofSchema>) {
    return this.payments.uploadProof(id, body);
  }
}
