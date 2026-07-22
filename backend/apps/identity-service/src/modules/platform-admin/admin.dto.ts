// Response shapes for the platform-admin reporting API. These mirror what the
// admin-web dashboard renders, so the frontend data layer maps 1:1.

import type { OffsetPage } from "@retainiq/contracts";

export interface AdminOverview {
  totalOrgs: number;
  activeOrgs: number;
  suspendedOrgs: number;
  newOrgsThisMonth: number;
  totalUsers: number;
  totalEmployees: number;
  avgProductivity: number;
  trackedOrgs: number;
}

export interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  status: string;
  /** People with a login (memberships). */
  users: number;
  /** HR records — not everyone here can necessarily sign in. */
  employees: number;
  /** Employees with tracked activity in the last 30 days — the real usage number. */
  activeUsers: number;
  avgProductivity: number;
  activeHours: number;
  createdAt: string;
  lastActiveAt: string | null;
  plan: string | null;
  /** Human-readable plan name ("Basic"), vs `plan` which is the id ("basic"). */
  planName: string | null;
  subscriptionStatus: string | null;
  /** Seats bought vs seats in use — the upsell/churn signal. */
  seats: number | null;
  /** End of the current paid period. */
  renewsAt: string | null;
  /** When the trial lapses; null once they're a paying customer. */
  trialEndsAt: string | null;
  /** Screenshot bytes stored, and the plan's cap (null = unlimited). */
  storageUsedBytes: number;
  storageLimitBytes: number | null;
  region?: string;
  timezone?: string;
}

export interface AdminPlanDist {
  plan: string;
  name: string;
  orgs: number;
  seats: number;
  mrr: number;
  color: string;
}

export interface AdminRevenue {
  mrr: number;
  arr: number;
  arpa: number;
  churnRatePct: number;
  growthRatePct: number;
  netRevenueRetentionPct: number;
  payingOrgs: number;
  totalOrgs: number;
  totalSeats: number;
}

export interface AdminMrrPoint {
  month: string;
  mrr: number;
  newMrr: number;
  churnedMrr: number;
}

export interface AdminTopCustomer {
  orgId: string;
  orgName: string;
  plan: string;
  seats: number;
  mrr: number; // USD whole dollars
}

export interface AdminBilling {
  plans: AdminPlanDist[];
  revenue: AdminRevenue;
  trend: AdminMrrPoint[];
  topCustomers: AdminTopCustomer[];
}

export interface AdminUsagePoint {
  date: string;
  activeHours: number;
  idleHours: number;
  productiveHours: number;
  avgProductivity: number;
}

export interface AdminTopOrg {
  id: string;
  name: string;
  activeHours: number;
  avgProductivity: number;
}

export interface AdminUsage {
  series: AdminUsagePoint[];
  topOrgs: AdminTopOrg[];
  totals: { activeHours: number; idleHours: number; productiveHours: number; avgProductivity: number };
}

export interface AdminEmployee {
  id: string;
  name: string;
  email: string | null;
  status: string;
  avgProductivity: number;
  activeHours: number;
  productiveHours: number;
  lastActiveDay: string | null;
  // Attendance (last 30 days).
  attendanceRate: number;
  daysPresent: number;
  todayStatus: string | null;
}

export interface AdminAttendanceToday {
  totalEmployees: number;
  present: number;
  late: number;
  absent: number;
  onLeave: number;
  attendanceRate: number;
}

export interface AdminSubscription {
  planId: string | null;
  planName: string | null;
  status: string | null;
  seats: number;
  activeSeats: number;
  pricePerSeat: number; // USD cents
  mrr: number; // USD cents
  autoRenew: boolean;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
}

export interface AdminStorage {
  usedBytes: number;
  limitBytes: number | null; // null = unlimited
}

export interface AdminOrgDetail {
  org: AdminOrg;
  subscription: AdminSubscription;
  storage: AdminStorage;
  employees: AdminEmployee[];
  attendanceToday: AdminAttendanceToday;
}

export interface AdminSubLifecycleRow {
  orgId: string;
  orgName: string;
  plan: string;
  status: string;
  autoRenew: boolean;
  currentPeriodEnd: string;
  daysLeft: number;
}

export interface AdminFailedPaymentRow {
  orgId: string;
  orgName: string;
  plan: string;
  status: string;
  amountDue: number; // USD cents
  dueAt: string | null;
  daysOverdue: number;
}

export interface AdminSubscriptionsView {
  counts: { active: number; trialing: number; pastDue: number; suspended: number; canceled: number; expiringSoon: number };
  upcoming: AdminSubLifecycleRow[]; // renewals + expirations within the window
  failed: AdminFailedPaymentRow[];
}

// ---- Platform growth (replaces the tenant-facing workforce analytics) ----

export interface AdminGrowthPoint {
  month: string; // "Jan 26"
  /** New in that month. */
  orgs: number;
  users: number;
  /** Running total at the end of that month — the actual growth curve. */
  totalOrgs: number;
  totalUsers: number;
}

export interface AdminStoragePoint {
  month: string;
  /** Bytes added that month, and the running total. */
  addedBytes: number;
  totalBytes: number;
}

export interface AdminSeatPoint {
  planName: string;
  seatsSold: number;
  seatsUsed: number;
  orgs: number;
}

