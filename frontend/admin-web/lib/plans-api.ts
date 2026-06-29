import "server-only";
import { cookies } from "next/headers";
import { ACCESS_COOKIE } from "./auth";

// billing-service owns the Plan table and exposes the platform-admin plan-CRUD
// API. Reads/writes go straight to it (identity keeps its read-only binding for
// the dashboards). Server-to-server, authed with the admin's platform JWT.
export const BILLING_ADMIN_URL = process.env.BILLING_ADMIN_URL ?? "http://localhost:3007";

export interface AdminPlan {
  id: string;
  name: string;
  description: string | null;
  pricePerSeat: number; // USD cents
  billingPeriod: string;
  seatLimit: number | null;
  storageLimitMb: number | null;
  features: string[];
  color: string;
  sortOrder: number;
  isActive: boolean;
}

export async function getPlans(): Promise<AdminPlan[]> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  const res = await fetch(`${BILLING_ADMIN_URL}/v1/admin/plans`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`plan API failed (${res.status})`);
  const data = (await res.json()) as { items: AdminPlan[] };
  return data.items;
}
