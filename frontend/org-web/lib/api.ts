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
  /**
   * Features resolved for THIS org — the global flag intersected with any
   * org-level override. Comes from the session (authenticated) rather than
   * /v1/config, which is public and must not leak per-org configuration.
   */
  featureFlags: Record<string, boolean>;
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

/** Live check-in/break state, shared by the web app and the desktop agent. */
export interface AttendanceLiveStatus {
  tracksAttendance: boolean;
  day: string;
  /** Derived lifecycle state; the UI renders from this + availableActions. */
  state: string;
  availableActions: ("CHECK_IN" | "CHECK_OUT" | "BREAK_START" | "BREAK_END")[];
  checkedIn: boolean;
  checkedOut: boolean;
  onBreak: boolean;
  checkInAt: string | null;
  checkOutAt: string | null;
  source: string | null;
  checkOutSource: string | null;
  workLocation: string | null;
  breakMinutes: number;
  unpaidBreakMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  openBreakStartedAt: string | null;
  openSessionStartedAt: string | null;
  workMinutes: number;
  sessionCount: number;
  breakCount: number;
  status: string | null;
  policy?: {
    allowMultipleSessions: boolean;
    allowReEntry: boolean;
    maxSessionsPerDay: number;
    allowCheckOutOnBreak: boolean;
    requireLocation: boolean;
    allowedLocations: string[];
    workModel: string;
  };
  sessions: { id: string; sequence: number; startedAt: string; endedAt: string | null; minutes: number; startSource: string; endSource: string | null; workLocation: string | null; autoClosed: boolean }[];
  breaks: { id: string; sessionId: string | null; startedAt: string; endedAt: string | null; minutes: number; kind: string; paid: boolean; source: string }[];
}
export const getAttendanceStatus = cache(() => apiFetch<AttendanceLiveStatus>("attendance/status"));

/** A request to fix a day's attendance, routed to the employee's approver. */
export interface AttendanceCorrection {
  id: string;
  employeeId: string;
  employeeName?: string | null;
  day: string;
  type: string;
  reason: string;
  requestedCheckInAt: string | null;
  requestedCheckOutAt: string | null;
  requestedOvertimeMinutes: number | null;
  status: string;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}
export const getMyCorrections = cache(() => apiFetch<AttendanceCorrection[]>("attendance/corrections/me"));
export const getPendingCorrections = cache(() => apiFetch<AttendanceCorrection[]>("attendance/corrections/pending"));

/** A day with measured overtime awaiting sign-off. */
export interface PendingOvertime {
  attendanceId: string;
  employeeId: string;
  employeeName: string | null;
  day: string;
  overtimeMinutes: number;
  workMinutes: number;
  checkInAt: string | null;
  checkOutAt: string | null;
}
export const getPendingOvertime = cache(() => apiFetch<PendingOvertime[]>("attendance/overtime/pending"));

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
  teamId: string | null;
  teamName: string | null;
  clientId: string | null;
  clientName: string | null;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  taskCount: number;
  doneCount: number;
  delayed: boolean;
}

export interface ClientRow {
  id: string;
  name: string;
  code: string | null;
  contactEmail: string | null;
  status: string;
  projectCount: number;
  createdAt: string;
}
export const getClients = cache((includeArchived = false) => apiFetch<ClientRow[]>(`clients${includeArchived ? "?includeArchived=true" : ""}`));

// ---- Payroll rates --------------------------------------------------------

export interface EmployeeRateRow {
  id: string;
  employeeId: string;
  costRateCents: number;
  billRateCents: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  current: boolean;
  note: string | null;
  createdAt: string;
}
export interface BillRateRow {
  id: string;
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  projectName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  billRateCents: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  current: boolean;
  scope: string;
  note: string | null;
}
export interface PayrollSettings {
  currency: string;
  overtimeAfterMins: number;
  overtimeMultiplier: number;
  cycleFrequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY";
  invoicePrefix: string;
  requireApproval: boolean;
}
export const getPayrollSettings = cache(() => apiFetch<PayrollSettings>("payroll/rates/settings"));
export const getBillRates = cache(() => apiFetch<BillRateRow[]>("payroll/rates/bill-rates"));