export interface AdminGrowth {
  totals: {
    orgs: number;
    users: number;
    newOrgsThisMonth: number;
    newUsersThisMonth: number;
    /** Percent change in new orgs vs the previous month; null when there's no prior month. */
    orgGrowthPct: number | null;
    seatsSold: number;
    seatsUsed: number;
    storageBytes: number;
  };
  growth: AdminGrowthPoint[]; // last 12 months
  storage: AdminStoragePoint[]; // last 12 months
  seats: AdminSeatPoint[]; // by plan
  topOrgs: { id: string; name: string; users: number; activeUsers: number; seats: number | null }[];
}

export interface AdminActivityItem {
  id: string;
  source: "org" | "billing";
  type: string;
  summary: string;
  orgId: string | null;
  orgName: string | null;
  createdAt: string;
}

export interface AdminActivityFeed {
  items: AdminActivityItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ---- Platform health ----

export type HealthStatus = "up" | "degraded" | "down";

export interface AdminServiceHealth {
  name: string;
  status: HealthStatus;
  latencyMs: number | null;
  detail: string; // e.g. "200 ok", "timeout", "connection refused"
}

export interface AdminDbHealth {
  name: string;
  status: HealthStatus;
  latencyMs: number | null;
}

export interface AdminQueueHealth {
  driver: string; // redis | kafka
  status: HealthStatus;
  latencyMs: number | null;
}

export interface AdminStorageTotals {
  usedBytes: number;
  objects: number;
  orgs: number; // orgs with at least one stored object
  limitBytes: number | null; // sum of plan limits; null if any org is unlimited
}

export interface AdminSystemHealth {
  api: HealthStatus; // overall rollup
  services: AdminServiceHealth[];
  databases: AdminDbHealth[];
  queue: AdminQueueHealth;
  storage: AdminStorageTotals;
  checkedAt: string;
}

/**
 * One day of sign-in activity, split by where people signed in from. Browser and
 * desktop-agent are reported separately: the agent re-authenticates on a timer,
 * so mixing them would drown the human signal (that's why `*Users` is the honest
 * number — distinct people, not session rows).
 */
export interface AdminLoginPoint {
  date: string; // YYYY-MM-DD
  /**
   * Browser sessions created that day. Secondary: a token refresh also mints a
   * session, so this over-counts real sign-ins. Prefer `users`.
   */
  logins: number;
  /** Distinct people who signed in from a browser that day — the honest signal. */
  users: number;
  /** Distinct people whose desktop agent authenticated that day. */
  agentUsers: number;
}

export interface AdminFeatureUsage {
  feature: string;
  orgs: number; // orgs that have used the feature
  events: number; // total activity rows
}

export interface AdminUsageAnalytics {
  /**
   * Distinct users with a live session in the window. Counts machine sessions
   * too (a running agent means the tenant IS using the product), so this is
   * broader than the browser-only sign-in trend below.
   */
  dau: number; // last 24h
  wau: number; // last 7 days
  mau: number; // last 30 days
  /** Browser sign-ins today — machine sessions excluded. */
  loginsToday: number;
  loginTrend: AdminLoginPoint[]; // last 30 days
  featureUsage: AdminFeatureUsage[];
}

// ---- Customer success ----

export type HealthBand = "healthy" | "attention" | "at_risk";
export type ChurnReason = "low_usage" | "inactive" | "renewal_risk";

export interface AdminOrgHealth {
  orgId: string;
  name: string;
  plan: string | null;
  status: string;
  // 0-100 sub-scores + weighted overall (0.40 frequency / 0.35 seatUsage / 0.25 adoption).
  adoption: number; // how many of the 5 product areas they've ever used
  frequency: number; // how recently, and how many days, they showed up
  seatUsage: number; // how much of the plan they bought is actually in use
  healthScore: number;
  band: HealthBand;
  // Supporting figures.
  featuresUsed: number; // 0-5
  /** Days with any tracked activity in the 30-day window — the "how often" behind `frequency`. */
  activeDays: number;
  seats: number;
  activeEmployees: number; // distinct employees with tracked activity (30d)
  activeHours: number;
  /**
   * The customer's own workforce productivity. Reported for context but NOT part
   * of healthScore — see computeCustomerSuccess.
   */
  avgProductivity: number;
  daysSinceActive: number | null; // null = never active
  renewsInDays: number | null;
  autoRenew: boolean;
  risks: ChurnReason[];
}

export interface AdminCustomerSuccess {
  summary: { total: number; healthy: number; attention: number; atRisk: number; avgHealthScore: number };
  churn: { lowUsage: number; inactive: number; renewalRisk: number };
  organizations: OffsetPage<AdminOrgHealth>; // worst health first, paginated
}

// ---- Audit & compliance ----

export type AuditCategory = "login" | "subscription" | "plan" | "organization";

export interface AdminAuditEntry {
  id: string;
  category: AuditCategory;
  type: string; // auth.login | subscription.renewed | subscription.plan_changed | org.suspended ...
  summary: string;
  actor: string | null; // who performed it (email)
  orgId: string | null;
  orgName: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AdminAuditPage {
  items: AdminAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

// ---- SaaS configuration (global settings) ----

export interface PlatformBranding {
  platformName: string;
  primaryColor: string; // #RRGGBB
  supportEmail: string;
  logoUrl: string;
}

export interface GlobalNotification {
  enabled: boolean;
  message: string;
  level: "info" | "warning" | "critical";
}

export type FeatureFlags = Record<string, boolean>;

export interface MaintenanceMode {
  enabled: boolean;
  message: string;
}

export interface PlatformSettings {
  branding: PlatformBranding;
  notification: GlobalNotification;
  featureFlags: FeatureFlags;
  maintenance: MaintenanceMode;
}
