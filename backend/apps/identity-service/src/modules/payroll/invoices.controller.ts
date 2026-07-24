import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { InvoicesService } from "./invoices.service.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const previewSchema = z.object({ clientId: z.string().uuid(), periodStart: date, periodEnd: date });
const generateSchema = previewSchema.extend({
  dueInDays: z.coerce.number().int().min(0).max(365).optional(),
  note: z.string().max(500).optional(),
});

/**
 * Client invoices — the org billing its own customers for billable hours.
 * Reading is payroll.read; issuing/voiding is payroll.approve, since an issued
 * invoice is a financial claim.
 */
@Controller("payroll/invoices")
@RequireFeature("payroll")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermissions(permissions.payrollRead)
  list(@Query("status") status?: string, @Query("clientId") clientId?: string) {
    return this.invoices.list({ status, clientId });
  }

  /** What would this client be invoiced for this period — before committing. */
  @Get("preview")
  @RequirePermissions(permissions.payrollRead)
  preview(@Query(new ZodValidationPipe(previewSchema)) query: z.infer<typeof previewSchema>) {
    return this.invoices.preview(query);
  }

  @Get(":id")
  @RequirePermissions(permissions.payrollRead)
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.invoices.get(id);
  }

  @Post()
  @RequirePermissions(permissions.payrollApprove)
  generate(@Body(new ZodValidationPipe(generateSchema)) body: z.infer<typeof generateSchema>) {
    return this.invoices.generate(body);
  }

  @Post(":id/send")
  @RequirePermissions(permissions.payrollApprove)
  send(@Param("id", ParseUUIDPipe) id: string) {
    return this.invoices.send(id);
  }

  @Post(":id/paid")
  @RequirePermissions(permissions.payrollApprove)
  markPaid(@Param("id", ParseUUIDPipe) id: string) {
    return this.invoices.markPaid(id);
  }

  @Post(":id/void")
  @RequirePermissions(permissions.payrollApprove)
  voidInvoice(@Param("id", ParseUUIDPipe) id: string) {
    return this.invoices.voidInvoice(id);
  }
}
