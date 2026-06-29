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
  users: number;
  employees: number;
  avgProductivity: number;
  activeHours: number;
  createdAt: string;
  lastActiveAt: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
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

export interface AdminLoginPoint {
  date: string; // YYYY-MM-DD
  logins: number; // sessions created that day
  users: number; // distinct users who logged in
}

export interface AdminFeatureUsage {
  feature: string;
  orgs: number; // orgs that have used the feature
  events: number; // total activity rows
}

export interface AdminUsageAnalytics {
  dau: number; // distinct users active in last 24h
  wau: number; // last 7 days
  mau: number; // last 30 days
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
  // 0-100 sub-scores + weighted overall.
  adoption: number; // breadth: features used / 5
  frequency: number; // recency + active-days cadence
  utilization: number; // seat usage + productivity
  healthScore: number;
  band: HealthBand;
  // Supporting figures.
  featuresUsed: number; // 0-5
  seats: number;
  activeEmployees: number; // distinct employees with tracked activity (30d)
  activeHours: number;
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
