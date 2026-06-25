import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { ACCESS_COOKIE, IDENTITY_URL } from "./auth";

/** Server-only fetch against the tenant (org-scoped) API, authed with the org cookie. */
export async function apiFetch<T>(path: string): Promise<T> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  const res = await fetch(`${IDENTITY_URL}/v1/${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`tenant API "${path}" failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface OrgSession {
  id: string;
  user: { id: string; email: string; mustChangePassword: boolean };
  org: { id: string; name: string; slug: string };
  role: { name: string; permissions: string[] };
  employee: { id: string; firstName: string; lastName: string; department: string | null; title: string | null } | null;
}

/** The signed-in principal (org + user + role), deduplicated per render. */
export const getSession = cache(() => apiFetch<OrgSession>("auth/me"));

/** Offset (page-number) pagination envelope returned by the list APIs. */
export interface OffsetPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AttendanceToday {
  day: string;
  totalEmployees: number;
  present: number;
  late: number;
  absent: number;
  onLeave: number;
  checkedIn: number;
  attendanceRate: number;
  records: { employeeId: string; status: string; checkInAt: string | null; checkOutAt: string | null; workMinutes: number }[];
}
export const getAttendanceToday = cache(() => apiFetch<AttendanceToday>("attendance/today"));

export interface AttendanceRecord {
  id: string;
  day: string;
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  workMinutes: number;
}
export const getMyAttendance = cache(() => apiFetch<{ today: AttendanceRecord | null; history: AttendanceRecord[] }>("attendance/me"));

export interface OrgBilling {
  subscription: {
    planId: string;
    planName: string;
    pricePerSeat: number;
    status: string;
    seats: number;
    activeSeats: number;
    seatLimit: number | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    trialEndsAt: string | null;
    autoRenew: boolean;
    mrr: number;
  } | null;
  invoices: {
    invoiceNumber: string;
    status: string;
    issuedAt: string;
    periodStart: string;
    periodEnd: string;
    totalAmount: number;
    amountDue: number;
    currency: string;
  }[];
  plans: { id: string; name: string; pricePerSeat: number; seatLimit: number | null; features: string[]; color: string }[];
}
export const getBilling = cache(() => apiFetch<OrgBilling>("billing"));

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  teamName: string | null;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  taskCount: number;
  doneCount: number;
}
export const getProjects = cache((page = 1, pageSize = 9) =>
  apiFetch<OffsetPage<ProjectSummary>>(`projects?page=${page}&pageSize=${pageSize}`),
);

export interface ProjectTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeName: string | null;
  dueDate: string | null;
}
export interface ProjectDetail extends Omit<ProjectSummary, "taskCount" | "doneCount"> {
  tasks: ProjectTask[];
}
export const getProject = (id: string) => apiFetch<ProjectDetail>(`projects/${id}`);

export interface InsightsMe {
  series: { date: string; activeHours: number; productiveHours: number; idleHours: number; productivity: number; focus: number }[];
  totals: { activeHours: number; productiveHours: number; avgProductivity: number; avgFocus: number; trackedDays: number };
  momentum: { direction: string; deltaPct: number };
}
export const getInsightsMe = cache(() => apiFetch<InsightsMe>("insights/me"));

export interface InsightsTeam {
  summary: { trackedEmployees: number; avgProductivity: number; avgFocus: number; workforceHealth: number; burnoutRisk: number; lowEngagement: number };
  topPerformers: { employeeId: string; name: string; productivity: number; focus: number; activeHours: number; risk: string }[];
  people: { employeeId: string; name: string; productivity: number; focus: number; activeHours: number; trackedDays: number; risk: string }[];
}
export const getInsightsTeam = cache(() => apiFetch<InsightsTeam>("insights/team"));

export interface OrgMember {
  id: string;
  email: string;
  role: string;
  status: string;
  name: string | null;
  joinedAt: string;
}
export const getMembers = cache((page = 1, pageSize = 10) =>
  apiFetch<OffsetPage<OrgMember>>(`org/members?page=${page}&pageSize=${pageSize}`),
);

export interface OrgProfile {
  id: string;
  name: string;
  slug: string;
  status: string;
  region: string;
  timezone: string;
  createdAt: string;
}
export const getOrg = cache(() => apiFetch<OrgProfile>("org"));

export interface InboxNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  status: string;
  readAt: string | null;
  createdAt: string;
}
export const getNotifications = cache((page = 1, pageSize = 10) =>
  apiFetch<OffsetPage<InboxNotification>>(`notifications?page=${page}&pageSize=${pageSize}`),
);

