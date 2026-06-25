import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { ACCESS_COOKIE, IDENTITY_URL } from "./auth";

/**
 * Server-only fetch against the platform-admin reporting API, authenticated with
 * the admin's httpOnly access cookie. Used by the lib/data modules so the
 * dashboard reads REAL cross-org data from identity-service.
 */
export async function adminFetch<T>(path: string): Promise<T> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  const res = await fetch(`${IDENTITY_URL}/v1/platform/admin/${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`platform-admin API "${path}" failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface ApiUsage {
  series: { date: string; activeHours: number; idleHours: number; productiveHours: number; avgProductivity: number }[];
  topOrgs: { id: string; name: string; activeHours: number; avgProductivity: number }[];
  totals: { activeHours: number; idleHours: number; productiveHours: number; avgProductivity: number };
}

/** Deduplicated per-render: usage page + overview share one /usage call. */
export const getUsage = cache(() => adminFetch<ApiUsage>("usage"));

export interface ApiBilling {
  plans: { plan: string; name: string; orgs: number; seats: number; mrr: number; color: string }[];
  revenue: {
    mrr: number;
    arr: number;
    arpa: number;
    churnRatePct: number;
    growthRatePct: number;
    netRevenueRetentionPct: number;
    payingOrgs: number;
    totalOrgs: number;
    totalSeats: number;
  };
  trend: { month: string; mrr: number; newMrr: number; churnedMrr: number }[];
}

/** Deduplicated per-render: subscriptions + revenue + overview share one /billing call. */
export const getBilling = cache(() => adminFetch<ApiBilling>("billing"));
