import { Controller, Get, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { BillingService } from "./billing.service.js";

/** Org-facing billing: the tenant views its own subscription + invoices. */
@Controller("billing")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePermissions(permissions.billingManage)
  getBilling() {
    return this.billing.getOrgBilling();
  }
}