// ---- Payroll cycles -------------------------------------------------------

export interface PayrollCycleRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: "DRAFT" | "LOCKED" | "PAID";
  currency: string;
  employeeCount: number;
  totalGrossCents: number;
  runAt: string | null;
  lockedAt: string | null;
  paidAt: string | null;
  note: string | null;
}
export interface PayrollLineRow {
  employeeId: string;
  employeeName: string;
  regularMinutes: number;
  overtimeMinutes: number;
  billableMinutes: number;
  costRateCents: number | null;
  regularPayCents: number;
  overtimePayCents: number;
  grossPayCents: number;
  problem?: string;
}
export interface PayrollRun {
  id?: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  currency: string;
  requireApproval: boolean;
  runAt?: string | null;
  lockedAt?: string | null;
  totals: {
    employeeCount: number;
    regularMinutes: number;
    overtimeMinutes: number;
    billableMinutes: number;
    totalMinutes: number;
    utilization: number;
    grossPayCents: number;
    overtimePayCents: number;
  };
  lines: PayrollLineRow[];
  excluded: { employeeId: string; employeeName: string; reason: string }[];
}
export const getPayrollCycles = cache(() => apiFetch<PayrollCycleRow[]>("payroll/cycles"));

// ---- Client invoices ------------------------------------------------------

export interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  status: "DRAFT" | "SENT" | "PAID" | "VOID";
  periodStart: string;
  periodEnd: string;
  currency: string;
  totalCents: number;
  lineCount: number;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
}
export interface InvoiceLine {
  id?: string;
  projectId: string | null;
  employeeId: string | null;
  description: string;
  minutes: number;
  billRateCents: number;
  amountCents: number;
  rateSource?: string;
}
export interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  orgName: string;
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  status: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  subtotalCents: number;
  totalCents: number;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  note: string | null;
  totals: { minutes: number; lineCount: number };
  lines: InvoiceLine[];
}
export interface InvoicePreview {
  clientId: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  totals: { minutes: number; subtotalCents: number; totalCents: number; lineCount: number };
  lines: InvoiceLine[];
  skipped: string[];
}
export const getInvoices = cache(() => apiFetch<InvoiceRow[]>("payroll/invoices"));

// ---- Payroll dashboard & reports ------------------------------------------

export interface PayrollDashboard {
  currency: string;
  month: string;
  employeeCount: number;
  pendingTimesheets: number;
  approvedTimesheets: number;
  totalWorkMinutes: number;
  totalBillableMinutes: number;
  utilization: number;
  missingRates: number;
  payroll: {
    lastCycle: { id: string; periodStart: string; periodEnd: string; status: string; grossPayCents: number } | null;
    upcoming: { periodStart: string; frequency: string };
    recent: { id: string; periodStart: string; periodEnd: string; status: string; grossPayCents: number }[];
  };
  invoices: { draft: number; sent: number; outstandingCents: number; collectedCents: number };
}
export const getPayrollDashboard = cache(() => apiFetch<PayrollDashboard>("payroll/dashboard"));

export interface PayrollReport {
  from: string;
  to: string;
  currency: string;
  totals: { cycleCount: number; employeeCount: number; regularMinutes: number; overtimeMinutes: number; grossPayCents: number };
  employees: { employeeId: string; employeeName: string; regularMinutes: number; overtimeMinutes: number; grossPayCents: number; cycles: number }[];
  history: { id: string; periodStart: string; periodEnd: string; status: string; employeeCount: number; regularMinutes: number; overtimeMinutes: number; grossPayCents: number }[];
}
export const getPayrollReport = cache(() => apiFetch<PayrollReport>("payroll/reports"));
export const getProjects = cache((page = 1, pageSize = 9, status = "", q = "") =>
  apiFetch<OffsetPage<ProjectSummary>>(
    `projects?page=${page}&pageSize=${pageSize}${status ? `&status=${status}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
  ),
);

