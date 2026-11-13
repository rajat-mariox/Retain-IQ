import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Patch, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { TaxConfigService } from "./tax-config.service.js";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const ruleSetSchema = z.object({
  countryCode: z.string().length(2),
  regime: z.string().max(20).optional(),
  taxYear: z.string().min(4).max(12),
  name: z.string().min(1).max(140),
  currencyCode: z.string().length(3).optional(),
  standardDeduction: z.coerce.number().nonnegative().optional(),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).optional(),
  rebateLimit: z.coerce.number().nonnegative().nullable().optional(),
  rebateMaxAmount: z.coerce.number().nonnegative().nullable().optional(),
  surchargePercent: z.coerce.number().nonnegative().max(100).optional(),
  cessPercent: z.coerce.number().nonnegative().max(100).optional(),
  effectiveFrom: dateOnly,
  source: z.string().max(300).nullable().optional(),
  slabs: z.array(z.object({ lowerBound: z.coerce.number().nonnegative(), upperBound: z.coerce.number().positive().nullable().optional(), ratePercent: z.coerce.number().nonnegative().max(100) })).min(1),
});

const statutorySchema = z.object({
  countryCode: z.string().length(2),
  kind: z.string().min(1).max(20),
  name: z.string().min(1).max(140),
  employeeRate: z.coerce.number().nonnegative().max(100).optional(),
  employerRate: z.coerce.number().nonnegative().max(100).optional(),
  wageCeiling: z.coerce.number().positive().nullable().optional(),
  applicableUpto: z.coerce.number().positive().nullable().optional(),
  flatAmount: z.coerce.number().nonnegative().nullable().optional(),
  baseComponents: z.array(z.string().max(40)).optional(),
  effectiveFrom: dateOnly,
  source: z.string().max(300).nullable().optional(),
});

const declarationSchema = z.object({
  taxYear: z.string().min(4).max(12),
  regime: z.string().max(20).optional(),
  exemptions: z.coerce.number().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Tax & statutory configuration API (§13). Rates/slabs are admin-entered DATA,
 * effective-dated + versioned; the engine only ever reads them. Gated by the
 * reserved payroll.tax.* / payroll.statutory.* permissions.
 */
@Controller("payroll")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class TaxConfigController {
  constructor(private readonly config: TaxConfigService) {}

  /** Org opt-in: is the tax + statutory flow turned on for this org? */
  @Get("tax/settings")
  @RequirePermissions(permissions.payrollTaxRead)
  getSettings() {
    return this.config.getSettings();
  }

  /** Owner setting: enable/disable the whole tax + statutory flow for the org. */
  @Patch("tax/settings")
  @RequirePermissions(permissions.payrollTaxConfigure)
  setSettings(@Body(new ZodValidationPipe(z.object({ taxEnabled: z.boolean() }))) body: { taxEnabled: boolean }) {
    return this.config.setTaxEnabled(body.taxEnabled);
  }

  @Get("tax/rule-sets")
  @RequirePermissions(permissions.payrollTaxRead)
  listRuleSets(@Query("countryCode") countryCode?: string, @Query("regime") regime?: string) {
    return this.config.listRuleSets({ countryCode, regime });
  }

  @Post("tax/rule-sets")
  @RequirePermissions(permissions.payrollTaxConfigure)
  createRuleSet(@Body(new ZodValidationPipe(ruleSetSchema)) body: z.infer<typeof ruleSetSchema>) {
    return this.config.createRuleSet(body);
  }

  @Post("tax/rule-sets/:id/archive")
  @RequirePermissions(permissions.payrollTaxConfigure)
  archiveRuleSet(@Param("id", ParseUUIDPipe) id: string) {
    return this.config.archiveRuleSet(id);
  }

  @Get("statutory/rules")
  @RequirePermissions(permissions.payrollStatutoryRead)
  listStatutory(@Query("countryCode") countryCode?: string) {
    return this.config.listStatutory({ countryCode });
  }

  @Post("statutory/rules")
  @RequirePermissions(permissions.payrollStatutoryConfigure)
  createStatutory(@Body(new ZodValidationPipe(statutorySchema)) body: z.infer<typeof statutorySchema>) {
    return this.config.createStatutory(body);
  }

  @Get("tax/employees/:employeeId/declaration")
  @RequirePermissions(permissions.payrollTaxRead)
  getDeclaration(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Query("taxYear") taxYear: string) {
    return this.config.getDeclaration(employeeId, taxYear);
  }

  @Patch("tax/employees/:employeeId/declaration")
  @RequirePermissions(permissions.payrollTaxConfigure)
  upsertDeclaration(@Param("employeeId", ParseUUIDPipe) employeeId: string, @Body(new ZodValidationPipe(declarationSchema)) body: z.infer<typeof declarationSchema>) {
    return this.config.upsertDeclaration({ employeeId, ...body });
  }
}
