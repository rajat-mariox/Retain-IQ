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
  earlyExits: number;
  absent: number;
  onLeave: number;
  checkedIn: number;
  attendanceRate: number;
}
export const getAttendanceToday = cache(() => apiFetch<AttendanceToday>("attendance/today"));

export interface AttendanceSummary {
  total: number;
  present: number;
  late: number;
  earlyExits: number;
  absent: number;
  onLeave: number;
  weeklyOff: number;
  checkedIn: number;
  attendanceRate: number;
}
export interface DailyReportRow {
  employeeId: string;
  name: string;
  department: string | null;
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  workMinutes: number;
  breakMinutes: number;
  netWorkMinutes: number;
  earlyExit: boolean;
}
export interface DailyReport {
  day: string;
  summary: AttendanceSummary;
  rows: DailyReportRow[];
}
export interface DepartmentReport {
  day: string;
  departments: (AttendanceSummary & { departmentId: string | null; name: string })[];
}
export interface MonthlyReportRow {
  employeeId: string;
  name: string;
  department: string | null;
  present: number;
  late: number;
  onLeave: number;
  absent: number;
  workingDays: number;
  attendanceRate: number;
}
export interface MonthlyReport {
  month: string;
  workingDays: number;
  rows: MonthlyReportRow[];
}

export interface AttendanceRecord {
  id: string;
  day: string;
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  workMinutes: number;
}
export const getMyAttendance = cache(() => apiFetch<{ today: AttendanceRecord | null; history: AttendanceRecord[] }>("attendance/me"));

export interface RosterRow {
  employeeId: string;
  name: string;
  department: string | null;
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  workMinutes: number;
  breakMinutes: number;
  netWorkMinutes: number;
}
export interface AttendanceRoster {
  day: string;
  summary: { total: number; present: number; late: number; absent: number; onLeave: number; checkedIn: number; attendanceRate: number };
  rows: RosterRow[];
}
export const getAttendanceRoster = cache(() => apiFetch<AttendanceRoster>("attendance/roster"));

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

export interface ExecutiveOverview {
  workforce: { total: number; active: number; newJoinees: number; onLeave: number; noticePeriod: number; openPositions: number };
  health: { score: number; pillars: { productivity: number; attendance: number; engagement: number; risk: number; burnout: number } };
  attrition: { high: number; medium: number; critical: number; atRiskPct: number; trend: string; trendDelta: number };
  productivity: { companyProductivity: number; focusScore: number; activeHours: number; utilization: number };
}
export const getExecutiveOverview = cache(() => apiFetch<ExecutiveOverview>("insights/executive"));

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

export interface OrgDepartment {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  leadEmployeeId: string | null;
  status: string;
  employeeCount: number;
  teamCount: number;
  createdAt: string;
}
export const getDepartments = cache(() => apiFetch<OrgDepartment[]>("departments"));

export interface OrgTeam {
  id: string;
  name: string;
  description: string | null;
  departmentId: string | null;
  departmentName: string | null;
  leadEmployeeId: string | null;
  memberCount: number;
  createdAt: string;
}
export const getTeams = cache(() => apiFetch<OrgTeam[]>("teams"));

export interface OrgRequisition {
  id: string;
  title: string;
  departmentId: string | null;
  departmentName: string | null;
  openings: number;
  status: string;
  createdAt: string;
}
export const getRequisitions = cache(() => apiFetch<OrgRequisition[]>("requisitions"));

export interface OrgDesignation {
  id: string;
  title: string;
  level: string | null;
  status: string;
  departmentId: string | null;
  departmentName: string | null;
  employeeCount: number;
}
export const getDesignations = cache(() => apiFetch<OrgDesignation[]>("designations"));

export interface ShiftBreak {
  name: string;
  startMinute: number;
  endMinute: number;
}
export interface OrgShift {
  id: string;
  name: string;
  startMinute: number;
  endMinute: number;
  graceMinutes: number;
  workingDays: number[];
  breaks: ShiftBreak[];
  isDefault: boolean;
  status: string;
  employeeCount: number;
}
export const getShifts = cache(() => apiFetch<OrgShift[]>("shifts"));

export interface EmployeeRow {
  id: string;
  employeeCode: string | null;
  email: string | null;
  firstName: string;
  lastName: string;
  title: string | null;
  status: string;
  lifecycleStage: string;
  departmentId: string | null;
  teamId: string | null;
  designationId: string | null;
  shiftId: string | null;
  managerId: string | null;
  joinedAt: string | null;
  probationEndsAt: string | null;
  confirmedAt: string | null;
  exitedAt: string | null;
  createdAt: string;
  departmentRef: { id: string; name: string } | null;
  designationRef: { id: string; title: string; level: string | null } | null;
  shiftRef: { id: string; name: string } | null;
}
export type EmployeePage = OffsetPage<EmployeeRow>;
export const getEmployees = cache((page = 1, pageSize = 10, extra = "") =>
  apiFetch<EmployeePage>(`employees?page=${page}&pageSize=${pageSize}${extra}`),
);