export interface ProjectDashboard {
  projects: { total: number; active: number; completed: number; delayed: number; onHold: number; planning: number };
  tasks: { total: number; pending: number; completed: number };
  teamMembers: number;
  overview: { id: string; name: string; status: string; progress: number; dueDate: string | null; delayed: boolean; ownerName: string | null }[];
}
export const getProjectDashboard = cache(() => apiFetch<ProjectDashboard>("projects/dashboard"));

export interface ProjectPerson {
  id: string;
  name: string;
  title: string | null;
  teamId: string | null;
  departmentId: string | null;
}
export const getProjectPeople = cache(() => apiFetch<ProjectPerson[]>("projects/people"));
/** The signed-in employee's own assigned tasks across all projects. */
export const getMyTasks = cache(() => apiFetch<MyTask[]>("tasks/mine"));

export interface TaskComment {
  id: string;
  body: string;
  authorUserId: string;
  authorName: string;
  createdAt: string;
}
/** A task with everything the detail page shows, including its discussion. */
export interface TaskDetail extends MyTask {
  createdAt: string;
  comments: TaskComment[];
  /** Caller manages this task's project — may edit every field. */
  canManage: boolean;
  /** Caller is the assignee — may move status even without canManage. */
  isAssignee: boolean;
}
export const getTask = cache((id: string) => apiFetch<TaskDetail>(`tasks/${id}`));

export interface ProjectTeamOption {
  id: string;
  name: string;
}
export const getProjectTeams = cache(() => apiFetch<ProjectTeamOption[]>("projects/teams"));

export interface ProjectTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeEmployeeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  updatedAt: string;
}
/** A task assigned to the current employee, carrying its parent project for context. */
export interface MyTask extends ProjectTask {
  projectId: string;
  projectName: string;
}
export interface ProjectMember {
  id: string;
  name: string;
  taskCount: number;
  isOwner: boolean;
}
export interface ProjectMilestone {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  completedAt: string | null;
  progress: number;
}
export interface ProjectGoal {
  id: string;
  projectId: string | null;
  projectName?: string | null;
  title: string;
  description: string | null;
  status: string;
  metric: string | null;
  target: number | null;
  current: number;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  progress: number;
}
export interface ProjectDetail extends ProjectSummary {
  tasks: ProjectTask[];
  members: ProjectMember[];
  recentActivity: { taskId: string; title: string; status: string; at: string }[];
  deadlines: { taskId: string; title: string; dueDate: string | null; priority: string }[];
  milestones: ProjectMilestone[];
  goals: ProjectGoal[];
  /**
   * Whether the caller may edit THIS project. Not the same as holding
   * project.write: an Owner is read-only on projects that already have an
   * assigned manager, so always trust this flag over the role's permissions.
   */
  canManage: boolean;
}
export const getProject = (id: string) => apiFetch<ProjectDetail>(`projects/${id}`);

export interface TeamOverview {
  id: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  leadEmployeeId: string | null;
  leadName: string | null;
  size: number;
  memberNames: string[];
  activeProjects: number;
  totalProjects: number;
  totalTasks: number;
  doneTasks: number;
  progress: number;
}
export const getTeamsOverview = cache(() => apiFetch<TeamOverview[]>("projects/teams-overview"));

export interface DepartmentOverview {
  id: string;
  name: string;
  status: string;
  leadEmployeeId: string | null;
  employees: number;
  teams: number;
  projects: number;
  activeProjects: number;
  totalTasks: number;
  doneTasks: number;
  productivity: number;
}
export const getDepartmentsOverview = cache(() => apiFetch<DepartmentOverview[]>("projects/departments-overview"));

export const getGoals = cache((projectId = "") => apiFetch<ProjectGoal[]>(`goals${projectId ? `?projectId=${projectId}` : ""}`));

export interface ProjectReports {
  projectRows: { id: string; name: string; owner: string; team: string; status: string; tasks: number; done: number; progress: number; dueDate: string | null; delayed: boolean }[];
  taskRows: { name: string; total: number; done: number; pending: number; overdue: number }[];
  teamRows: TeamOverview[];
  progress: { overallProgress: number; totalProjects: number; totalTasks: number; doneTasks: number; delayed: number; statusCounts: Record<string, number> };
}
export const getProjectReports = cache(() => apiFetch<ProjectReports>("projects/reports"));

