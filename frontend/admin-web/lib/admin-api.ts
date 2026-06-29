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
  topCustomers: { orgId: string; orgName: string; plan: string; seats: number; mrr: number }[];
}

/** Deduplicated per-render: subscriptions + revenue + overview share one /billing call. */
export const getBilling = cache(() => adminFetch<ApiBilling>("billing"));

export interface ApiSubscriptions {
  counts: { active: number; trialing: number; pastDue: number; suspended: number; canceled: number; expiringSoon: number };
  upcoming: { orgId: string; orgName: string; plan: string; status: string; autoRenew: boolean; currentPeriodEnd: string; daysLeft: number }[];
  failed: { orgId: string; orgName: string; plan: string; status: string; amountDue: number; dueAt: string | null; daysOverdue: number }[];
}
export const getSubscriptionsView = cache(() => adminFetch<ApiSubscriptions>("subscriptions"));

export interface ApiActivityItem {
  id: string;
  source: "org" | "billing";
  type: string;
  summary: string;
  orgId: string | null;
  orgName: string | null;
  createdAt: string;
}
export interface ApiActivityFeed {
  items: ApiActivityItem[];
  total: number;
  page: number;
  pageSize: number;
}
export const getActivity = cache((page = 1, pageSize = 25) =>
  adminFetch<ApiActivityFeed>(`activity?page=${page}&pageSize=${pageSize}`),
);

export type HealthStatus = "up" | "degraded" | "down";
export interface ApiSystemHealth {
  api: HealthStatus;
  services: { name: string; status: HealthStatus; latencyMs: number | null; detail: string }[];
  databases: { name: string; status: HealthStatus; latencyMs: number | null }[];
  queue: { driver: string; status: HealthStatus; latencyMs: number | null };
  storage: { usedBytes: number; objects: number; orgs: number; limitBytes: number | null };
  checkedAt: string;
}
export interface ApiUsageAnalytics {
  dau: number;
  wau: number;
  mau: number;
  loginsToday: number;
  loginTrend: { date: string; logins: number; users: number }[];
  featureUsage: { feature: string; orgs: number; events: number }[];
}
export const getSystemHealth = cache(() => adminFetch<ApiSystemHealth>("health"));
export const getUsageAnalytics = cache(() => adminFetch<ApiUsageAnalytics>("usage-analytics"));

export type HealthBand = "healthy" | "attention" | "at_risk";
export type ChurnReason = "low_usage" | "inactive" | "renewal_risk";
export interface ApiOrgHealth {
  orgId: string;
  name: string;
  plan: string | null;
  status: string;
  adoption: number;
  frequency: number;
  utilization: number;
  healthScore: number;
  band: HealthBand;
  featuresUsed: number;
  seats: number;
  activeEmployees: number;
  activeHours: number;
  avgProductivity: number;
  daysSinceActive: number | null;
  renewsInDays: number | null;
  autoRenew: boolean;
  risks: ChurnReason[];
}
export interface ApiCustomerSuccess {
  summary: { total: number; healthy: number; attention: number; atRisk: number; avgHealthScore: number };
  churn: { lowUsage: number; inactive: number; renewalRisk: number };
  organizations: { items: ApiOrgHealth[]; total: number; page: number; pageSize: number };
}
export const getCustomerSuccess = cache((page = 1, pageSize = 15) =>
  adminFetch<ApiCustomerSuccess>(`customer-success?page=${page}&pageSize=${pageSize}`),
);

export interface ApiPlatformSettings {
  branding: { platformName: string; primaryColor: string; supportEmail: string; logoUrl: string };
  notification: { enabled: boolean; message: string; level: "info" | "warning" | "critical" };
  featureFlags: Record<string, boolean>;
  maintenance: { enabled: boolean; message: string };
}
export const getSettings = cache(() => adminFetch<ApiPlatformSettings>("settings"));
