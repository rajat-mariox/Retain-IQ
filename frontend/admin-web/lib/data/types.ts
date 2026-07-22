// Domain types for the super-admin dashboard — the shape every data module
// returns. All of them now read the live platform-admin API; the UI only ever
// imports from here.

export type PlanId = "free" | "basic" | "professional" | "enterprise";
export type OrgStatus = "active" | "trialing" | "suspended" | "churned";

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly list price per active seat, in USD. */
  pricePerSeat: number;
  /** Hex accent used consistently across charts/badges for this plan. */
  color: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  /** People who can sign in (memberships). */
  users: number;
  /** HR records — not all of them necessarily have a login. */
  employees: number;
  /** Employees with tracked activity in the last 30 days. */
  activeUsers: number;
  /** Average productivity score across the org, 0–100. */
  avgProductivity: number;
  /** Tracked active hours over the last 30 days. */
  activeHours: number;
  createdAt: string;
  lastActiveAt: string | null;
  // Subscription facts, live from billing-service.
  plan?: string | null;
  /** Display name ("Basic") for `plan`, which is the id ("basic"). */
  planName?: string | null;
  subscriptionStatus?: string | null;
  seats?: number | null;
  /** End of the current paid period. */
  renewsAt?: string | null;
  /** When the trial lapses; null once paying. */
  trialEndsAt?: string | null;
  storageUsedBytes?: number;
  /** null = unlimited on this plan. */
  storageLimitBytes?: number | null;
  country?: string;
}

export interface KpiSummary {
  totalOrgs: number;
  activeOrgs: number;
  trialingOrgs: number;
  suspendedOrgs: number;
  totalUsers: number;
  totalEmployees: number;
  avgProductivity: number;
  newOrgsThisMonth?: number;
  trackedOrgs?: number;
  /** Month-over-month deltas, as signed percentages (mock data only). */
  orgsDeltaPct?: number;
  usersDeltaPct?: number;
  productivityDeltaPct?: number;
}

export interface UsagePoint {
  date: string;
  activeHours: number;
  idleHours: number;
  productiveHours: number;
  avgProductivity: number;
}

export interface PlanDistribution {
  plan: PlanId;
  name: string;
  orgs: number;
  seats: number;
  mrr: number;
  color: string;
}

export interface MrrPoint {
  month: string;
  mrr: number;
  newMrr: number;
  churnedMrr: number;
}

export interface RevenueSummary {
  mrr: number;
  arr: number;
  /** Average revenue per paying account. */
  arpa: number;
  churnRatePct: number;
  growthRatePct: number;
  netRevenueRetentionPct: number;
}