export interface ManagerOverview {
  scopeLabel: string;
  teamNames: string[];
  summary: { projects: number; delayedProjects: number; openTasks: number; delayedTasks: number; upcomingMilestones: number };
  atRisk: { id: string; name: string; status: string; progress: number; delayed: boolean; dueDate: string | null; teamName: string | null }[];
  delayedTasks: { id: string; title: string; projectId: string; projectName: string | null; assignee: string | null; dueDate: string | null; priority: string }[];
  workload: { name: string; open: number }[];
  milestones: ProjectMilestone[];
}
export const getManagerOverview = cache(() => apiFetch<ManagerOverview>("projects/manager-overview"));

export interface LabelEntry {
  key: string;
  label: string;
  color: string;
}
export interface ProjectSettings {
  statuses: LabelEntry[];
  priorities: LabelEntry[];
  defaultProjectStatus: string;
  defaultTaskPriority: string;
  workflow: { requireTaskAssignee: boolean; autoCompleteProject: boolean; autoReopenProject: boolean; blockPastDueTasks: boolean };
}
export const getProjectSettings = cache(() => apiFetch<ProjectSettings>("projects/settings"));

export interface InsightsMe {
  series: { date: string; activeHours: number; productiveHours: number; idleHours: number; productivity: number; focus: number }[];
  totals: { activeHours: number; productiveHours: number; avgProductivity: number; avgFocus: number; trackedDays: number };
  momentum: { direction: string; deltaPct: number };
}
export const getInsightsMe = cache(() => apiFetch<InsightsMe>("insights/me"));

// ---- Time tracking / timesheets ----
export interface TimeEntryRow {
  id: string;
  date: string;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  minutes: number;
  billable: boolean;
  description: string | null;
  source: string;
}
export interface TimesheetWeek {
  weekStart: string;
  weekEnd: string;
  status: string;
  totalMinutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  editable: boolean;
  submittedAt: string | null;
  decidedAt: string | null;
  note: string | null;
  entries: TimeEntryRow[];
}
export const getTimesheet = cache((week?: string) => apiFetch<TimesheetWeek>(`time/timesheet${week ? `?week=${week}` : ""}`));

export type BillableGroupBy = "employee" | "team" | "project" | "client";
export interface BillableGroup {
  key: string | null;
  label: string;
  minutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  utilization: number;
}
export interface BillableSummary {
  from: string;
  to: string;
  groupBy: BillableGroupBy;
  totals: { minutes: number; billableMinutes: number; nonBillableMinutes: number; utilization: number; entryCount: number };
  groups: BillableGroup[];
}
export const getBillableSummary = (params?: { from?: string; to?: string; groupBy?: BillableGroupBy }) => {
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  if (params?.groupBy) q.set("groupBy", params.groupBy);
  const qs = q.toString();
  return apiFetch<BillableSummary>(`time/billable-summary${qs ? `?${qs}` : ""}`);
};

export interface PendingTimesheet {
  id: string;
  employeeId: string;
  employeeName: string;
  weekStart: string;
  totalMinutes: number;
  submittedAt: string | null;
}
export const getPendingTimesheets = cache(() => apiFetch<PendingTimesheet[]>("time/timesheets/pending"));

export interface TimesheetReview {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string | null;
  designation: string | null;
  weekStart: string;
  weekEnd: string;
  status: string;
  totalMinutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  submittedAt: string | null;
  decidedAt: string | null;
  note: string | null;
  days: { date: string; minutes: number; billableMinutes: number; entries: TimeEntryRow[] }[];
  byProject: { projectId: string | null; projectName: string; minutes: number; billableMinutes: number }[];
  entries: TimeEntryRow[];
}
export const getTimesheetReview = (id: string) => apiFetch<TimesheetReview>(`time/timesheets/${id}`);

