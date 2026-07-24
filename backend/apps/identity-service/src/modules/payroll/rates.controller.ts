import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { RatesService } from "./rates.service.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Money is integer minor units (cents), matching billing-service's pricePerSeat.
// Capped at $100k/hour to catch a dollars-vs-cents mistake at the boundary.
const cents = z.coerce.number().int().min(0).max(10_000_000);

const setEmployeeRateSchema = z.object({
  costRateCents: cents,
  billRateCents: cents.nullable().optional(),
  effectiveFrom: date.optional(),
  note: z.string().max(300).optional(),
});
const setBillRateSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  employeeId: z.string().uuid().nullable().optional(),
  billRateCents: cents,
  effectiveFrom: date.optional(),
  note: z.string().max(300).optional(),
});
const previewSchema = z.object({
  employeeId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  on: date.optional(),
});
const settingsSchema = z
  .object({
    currency: z.string().length(3),
    overtimeAfterMins: z.coerce.number().int().min(0).max(10080),
    overtimeMultiplier: z.coerce.number().int().min(100).max(300),
    cycleFrequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]),
    invoicePrefix: z.string().min(1).max(10),
    requireApproval: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field." });

/**
 * Pay/bill rates — the foundation payroll calculations and client invoices are
 * computed from. Reading rates is payroll.read (Owner + Manager); changing them
 * is payroll.approve (Owner only), since a rate change moves money.
 */
@Controller("payroll/rates")
@RequireFeature("payroll")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  /** Rate history for one employee. */
  @Get("employees/:employeeId")
  @RequirePermissions(permissions.payrollRead)
  listEmployeeRates(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.rates.listEmployeeRates(employeeId);
  }

  /** Set an employee's cost rate from a date (supersedes the current one). */
  @Post("employees/:employeeId")
  @RequirePermissions(permissions.payrollApprove)
  setEmployeeRate(
    @Param("employeeId", ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(setEmployeeRateSchema)) body: z.infer<typeof setEmployeeRateSchema>,
  ) {
    return this.rates.setEmployeeRate({ employeeId, ...body });
  }

  /** Charge-out overrides, optionally filtered by client or project. */
  @Get("bill-rates")
  @RequirePermissions(permissions.payrollRead)
  listBillRates(@Query("clientId") clientId?: string, @Query("projectId") projectId?: string) {
    return this.rates.listBillRates({ clientId, projectId });
  }

  @Post("bill-rates")
  @RequirePermissions(permissions.payrollApprove)
  setBillRate(@Body(new ZodValidationPipe(setBillRateSchema)) body: z.infer<typeof setBillRateSchema>) {
    return this.rates.setBillRate(body);
  }

  /** What would this person, on this project, on this date, cost and bill — and why. */
  @Get("preview")
  @RequirePermissions(permissions.payrollRead)
  preview(@Query(new ZodValidationPipe(previewSchema)) query: z.infer<typeof previewSchema>) {
    return this.rates.preview(query);
  }

  @Get("settings")
  @RequirePermissions(permissions.payrollRead)
  getSettings() {
    return this.rates.getSettings();
  }

  @Patch("settings")
  @RequirePermissions(permissions.payrollApprove)
  updateSettings(@Body(new ZodValidationPipe(settingsSchema)) body: z.infer<typeof settingsSchema>) {
    return this.rates.updateSettings(body);
  }
}
