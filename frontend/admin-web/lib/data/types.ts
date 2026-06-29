// Domain types for the super-admin dashboard. These describe the shape every
// data module returns, regardless of whether the source is the current mock or
// a real platform-admin API later — the UI only ever imports from here.

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
  users: number;
  employees: number;
  /** Average productivity score across the org, 0–100. */
  avgProductivity: number;
  /** Tracked active hours over the last 30 days. */
  activeHours: number;
  createdAt: string;
  lastActiveAt: string | null;
  // Billing/plan fields have no backing model yet — present only on mock data.
  country?: string;
  plan?: PlanId;
  seats?: number;
  activeSeats?: number;
  mrr?: number;
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