export interface MyTimesheet {
  id: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  totalMinutes: number;
  entryCount: number;
  submittedAt: string | null;
  decidedAt: string | null;
  note: string | null;
}
export const getMyTimesheets = cache(() => apiFetch<MyTimesheet[]>("time/timesheets/mine"));

// ---- HR: employee profile / documents / history / org chart ----
export interface EmployeeProfile extends EmployeeRow {
  updatedAt: string;
  phone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  location: string | null;
  employmentType: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  teamName: string | null;
  manager: { id: string; name: string; title: string | null } | null;
  directReports: { id: string; name: string; title: string | null; status: string }[];
}
export const getEmployeeProfile = (id: string) => apiFetch<EmployeeProfile>(`employees/${id}`);

export interface EmploymentEventRow { id: string; type: string; title: string; detail: string | null; effectiveDate: string; createdAt: string }
export const getEmployeeHistory = (id: string) => apiFetch<EmploymentEventRow[]>(`employees/${id}/history`);

export interface EmployeeDocumentRow { id: string; category: string; fileName: string; sizeBytes: number; contentType: string; createdAt: string; viewUrl: string }
export const getEmployeeDocuments = (id: string) => apiFetch<EmployeeDocumentRow[]>(`employees/${id}/documents`);

export interface OrgChartNode { id: string; name: string; title: string | null; department: string | null; managerId: string | null; reports: OrgChartNode[] }
export const getOrgChart = cache(() => apiFetch<{ roots: OrgChartNode[]; total: number }>("employees/org-chart"));

// ---- HR: Recruitment (ATS) ----
export interface RecRequisition { id: string; title: string; departmentId: string | null; departmentName: string | null; location: string | null; employmentType: string | null; description: string | null; openings: number; status: string; candidates: number; active: number; hired: number; createdAt: string }
export const getRecRequisitions = cache(() => apiFetch<RecRequisition[]>("recruitment/requisitions"));

export interface RecCard { id: string; stage: string; rating: number | null; candidateName: string; candidateEmail: string | null; requisitionId: string; requisitionTitle: string; appliedAt: string }
export interface RecPipeline { stages: string[]; byStage: Record<string, RecCard[]>; total: number }
export const getRecruitmentPipeline = cache((requisitionId = "") => apiFetch<RecPipeline>(`recruitment/pipeline${requisitionId ? `?requisitionId=${requisitionId}` : ""}`));

export interface RecCandidate { id: string; name: string; email: string | null; phone: string | null; source: string | null; applications: number; createdAt: string }
export const getCandidates = cache(() => apiFetch<RecCandidate[]>("recruitment/candidates"));

export interface RecInterview { id: string; round: string; scheduledAt: string | null; interviewer: string | null; mode: string | null; outcome: string; rating: number | null; feedback: string | null }
export interface RecOffer { id: string; title: string | null; salary: string | null; joiningDate: string | null; status: string; sentAt: string | null; decidedAt: string | null; note: string | null }
export interface RecApplication {
  id: string; stage: string; rating: number | null; notes: string | null; rejectedReason: string | null; hiredEmployeeId: string | null; appliedAt: string;
  candidate: { id: string; name: string; email: string | null; phone: string | null; source: string | null };
  requisition: { id: string; title: string };
  interviews: RecInterview[];
  offers: RecOffer[];
}
export const getApplication = (id: string) => apiFetch<RecApplication>(`recruitment/applications/${id}`);

/* ------------------------------- Onboarding ------------------------------- */
export interface OnbTemplateSummary { id: string; name: string; isDefault: boolean; items: number; createdAt: string }
export const getOnboardingTemplates = cache(() => apiFetch<OnbTemplateSummary[]>("onboarding/templates"));

export interface OnbItem { id: string; title: string; description: string | null; category: string; assignee: string; order: number; required: boolean }
export interface OnbTemplate { id: string; name: string; isDefault: boolean; items: OnbItem[] }
export const getOnboardingTemplate = (id: string) => apiFetch<OnbTemplate>(`onboarding/templates/${id}`);

