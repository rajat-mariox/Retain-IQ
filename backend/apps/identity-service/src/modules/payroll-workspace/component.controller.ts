import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PayrollComponentService } from "./component.service.js";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const directionEnum = z.enum(["EARNING", "DEDUCTION"]);
const calcTypeEnum = z.enum(["FIXED", "PERCENTAGE", "FORMULA", "INPUT_BASED", "PER_UNIT"]);
const statusEnum = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);

// A component's config is free-form JSON (fixed amount, percentage-of, formula
// expression, input key). The service validates FORMULA configs against a safe grammar.
const configSchema = z.record(z.unknown());

const versionFields = {
  category: z.string().min(1).max(40),
  direction: directionEnum,
  calcType: calcTypeEnum,
  config: configSchema.optional(),
  countryCode: z.string().max(2).nullable().optional(),
  legalEntityId: z.string().uuid().nullable().optional(),
  currencyCode: z.string().length(3).nullable().optional(),
  taxable: z.boolean().optional(),
  statutory: z.boolean().optional(),
  employerPaid: z.boolean().optional(),
  proratable: z.boolean().optional(),
  minAmount: z.coerce.number().nonnegative().nullable().optional(),
  maxAmount: z.coerce.number().nonnegative().nullable().optional(),
  rounding: z.string().max(20).optional(),
  payslipVisible: z.boolean().optional(),
  effectiveFrom: dateOnly,
  status: statusEnum.optional(),
};

const createComponentSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  ...versionFields,
});

const addVersionSchema = z.object(versionFields);

@Controller("payroll")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class PayrollComponentController {
  constructor(private readonly components: PayrollComponentService) {}

  @Get("components")
  @RequirePermissions(permissions.payrollComponentRead)
  listComponents(@Query("includeArchived") includeArchived?: string) {
    return this.components.listComponents({ includeArchived: includeArchived === "true" });
  }

  @Get("components/:id")
  @RequirePermissions(permissions.payrollComponentRead)
  getComponent(@Param("id", ParseUUIDPipe) id: string) {
    return this.components.getComponent(id);
  }

  @Post("components")
  @RequirePermissions(permissions.payrollComponentManage)
  createComponent(@Body(new ZodValidationPipe(createComponentSchema)) body: z.infer<typeof createComponentSchema>) {
    return this.components.createComponent(body);
  }

  @Post("components/:id/versions")
  @RequirePermissions(permissions.payrollComponentManage)
  addVersion(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addVersionSchema)) body: z.infer<typeof addVersionSchema>,
  ) {
    return this.components.addVersion(id, body);
  }

  @Post("components/:id/archive")
  @RequirePermissions(permissions.payrollComponentManage)
  archiveComponent(@Param("id", ParseUUIDPipe) id: string) {
    return this.components.archiveComponent(id);
  }
}