export interface LifecycleSummary {
  onboarding: number;
  probation: number;
  confirmed: number;
  exited: number;
}
export const getLifecycleSummary = cache(() => apiFetch<LifecycleSummary>("employees/lifecycle-summary"));

// ---- Leave & Holidays ----
export interface LeaveType {
  id: string;
  name: string;
  code: string;
  annualQuota: number;
  paid: boolean;
  color: string | null;
  status: string;
}
export const getLeaveTypes = cache(() => apiFetch<LeaveType[]>("leave/types"));

export interface LeaveBalance {
  leaveTypeId: string;
  name: string;
  code: string;
  color: string | null;
  paid: boolean;
  allocated: number;
  used: number;
  pending: number;
  remaining: number | null;
}
export interface LeaveBalances {
  year: number;
  employeeId: string;
  balances: LeaveBalance[];
}
export const getMyLeaveBalances = cache(() => apiFetch<LeaveBalances>("leave/me/balances"));

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string | null;
  leaveType: { id: string; name: string; code: string; color: string | null };
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}
export const getMyLeaveRequests = cache(() => apiFetch<LeaveRequest[]>("leave/requests"));
export const getAllLeaveRequests = cache((status = "") => apiFetch<LeaveRequest[]>(`leave/requests/all${status ? `?status=${status}` : ""}`));

export interface Holiday {
  id: string;
  name: string;
  date: string;
  type: string;
  departmentId: string | null;
  departmentName: string | null;
}
export const getHolidays = cache((year?: number) => apiFetch<Holiday[]>(`holidays${year ? `?year=${year}` : ""}`));

// ---- Employee Monitoring ----
export interface AppUsage { appName: string; category: string; seconds: number; hours: number }
export interface WebsiteUsage { domain: string; category: string; seconds: number; visits: number; hours: number }
export interface MonitoringSummary {
  day: string;
  trackedEmployees: number;
  online: number;
  idle: number;
  offline: number;
  avgProductivity: number;
  avgFocus: number;
  activeHours: number;
  idleHours: number;
  utilization: number;
  topApps: AppUsage[];
  topWebsites: WebsiteUsage[];
}
export const getMonitoringSummary = cache((day?: string) => apiFetch<MonitoringSummary>(`monitoring/summary${day ? `?day=${day}` : ""}`));

export interface PresenceRow { employeeId: string; name: string; status: string; lastActivity: string; lastTitle: string | null; lastSeen: string }
export interface MonitoringSession {
  id: string;
  employeeId: string;
  name: string;
  startedAt: string;
  endedAt: string | null;
  activeHours: number;
  idleHours: number;
  breakHours: number;
  durationHours: number;
  open: boolean;
}
export interface TimelineSegment { id: string; type: string; title: string | null; detail: string | null; category: string | null; startAt: string; endAt: string; seconds: number }

export interface MonitoringPolicy {
  screenshotsEnabled: boolean;
  screenshotIntervalSeconds: number;
  screenshotQuality: number;
  screenshotMaxWidth: number;
}
export const getMonitoringPolicy = cache(() => apiFetch<MonitoringPolicy>("monitoring/policy"));

export interface OrgRole {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCount: number;
}
export const getRoles = cache(() => apiFetch<OrgRole[]>("rbac/roles"));

export interface AccessGrant {
  id: string;
  roleId: string;
  roleName: string;
  scopeType: string;
  scopeLabel: string;
}
export interface AccessMember {
  userId: string;
  email: string;
  name: string | null;
  grants: AccessGrant[];
}
export type AccessPage = OffsetPage<AccessMember>;
export const getAccess = cache((page = 1, pageSize = 10, q = "") =>
  apiFetch<AccessPage>(`rbac/access?page=${page}&pageSize=${pageSize}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
);

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

export interface ScreenshotEmployeeGroup {
  employeeId: string | null;
  name: string;
  title: string | null;
  count: number;
  totalBytes: number;
  lastCapturedAt: string | null;
}
/** Gallery folders — screenshots grouped by employee (RBAC-scoped server-side). */
export const getScreenshotEmployees = cache(() =>
  apiFetch<{ items: ScreenshotEmployeeGroup[] }>("storage/screenshots/employees"),
);

export interface Screenshot {
  id: string;
  employeeId: string | null;
  employeeName: string;
  sizeBytes: number;
  contentType: string;
  capturedAt: string;
  viewUrl: string;
}
export const getScreenshots = cache((employeeId: string | undefined, page = 1, pageSize = 24) =>
  apiFetch<OffsetPage<Screenshot>>(
    `storage/screenshots?${employeeId ? `employeeId=${employeeId}&` : ""}page=${page}&pageSize=${pageSize}`,
  ),
);

export interface StorageUsage {
  usedBytes: number;
  limitBytes: number | null;
  planId: string | null;
  planName: string | null;
}
export const getStorageUsage = cache(() => apiFetch<StorageUsage>("storage/usage"));

