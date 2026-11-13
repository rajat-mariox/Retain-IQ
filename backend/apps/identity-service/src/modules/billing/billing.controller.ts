import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { BillingService } from "./billing.service.js";

// Mirror of billing-service's own accepted fields — an org may change its plan,
// its seat count, or auto-renew. At least one must be present.
const changeSubscriptionSchema = z
  .object({
    planId: z.string().min(1).max(40).optional(),
    seats: z.coerce.number().int().min(1).max(100000).optional(),
    autoRenew: z.boolean().optional(),
  })
  .refine((v) => v.planId !== undefined || v.seats !== undefined || v.autoRenew !== undefined, {
    message: "Choose a plan or a seat count to change.",
  });

/** Org-facing billing: the tenant views and self-serve-upgrades its own subscription. */
@Controller("billing")
@RequireFeature("billing")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePermissions(permissions.billingManage)
  getBilling() {
    return this.billing.getOrgBilling();
  }

  /** Submit a plan/seat change (held for platform approval; auto-renew applies now). */
  @Patch("subscription")
  @RequirePermissions(permissions.billingManage)
  changeSubscription(@Body(new ZodValidationPipe(changeSubscriptionSchema)) body: z.infer<typeof changeSubscriptionSchema>) {
    return this.billing.changeSubscription(body);
  }

  /** Withdraw this org's own pending change request. */
  @Post("change-request/:id/cancel")
  @RequirePermissions(permissions.billingManage)
  cancelChangeRequest(@Param("id", ParseUUIDPipe) id: string) {
    return this.billing.cancelChangeRequest(id);
  }
}
