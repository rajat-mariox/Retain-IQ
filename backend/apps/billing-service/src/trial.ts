import type { PrismaClient } from "@retainiq/database/billing";
import type { Logger } from "@retainiq/observability";
import { computePrice, planPricingOf } from "@retainiq/contracts";

/**
 * Trial lifecycle. Trials are a STATE of a subscription (status=TRIALING), never a
 * separate plan — the org gets the trial plan's full entitlements while trialing.
 *
 * This module owns the automated side: the expiration sweep (run on the billing
 * interval) that transitions trials whose `trialEndsAt` has passed. It is
 * idempotent — a trial is only acted on while it is still TRIALING — so repeated
 * runs are safe.
 *
 * Expiration policy (Option B in the spec): a trial that ends without an explicit
 * conversion moves to EXPIRED (not silently charged). A super-admin or a payment
 * flow converts a trial to ACTIVE via `convertTrial`. Conversion/extension helpers
 * live here too so all trial writes share one place and emit consistent events.
 */

const DAY_MS = 86_400_000;

export interface TrialSweepStats {
  scanned: number;
  expired: number;
}

/** Emit a BillingEvent (append-only feed). */
async function emit(
  prisma: PrismaClient,
  orgId: string,
  type: string,
  summary: string,
  extra?: { planId?: string; amountCents?: number },
): Promise<void> {
  await prisma.billingEvent.create({
    data: { orgId, type, summary, planId: extra?.planId ?? null, amountCents: extra?.amountCents ?? null },
  });
}

/**
 * Find trials whose window has closed and expire them. A trial is expired when
 * status=TRIALING and trialEndsAt <= now. On expiry: status→EXPIRED, stamp
 * trialExpiredAt, and record a `trial.expired` event. The org keeps its plan
 * reference (so the UI can prompt "choose a plan to continue") but is no longer
 * billable/active — MRR helpers already treat non-ACTIVE/PAST_DUE as $0.
 */
export async function runTrialExpiry(opts: { prisma: PrismaClient; logger: Logger }): Promise<TrialSweepStats> {
  const { prisma, logger } = opts;
  const now = new Date();
  const stats: TrialSweepStats = { scanned: 0, expired: 0 };

  const due = await prisma.subscription.findMany({
    where: { status: "TRIALING", trialEndsAt: { lte: now } },
    include: { plan: true },
  });
  stats.scanned = due.length;

  for (const sub of due) {
    try {
      // Re-check status inside the write window (idempotent against concurrent runs).
      const updated = await prisma.subscription.updateMany({
        where: { id: sub.id, status: "TRIALING" },
        data: { status: "EXPIRED", trialExpiredAt: now },
      });
      if (updated.count === 0) continue; // someone else already moved it
      stats.expired += 1;
      await emit(prisma, sub.orgId, "trial.expired", `${sub.plan.name} trial expired`, { planId: sub.planId });
    } catch (err) {
      logger.error({ orgId: sub.orgId, err: String(err) }, "trial expiry failed for subscription");
    }
  }

  if (stats.expired > 0) logger.info({ ...stats }, "trial expiry sweep");
  return stats;
}

/**
 * Convert a trial to a paid, active subscription. Preserves plan + seats, opens a
 * fresh billing period, re-locks the rate, and records `trial.converted`. Only a
 * TRIALING sub can convert. Returns the updated row, or null if not trialing.
 */
export async function convertTrial(opts: {
  prisma: PrismaClient;
  orgId: string;
  logger: Logger;
}): Promise<{ ok: boolean; message?: string }> {
  const { prisma, orgId } = opts;
  const sub = await prisma.subscription.findUnique({ where: { orgId }, include: { plan: true } });
  if (!sub) return { ok: false, message: "This organization has no subscription." };
  if (sub.status !== "TRIALING") return { ok: false, message: "Only a trialing subscription can be converted." };

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + (sub.plan.billingPeriod === "yearly" ? 12 : 1));
  const pricing = planPricingOf(sub.plan);
  const lockedTotal = computePrice(pricing, sub.seats).totalPrice;

  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      status: "ACTIVE",
      trialConvertedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      lockedBasePrice: pricing.basePrice,
      lockedAdditionalSeatPrice: pricing.additionalSeatPrice,
      lockedIncludedSeats: pricing.includedSeats,
      lockedTotalPrice: lockedTotal,
    },
  });
  await emit(prisma, orgId, "trial.converted", `${sub.plan.name} trial converted to paid`, {
    planId: sub.planId,
    amountCents: computePrice(pricing, sub.activeSeats).totalPrice,
  });
  return { ok: true };
}

/**
 * Extend a trial's end date by `days` (super-admin action). Only a TRIALING sub
 * can be extended. Records `trial.extended` with the new end date for audit.
 */
export async function extendTrial(opts: {
  prisma: PrismaClient;
  orgId: string;
  days: number;
}): Promise<{ ok: boolean; message?: string; trialEndsAt?: string }> {
  const { prisma, orgId, days } = opts;
  if (!Number.isInteger(days) || days <= 0 || days > 365) return { ok: false, message: "Extend by 1–365 days." };
  const sub = await prisma.subscription.findUnique({ where: { orgId }, include: { plan: true } });
  if (!sub) return { ok: false, message: "This organization has no subscription." };
  if (sub.status !== "TRIALING") return { ok: false, message: "Only a trialing subscription can be extended." };

  // Extend from the later of now / current end so a past-due trial resumes sensibly.
  const base = sub.trialEndsAt && sub.trialEndsAt.getTime() > Date.now() ? sub.trialEndsAt : new Date();
  const next = new Date(base.getTime() + days * DAY_MS);
  await prisma.subscription.update({ where: { id: sub.id }, data: { trialEndsAt: next } });
  await emit(prisma, orgId, "trial.extended", `${sub.plan.name} trial extended by ${days} day${days === 1 ? "" : "s"} to ${next.toISOString().slice(0, 10)}`, {
    planId: sub.planId,
  });
  return { ok: true, trialEndsAt: next.toISOString() };
}

/** Cancel a trial immediately (super-admin or org action) → CANCELED, keep history. */
export async function cancelTrial(opts: {
  prisma: PrismaClient;
  orgId: string;
}): Promise<{ ok: boolean; message?: string }> {
  const { prisma, orgId } = opts;
  const sub = await prisma.subscription.findUnique({ where: { orgId }, include: { plan: true } });
  if (!sub) return { ok: false, message: "This organization has no subscription." };
  if (sub.status !== "TRIALING") return { ok: false, message: "Only a trialing subscription can be canceled as a trial." };
  await prisma.subscription.update({ where: { id: sub.id }, data: { status: "CANCELED", canceledAt: new Date() } });
  await emit(prisma, orgId, "trial.canceled", `${sub.plan.name} trial canceled`, { planId: sub.planId });
  return { ok: true };
}
