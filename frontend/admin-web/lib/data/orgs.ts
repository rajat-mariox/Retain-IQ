import "server-only";
import { adminFetch } from "../admin-api";
import type { KpiSummary, Organization, OrgStatus, PlanId } from "./types";

// LIVE org + KPI reads from the platform-admin API (identity-db + analytics-db).

interface ApiOrg {
  id: string;
  name: string;
  slug: string;
  status: string;
  users: number;
  employees: number;
  activeUsers: number;
  avgProductivity: number;
  activeHours: number;
  createdAt: string;
  lastActiveAt: string | null;
  plan: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  seats: number | null;
  renewsAt: string | null;
  trialEndsAt: string | null;
  storageUsedBytes: number;
  storageLimitBytes: number | null;
}

interface ApiOverview {
  totalOrgs: number;
  activeOrgs: number;
  suspendedOrgs: number;
  newOrgsThisMonth: number;
  totalUsers: number;
  totalEmployees: number;
  avgProductivity: number;
  trackedOrgs: number;
}

const STATUS_MAP: Record<string, OrgStatus> = {
  ACTIVE: "active",
  INVITED: "trialing",
  SUSPENDED: "suspended",
  DELETED: "churned",
};

function toOrg(o: ApiOrg): Organization {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: STATUS_MAP[o.status] ?? "active",
    users: o.users,
    employees: o.employees,
    activeUsers: o.activeUsers,
    avgProductivity: o.avgProductivity,
    activeHours: o.activeHours,
    createdAt: o.createdAt,
    lastActiveAt: o.lastActiveAt,
    plan: o.plan,
    planName: o.planName,
    subscriptionStatus: o.subscriptionStatus,
    seats: o.seats,
    renewsAt: o.renewsAt,
    trialEndsAt: o.trialEndsAt,
    storageUsedBytes: o.storageUsedBytes,
    storageLimitBytes: o.storageLimitBytes,
  };
}

interface OffsetPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// The /organizations API is offset-paginated. The admin table does client-side
// search + sort over the full set, so we fetch a large page; the dashboards are
// demo-scale. (A future enhancement is server-side search/sort/pagination.)
export async function getOrganizations(): Promise<Organization[]> {
  const page = await adminFetch<OffsetPage<ApiOrg>>("organizations?page=1&pageSize=100");
  return page.items.map(toOrg);
}

export async function getKpiSummary(): Promise<KpiSummary> {
  const o = await adminFetch<ApiOverview>("overview");
  return {
    totalOrgs: o.totalOrgs,
    activeOrgs: o.activeOrgs,
    trialingOrgs: 0,
    suspendedOrgs: o.suspendedOrgs,
    totalUsers: o.totalUsers,
    totalEmployees: o.totalEmployees,
    avgProductivity: o.avgProductivity,
    newOrgsThisMonth: o.newOrgsThisMonth,
    trackedOrgs: o.trackedOrgs,
  };
}