export interface OnbProgress { done: number; total: number; percent: number; requiredTotal: number; requiredDone: number }
export interface OnbOverviewRow {
  employeeId: string;
  name: string;
  title: string | null;
  joinedAt: string | null;
  journey: (OnbProgress & { id: string; status: string; startedAt: string }) | null;
}
export interface OnbOverview { rows: OnbOverviewRow[]; counts: { onboarding: number; notStarted: number; inProgress: number; completed: number } }
export const getOnboardingOverview = cache(() => apiFetch<OnbOverview>("onboarding/overview"));

export interface OnbTask { id: string; title: string; description: string | null; category: string; assignee: string; order: number; required: boolean; status: string; completedAt: string | null; note: string | null }
export interface OnbJourneyDetail {
  employee: { id: string; name: string; title: string | null; email: string | null; joinedAt: string | null; lifecycleStage: string };
  journey: (OnbProgress & { id: string; status: string; templateName: string | null; startedAt: string; completedAt: string | null; tasks: OnbTask[] }) | null;
}
export const getOnboardingJourney = (employeeId: string) => apiFetch<OnbJourneyDetail>(`onboarding/employees/${employeeId}`);

/* ------------------------------ Performance ------------------------------ */
export interface PerfCycle { id: string; name: string; status: string; periodStart: string | null; periodEnd: string | null; reviews: number; completed: number; percent: number; createdAt: string }
export const getReviewCycles = cache(() => apiFetch<PerfCycle[]>("performance/cycles"));

export interface PerfReviewRow { id: string; employeeId: string; employeeName: string; title: string | null; status: string; overallRating: number | null; competencyAvg: number | null; submittedAt: string | null }
export interface PerfCycleReviews { cycle: { id: string; name: string; status: string }; reviews: PerfReviewRow[] }
export const getCycleReviews = (cycleId: string) => apiFetch<PerfCycleReviews>(`performance/cycles/${cycleId}/reviews`);

export interface PerfRating { id: string; competency: string; score: number; comment: string | null }
export interface PerfReview {
  id: string; status: string; overallRating: number | null;
  selfAssessment: string | null; strengths: string | null; improvements: string | null; managerComment: string | null;
  submittedAt: string | null; acknowledgedAt: string | null; reviewerName: string | null;
  employee: { id: string; name: string; title: string | null; email: string | null };
  cycle: { id: string; name: string; status: string };
  ratings: PerfRating[];
  competencyOptions: string[];
}
export const getReview = (id: string) => apiFetch<PerfReview>(`performance/reviews/${id}`);

export interface PerfAchievement { id: string; title: string; description: string | null; category: string | null; awardedOn: string | null }
export interface PerfHistory {
  employee: { id: string; name: string; title: string | null };
  averageRating: number | null;
  reviews: { id: string; cycleName: string; status: string; overallRating: number | null; competencyAvg: number | null; submittedAt: string | null }[];
  achievements: PerfAchievement[];
}
export const getEmployeePerformance = (employeeId: string) => apiFetch<PerfHistory>(`performance/employees/${employeeId}`);

/* ---------------------------- HR Analytics ---------------------------- */
export interface HrDist { name: string; count: number }
export interface HrAnalyticsOverview {
  headcount: { current: number; series: { month: string; headcount: number; joins: number; exits: number }[] };
  attrition: { exits12m: number; avgHeadcount: number; ratePct: number };
  tenure: { avgMonths: number; buckets: { label: string; count: number }[] };
  distribution: { byDepartment: HrDist[]; byTeam: HrDist[]; byEmploymentType: HrDist[]; byGender: HrDist[] };
  lifecycle: { onboarding: number; probation: number; confirmed: number; exited: number };
  performance: { rated: number; avgRating: number | null; distribution: { rating: number; count: number }[]; byDepartment: { name: string; avg: number; rated: number }[] };
  onboarding: { total: number; completed: number; inProgress: number; completionPct: number; avgDaysToComplete: number | null };
}
export const getHrAnalyticsOverview = cache(() => apiFetch<HrAnalyticsOverview>("hr-analytics/overview"));

