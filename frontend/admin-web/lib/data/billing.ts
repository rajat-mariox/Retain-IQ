import "server-only";
import { getBilling } from "../admin-api";
import type { MrrPoint, PlanDistribution, PlanId, RevenueSummary } from "./types";

// LIVE subscriptions + revenue, served by the platform-admin /billing endpoint
// (Plan + Subscription + Invoice tables). No longer mock.

export async function getPlanDistribution(): Promise<PlanDistribution[]> {
  const { plans } = await getBilling();
  return plans.map((p) => ({
    plan: p.plan as PlanId,
    name: p.name,
    orgs: p.orgs,
    seats: p.seats,
    mrr: p.mrr,
    color: p.color,
  }));
}

export async function getMrrTrend(): Promise<MrrPoint[]> {
  return (await getBilling()).trend;
}

export async function getRevenueSummary(): Promise<RevenueSummary> {
  const { revenue } = await getBilling();
  return {
    mrr: revenue.mrr,
    arr: revenue.arr,
    arpa: revenue.arpa,
    churnRatePct: revenue.churnRatePct,
    growthRatePct: revenue.growthRatePct,
    netRevenueRetentionPct: revenue.netRevenueRetentionPct,
  };
}
