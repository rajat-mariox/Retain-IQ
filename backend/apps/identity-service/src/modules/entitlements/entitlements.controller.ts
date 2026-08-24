import { Controller, Get, UseGuards } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { EntitlementService } from "../../common/entitlement/entitlement.service.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";

/**
 * Org-facing entitlements: what THIS org may use and how much. The single call a
 * client makes to learn its feature access + limits, rather than inferring them
 * from the plan name. Any authenticated org member may read their own org's
 * entitlements (no special permission — it only reveals what's already enforced).
 */
@Controller("entitlements")
@UseGuards(AuthGuard, TenantGuard)
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementService) {}

  @Get()
  get() {
    const ctx = requireTenantContext();
    return this.entitlements.getEntitlements(ctx.orgId);
  }
}