export interface TalentRiskDept { name: string; headcount: number; exits12m: number; attritionPct: number; avgTenureMonths: number; burnoutCount: number; burnoutPct: number; riskScore: number; riskLevel: string }
export interface TalentRisk {
  summary: { headcount: number; atRiskDepartments: number; burnoutEmployees: number; burnoutPct: number; trackedForActivity: number };
  departments: TalentRiskDept[];
}
export const getTalentRisk = cache(() => apiFetch<TalentRisk>("hr-analytics/talent-risk"));

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

export interface LeaveCalendar {
  month: string;
  workingDays: number[];
  shiftName: string | null;
  holidays: { date: string; name: string; type: string }[];
  leaves: { date: string; status: string; typeName: string; code: string; color: string | null }[];
}

export interface OrgLeaveEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  typeName: string;
  code: string;
  color: string | null;
}
export interface OrgLeaveCalendar {
  month: string;
  holidays: { date: string; name: string; type: string }[];
  entries: OrgLeaveEntry[];
}

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
  screenshotRetentionDays: number;
}
export const getMonitoringPolicy = cache(() => apiFetch<MonitoringPolicy>("monitoring/policy"));

export interface ProductivityRulesData {
  productiveApps: string[];
  productiveDomains: string[];
  distractingApps: string[];
  distractingDomains: string[];
  customized: boolean;
  updatedAt: string | null;
}
export const getProductivityRules = cache(() => apiFetch<ProductivityRulesData>("productivity/rules"));

export interface OrgRole {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  permissionCount: number;
  assignedCount: number;
}
export const getRoles = cache(() => apiFetch<OrgRole[]>("rbac/roles"));

/** The plain-language list of things a role can be allowed to do, grouped by area. */
export interface PermissionOption {
  key: string;
  label: string;
  hint: string;
}
export interface PermissionGroup {
  group: string;
  items: PermissionOption[];
}
export const getPermissionCatalog = cache(() => apiFetch<PermissionGroup[]>("rbac/permissions"));

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
  category: string;
  priority: string;
  link: string | null;
  status: string;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}
export interface InboxFilters {
  category?: string;
  priority?: string;
  unread?: boolean;
  archived?: boolean;
  q?: string;
}
function inboxQuery(page: number, pageSize: number, f: InboxFilters = {}): string {
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (f.category) qs.set("category", f.category);
  if (f.priority) qs.set("priority", f.priority);
  if (f.unread) qs.set("unread", "true");
  if (f.archived) qs.set("archived", "true");
  if (f.q?.trim()) qs.set("q", f.q.trim());
  return qs.toString();
}
export const getNotifications = cache((page = 1, pageSize = 10, filters: InboxFilters = {}) =>
  apiFetch<OffsetPage<InboxNotification>>(`notifications?${inboxQuery(page, pageSize, filters)}`),
);

export interface NotificationStats {
  total: number;
  unread: number;
  critical: number;
  archived: number;
  categories: Record<string, number>;
}
export const getNotificationStats = cache(() => apiFetch<NotificationStats>("notifications/stats"));

export interface NotificationPreference { category: string; inApp: boolean; email: boolean; push: boolean }
export interface NotificationSettings {
  quietHoursEnabled: boolean;
  quietStart: number;
  quietEnd: number;
  timezone: string;
  digest: string;
  digestHour: number;
}
export interface NotificationPrefsPayload { preferences: NotificationPreference[]; settings: NotificationSettings }
export const getNotificationPreferences = cache(() => apiFetch<NotificationPrefsPayload>("notifications/preferences"));

export interface OrgFeedItem {
  id: string;
  type: string;
  title: string;
  body: string;
  category: string;
  priority: string;
  link: string | null;
  status: string;
  read: boolean;
  recipientName: string;
  recipientRole: string;
  createdAt: string;
}
export interface OrgFeed {
  items: OrgFeedItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: { categories: Record<string, number>; priorities: Record<string, number> };
}
export const getNotificationOrgFeed = cache((page = 1, pageSize = 20) =>
  apiFetch<OrgFeed>(`notifications/org-feed?page=${page}&pageSize=${pageSize}`),
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

