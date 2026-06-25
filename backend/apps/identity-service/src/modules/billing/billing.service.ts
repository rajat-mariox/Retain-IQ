import { Injectable } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { BillingReadPrismaService } from "../../common/database/billing-prisma.service.js";

/**
 * Org-facing billing READS. billing-service owns the data and the plan catalog;
 * identity only reads billing-db (BillingReadPrismaService) to render the tenant
 * Billing screen.
 */
@Injectable()
export class BillingService {
  constructor(private readonly billing: BillingReadPrismaService) {}

  /** The calling org's subscription (with plan) + recent invoices. Amounts in USD cents. */
  async getOrgBilling() {
    const ctx = requireTenantContext();
    const [subscription, invoices, plans] = await Promise.all([
      this.billing.subscription.findUnique({ where: { orgId: ctx.orgId }, include: { plan: true } }),
      this.billing.invoice.findMany({ where: { orgId: ctx.orgId }, orderBy: { issuedAt: "desc" }, take: 12 }),
      this.billing.plan.findMany({ orderBy: { sortOrder: "asc" } }),
    ]);

    return {
      subscription: subscription
        ? {
            planId: subscription.planId,
            planName: subscription.plan.name,
            pricePerSeat: subscription.plan.pricePerSeat,
            status: subscription.status,
            seats: subscription.seats,
            activeSeats: subscription.activeSeats,
            seatLimit: subscription.plan.seatLimit,
            currentPeriodStart: subscription.currentPeriodStart.toISOString(),
            currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
            trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
            autoRenew: subscription.autoRenew,
            mrr: subscription.activeSeats * subscription.plan.pricePerSeat,
          }
        : null,
      invoices: invoices.map((i) => ({
        invoiceNumber: i.invoiceNumber,
        status: i.status,
        issuedAt: i.issuedAt.toISOString(),
        dueAt: i.dueAt.toISOString(),
        paidAt: i.paidAt?.toISOString() ?? null,
        periodStart: i.periodStart.toISOString(),
        periodEnd: i.periodEnd.toISOString(),
        totalAmount: i.totalAmount,
        amountDue: i.amountDue,
        currency: i.currency,
      })),
      // Catalog so the UI can show upgrade options.
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        pricePerSeat: p.pricePerSeat,
        seatLimit: p.seatLimit,
        features: p.features,
        color: p.color,
      })),
    };
  }
}
