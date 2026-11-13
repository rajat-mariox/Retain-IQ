import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PayrollProfileService } from "./profile.service.js";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const frequencyEnum = z.enum(["MONTHLY", "WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "DAILY", "CUSTOM"]);
const paymentBasisEnum = z.enum(["FIXED", "HOURLY", "DAILY"]);

const setProfileSchema = z.object({
  employeeId: z.string().uuid(),
  baseAmount: z.coerce.number().nonnegative(),
  effectiveFrom: dateOnly,
  currencyCode: z.string().length(3).optional(),
  payFrequency: frequencyEnum.optional(),
  paymentBasis: paymentBasisEnum.optional(),
  legalEntityId: z.string().uuid().nullable().optional(),
  payrollEntityId: z.string().uuid().nullable().optional(),
  workCountry: z.string().max(2).nullable().optional(),
  payrollCountry: z.string().max(2).nullable().optional(),
  taxResidencyCountry: z.string().max(2).nullable().optional(),
  calendarId: z.string().uuid().nullable().optional(),
  taxRegime: z.string().max(60).nullable().optional(),
  prorationPolicy: z.string().max(30).optional(),
  overtimePolicyMode: z.string().max(30).optional(),
  compOffPolicy: z.record(z.unknown()).nullable().optional(),
  bankRef: z.string().max(200).nullable().optional(),
  joinDate: dateOnly.nullable().optional(),
  exitDate: dateOnly.nullable().optional(),
});

@Controller("payroll")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class PayrollProfileController {
  constructor(private readonly profiles: PayrollProfileService) {}

  /** Payroll profiles for every employee within the caller's reach (ABAC-scoped). */
  @Get("profiles")
  @RequirePermissions(permissions.payrollProfileRead)
  list() {
    return this.profiles.list();
  }

  /**
   * Reachable employees for the workspace's pickers, with the Owner filtered out
   * (the Owner is not payroll staff). Names only — no compensation.
   */
  @Get("directory")
  @RequirePermissions(permissions.payrollProfileRead)
  directory() {
    return this.profiles.directory();
  }

  /**
   * Open the next effective-dated version of an employee's payroll profile.
   * Gated on payrollProfileCreate; revising an existing profile additionally
   * requires payrollProfileUpdate (enforced in the service).
   */
  @Post("profiles")
  @RequirePermissions(permissions.payrollProfileCreate)
  setProfile(@Body(new ZodValidationPipe(setProfileSchema)) body: z.infer<typeof setProfileSchema>) {
    return this.profiles.setProfile(body);
  }

  /** The profile version in force for an employee on ?on=YYYY-MM-DD (default today). */
  @Get("profiles/:employeeId")
  @RequirePermissions(permissions.payrollProfileRead)
  resolveProfile(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Query("on") on?: string) {
    return this.profiles.resolveProfile(employeeId, on);
  }

  /** Full version history (salary history) for an employee, newest first. */
  @Get("profiles/:employeeId/salary-history")
  @RequirePermissions(permissions.payrollProfileRead)
  salaryHistory(@Param("employeeId", ParseUUIDPipe) employeeId: string) {
    return this.profiles.salaryHistory(employeeId);
  }
}
