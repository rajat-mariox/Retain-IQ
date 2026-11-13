import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { z } from "zod";
import { RequirePermissions } from "../decorators/permissions.decorator.js";
import { AuthGuard } from "../guards/auth.guard.js";
import { PermissionGuard } from "../guards/permission.guard.js";
import { TenantGuard } from "../guards/tenant.guard.js";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { ProductivitySettingsService } from "./productivity-settings.service.js";

const list = z.array(z.string().min(1).max(120)).max(500);
const updateRulesSchema = z
  .object({
    productiveApps: list,
    productiveDomains: list,
    distractingApps: list,
    distractingDomains: list,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one list to update." });

@Controller("productivity")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class ProductivityController {
  constructor(private readonly settings: ProductivitySettingsService) {}

  /** Current productivity rules (defaults until customized) — admin view. */
  @Get("rules")
  @RequirePermissions(permissions.employeeRead)
  getRules() {
    return this.settings.getSettings();
  }

  @Patch("rules")
  @RequirePermissions(permissions.employeeWrite)
  updateRules(@Body(new ZodValidationPipe(updateRulesSchema)) body: z.infer<typeof updateRulesSchema>) {
    return this.settings.updateSettings(body);
  }
}
