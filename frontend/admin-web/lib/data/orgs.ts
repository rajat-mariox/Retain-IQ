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
  avgProductivity: number;
  activeHours: number;
  createdAt: string;
  lastActiveAt: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
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
    avgProductivity: o.avgProductivity,
    activeHours: o.activeHours,
    createdAt: o.createdAt,
    lastActiveAt: o.lastActiveAt,
    plan: o.plan ? (o.plan as PlanId) : undefined,
  };
}

export async function getOrganizations(): Promise<Organization[]> {
  const orgs = await adminFetch<ApiOrg[]>("organizations");
  return orgs.map(toOrg);
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
