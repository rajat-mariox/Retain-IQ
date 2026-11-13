import "server-only";
import { getUsage } from "../admin-api";
import type { UsagePoint } from "./types";

// LIVE cross-org usage/analytics reads — aggregates over analytics-db
// EmployeeDayFact, served by the platform-admin /usage endpoint.

export async function getUsageSeries(): Promise<UsagePoint[]> {
  return (await getUsage()).series;
}

export interface TopOrgUsage {
  id: string;
  name: string;
  activeHours: number;
  avgProductivity: number;
}

export async function getTopOrgsByUsage(limit = 8): Promise<TopOrgUsage[]> {
  return (await getUsage()).topOrgs.slice(0, limit);
}

export async function getUsageTotals(): Promise<{
  activeHours: number;
  idleHours: number;
  productiveHours: number;
  avgProductivity: number;
}> {
  return (await getUsage()).totals;
}
