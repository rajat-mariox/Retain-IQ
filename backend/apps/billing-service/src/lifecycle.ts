import type { PrismaClient } from "@retainiq/database/billing";
import type { Logger } from "@retainiq/observability";
import { computePrice, effectivePricing, planPricingOf } from "@retainiq/contracts";

const DAY_MS = 86_400_000;
const GRACE_DAYS = 14; // PAST_DUE this long past an invoice due date -> SUSPENDED
const INVOICE_DUE_DAYS = 7;

function addPeriod(d: Date, billingPeriod: string): Date {
  const n = new Date(d);
  if (billingPeriod === "yearly") n.setUTCFullYear(n.getUTCFullYear() + 1);
  else n.setUTCMonth(n.getUTCMonth() + 1);
  return n;
}

export interface CycleStats {
  scanned: number;
  renewed: number;
  paymentsFailed: number;
  canceled: number;
  suspended: number;
}

/**
 * Recurring-billing lifecycle pass. Drives subscriptions forward in time:
 *   - period ended + autoRenew  -> renew (advance period, issue invoice, charge)
 *   - period ended + no renew    -> cancel (expired)
 *   - PAST_DUE past the grace    -> suspend (dunning escalation)
 * Emits domain events (subscription.renewed / payment.failed / .canceled /
 * .suspended) so the platform activity feed can show them. Idempotent: a renewed
 * subscription's period moves to the future, so re-runs are no-ops.
 *
 * Payment is SIMULATED (no gateway yet): `chargeSucceeds` is the single Stripe
 * integration point — swap it for a real charge when payments go live.
 */
export async function runBillingCycle(opts: {
  prisma: PrismaClient;
  logger: Logger;
  paymentFailureRate: number;
}): Promise<CycleStats> {
  const { prisma, logger, paymentFailureRate } = opts;
  const now = new Date();
  const stats: CycleStats = { scanned: 0, renewed: 0, paymentsFailed: 0, canceled: 0, suspended: 0 };

  // Record lifecycle events for the platform activity feed (read by identity).
  const emit = (type: string, orgId: string, summary: string, extra?: { planId?: string; amountCents?: number }) =>
    prisma.billingEvent.create({ data: { orgId, type, summary, planId: extra?.planId ?? null, amountCents: extra?.amountCents ?? null } });

  // Stripe integration point. Until a real gateway exists, simulate a charge.
  const chargeSucceeds = () => Math.random() >= paymentFailureRate;

  const subs = await prisma.subscription.findMany({ include: { plan: true } });
  for (const sub of subs) {
    stats.scanned += 1;
    if (sub.status === "CANCELED") continue;

    // 1) Dunning escalation: PAST_DUE with an invoice overdue beyond the grace window.
    if (sub.status === "PAST_DUE") {
      const cutoff = new Date(now.getTime() - GRACE_DAYS * DAY_MS);
      const stale = await prisma.invoice.findFirst({ where: { subscriptionId: sub.id, status: "OPEN", dueAt: { lt: cutoff } } });
      if (stale) {
        await prisma.subscription.update({ where: { id: sub.id }, data: { status: "SUSPENDED" } });
        await emit("subscription.suspended", sub.orgId, `${sub.plan.name} subscription suspended for non-payment`, { planId: sub.planId });
        stats.suspended += 1;
        continue;
      }
    }

    if (sub.status === "SUSPENDED") continue;

    // 2) Period ended -> renew (autoRenew) or expire.
    if (sub.currentPeriodEnd <= now) {
      if (!sub.autoRenew) {
        await prisma.subscription.update({ where: { id: sub.id }, data: { status: "CANCELED", canceledAt: now } });
        await emit("subscription.canceled", sub.orgId, `${sub.plan.name} subscription canceled (auto-renew off)`, { planId: sub.planId });
        stats.canceled += 1;
        continue;
      }

      const periodStart = sub.currentPeriodEnd;
      const periodEnd = addPeriod(periodStart, sub.plan.billingPeriod);
      // Bill at the subscription's LOCKED rate (fall back to the live plan for
      // pre-migration subs), on active seats. A later plan-price edit never
      // retroactively changes an existing subscriber's renewal amount.
      const pricing = effectivePricing(
        { basePrice: sub.lockedBasePrice ?? undefined, includedSeats: sub.lockedIncludedSeats ?? undefined, additionalSeatPrice: sub.lockedAdditionalSeatPrice ?? undefined },
        planPricingOf(sub.plan),
      );
      const amount = computePrice(pricing, sub.activeSeats).totalPrice;
      const invoiceNumber = `INV-${periodStart.toISOString().slice(0, 7).replace("-", "")}-${sub.orgId.replace(/-/g, "").slice(0, 8)}`;
      const paid = amount === 0 || chargeSucceeds();

      try {
        await prisma.invoice.create({
          data: {
            orgId: sub.orgId,
            subscriptionId: sub.id,
            invoiceNumber,
            status: paid ? "PAID" : "OPEN",
            issuedAt: now,
            dueAt: new Date(now.getTime() + INVOICE_DUE_DAYS * DAY_MS),
            paidAt: paid ? now : null,
            periodStart,
            periodEnd,
            subtotal: amount,
            totalAmount: amount,
            amountDue: paid ? 0 : amount,
            currency: "USD",
          },
        });
      } catch {
        // Invoice for this period already exists (idempotent re-run) — ignore.
      }

      const status = paid ? "ACTIVE" : "PAST_DUE";
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, trialEndsAt: null },
      });
      await emit("subscription.renewed", sub.orgId, `${sub.plan.name} subscription renewed`, { planId: sub.planId, amountCents: amount });
      stats.renewed += 1;
      if (!paid) {
        await emit("payment.failed", sub.orgId, `Payment failed on ${sub.plan.name} renewal`, { planId: sub.planId, amountCents: amount });
        stats.paymentsFailed += 1;
      }
    }
  }

  logger.info(stats, "billing lifecycle cycle complete");
  return stats;
}
