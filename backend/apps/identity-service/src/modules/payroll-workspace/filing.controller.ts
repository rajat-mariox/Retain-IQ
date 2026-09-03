import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PayrollFilingService } from "./filing.service.js";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const generateSchema = z
  .object({
    kind: z.enum(["FORM24Q", "FORM16", "PF_ECR", "ESI", "PT"]),
    periodStart: dateOnly,
    periodEnd: dateOnly,
    periodLabel: z.string().max(20).optional(),
    countryCode: z.string().length(2).optional(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: "periodEnd must be on or after periodStart.", path: ["periodEnd"] });

const submitSchema = z.object({ reference: z.string().max(140).optional() });
const rejectSchema = z.object({ reason: z.string().max(500).optional() });

/**
 * Statutory filing API (§14). Generate a return from finalized payroll, walk it
 * through prepare → approve (separation of duties) → submit, and export the
 * per-employee CSV. Gated by the payroll.filing.* permissions.
 */
@Controller("payroll/filings")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class PayrollFilingController {
  constructor(private readonly filings: PayrollFilingService) {}

  @Get()
  @RequirePermissions(permissions.payrollFilingRead)
  list(@Query("kind") kind?: string) {
    return this.filings.list(kind);
  }

  @Post("generate")
  @RequirePermissions(permissions.payrollFilingPrepare)
  generate(@Body(new ZodValidationPipe(generateSchema)) body: z.infer<typeof generateSchema>) {
    return this.filings.generate(body);
  }

  @Get(":id")
  @RequirePermissions(permissions.payrollFilingRead)
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.filings.get(id);
  }

  @Get(":id/export")
  @RequirePermissions(permissions.payrollFilingRead)
  exportCsv(@Param("id", ParseUUIDPipe) id: string) {
    return this.filings.exportCsv(id);
  }

  @Post(":id/approve")
  @RequirePermissions(permissions.payrollFilingApprove)
  approve(@Param("id", ParseUUIDPipe) id: string) {
    return this.filings.approve(id);
  }

  @Post(":id/submit")
  @RequirePermissions(permissions.payrollFilingSubmit)
  submit(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(submitSchema)) body: z.infer<typeof submitSchema>) {
    return this.filings.submit(id, body);
  }

  @Post(":id/reject")
  @RequirePermissions(permissions.payrollFilingReview)
  reject(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>) {
    return this.filings.reject(id, body);
  }
}
