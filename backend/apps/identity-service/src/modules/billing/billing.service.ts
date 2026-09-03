import { BadGatewayException, HttpException, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { loadConfig } from "@retainiq/config";
import { computePrice, effectivePricing, planPricingOf } from "@retainiq/contracts";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { BillingReadPrismaService } from "../../common/database/billing-prisma.service.js";

const config = loadConfig();

/** What an org may change about its own subscription (self-serve upgrade). */
export interface SubscriptionChange {
  planId?: string;
  seats?: number;
  autoRenew?: boolean;
}

/**
 * Org-facing billing. Reads come straight from billing-db (BillingReadPrismaService,
 * read-only). WRITES are NOT done here — billing-service owns the billing data — so
 * an org-initiated plan/seat change is forwarded to billing-service's plan-admin API
 * over HTTP, authenticated with a short-lived platform-scoped service token. The
 * org can only ever change its OWN subscription: the orgId comes from tenant context,
 * never from the client.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly billing: BillingReadPrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Mint a short-lived platform-scoped service token for the billing-service call.
   *  billing-service's guard only checks `scope === "platform"`; never leaves the cluster. */
  private async serviceToken(): Promise<string> {
    return this.jwt.signAsync(
      { sub: "identity-service", scope: "platform", role: "service", name: "identity-service", jti: randomUUID() },
      { secret: config.PLATFORM_JWT_SECRET, expiresIn: 60 },
    );
  }

  /**
   * Submit an org's own plan/seat change. A seat or plan change is HELD for platform
   * approval — billing-service returns `{requested:true, request}` and nothing is
   * applied until a super-admin approves. An auto-renew-only change (no seat/plan
   * movement) needs no approval and is applied immediately (`{applied:true, ...}`).
   * The org can only change its OWN subscription — orgId comes from tenant context.
   */
  async changeSubscription(change: SubscriptionChange) {
    const ctx = requireTenantContext();
    const token = await this.serviceToken();
    let res: Response;
    try {
      res = await fetch(`${config.BILLING_API_URL}/v1/admin/orgs/${ctx.orgId}/change-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...change, requestedByUserId: ctx.userId }),
      });
    } catch {
      throw new BadGatewayException("Billing service is unavailable. Please try again in a moment.");
    }
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) {
      // Surface billing-service's own reason (e.g. "Basic allows at most 50 seats.")
      throw new HttpException(data.message ?? "Could not submit the change.", res.status);
    }
    return data;
  }

  /** Withdraw the org's own pending change request. */
  async cancelChangeRequest(id: string) {
    const ctx = requireTenantContext();
    const token = await this.serviceToken();
    let res: Response;
    try {
      res = await fetch(`${config.BILLING_API_URL}/v1/admin/orgs/${ctx.orgId}/change-requests/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new BadGatewayException("Billing service is unavailable. Please try again in a moment.");
    }
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) throw new HttpException(data.message ?? "Could not cancel the request.", res.status);
    return data;
  }

  /** The calling org's subscription (with plan) + recent invoices. Amounts in USD cents. */
  async getOrgBilling() {
    const ctx = requireTenantContext();
    const [subscription, invoices, plans, pendingChange] = await Promise.all([
      this.billing.subscription.findUnique({ where: { orgId: ctx.orgId }, include: { plan: true } }),
      this.billing.invoice.findMany({ where: { orgId: ctx.orgId }, orderBy: { issuedAt: "desc" }, take: 12 }),
      this.billing.plan.findMany({ orderBy: { sortOrder: "asc" } }),
      this.billing.subscriptionChangeRequest.findFirst({ where: { orgId: ctx.orgId, status: "PENDING" }, orderBy: { createdAt: "desc" } }),
    ]);

    const subPricing = subscription
      ? effectivePricing(
          {
            basePrice: subscription.lockedBasePrice ?? undefined,
            includedSeats: subscription.lockedIncludedSeats ?? undefined,
            additionalSeatPrice: subscription.lockedAdditionalSeatPrice ?? undefined,
          },
          planPricingOf(subscription.plan),
        )
      : null;

    return {
      subscription: subscription && subPricing
        ? {
            planId: subscription.planId,
            planName: subscription.plan.name,
            pricePerSeat: subscription.plan.pricePerSeat,
            status: subscription.status,
            seats: subscription.seats,
            activeSeats: subscription.activeSeats,
            seatLimit: subscription.plan.seatLimit,
            // Locked commercial terms (historical rate this org actually pays).
            basePrice: subPricing.basePrice,
            includedSeats: subPricing.includedSeats,
            additionalSeatPrice: subPricing.additionalSeatPrice,
            lockedTotalPrice: subscription.lockedTotalPrice ?? computePrice(subPricing, subscription.seats).totalPrice,
            currentPeriodStart: subscription.currentPeriodStart.toISOString(),
            currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
            trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
            // Whole days left on a trial (0 if past / not trialing); the UI shows "N days left".
            trialDaysRemaining:
              subscription.status === "TRIALING" && subscription.trialEndsAt
                ? Math.max(0, Math.ceil((subscription.trialEndsAt.getTime() - Date.now()) / 86_400_000))
                : null,
            autoRenew: subscription.autoRenew,
            // MRR bills on active seats at the locked rate.
            mrr: computePrice(subPricing, subscription.activeSeats).totalPrice,
          }
        : null,
      // A seat/plan change the org has submitted that is awaiting platform approval.
      pendingChangeRequest: pendingChange
        ? {
            id: pendingChange.id,
            fromPlanId: pendingChange.fromPlanId,
            toPlanId: pendingChange.toPlanId,
            fromSeats: pendingChange.fromSeats,
            toSeats: pendingChange.toSeats,
            estimatedTotalPrice: pendingChange.estimatedTotalPrice,
            estimatedDeltaPrice: pendingChange.estimatedDeltaPrice,
            status: pendingChange.status,
            createdAt: pendingChange.createdAt.toISOString(),
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
      // Catalog so the UI can show upgrade options + compute seat-based pricing.
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        pricePerSeat: p.pricePerSeat,
        seatLimit: p.seatLimit,
        basePrice: p.basePrice,
        includedSeats: p.includedSeats,
        additionalSeatPrice: p.additionalSeatPrice,
        minSeats: p.minSeats,
        maxSeats: p.maxSeats,
        allowCustomSeats: p.allowCustomSeats,
        features: p.features,
        color: p.color,
      })),
    };
  }
}
