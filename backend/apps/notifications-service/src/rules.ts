export type Channel = "IN_APP" | "EMAIL" | "PUSH";
export type Audience = "owner" | "org-admins" | "approvers" | "requester" | "approver" | "assignee";
export type Category = "ATTENDANCE" | "PRODUCTIVITY" | "PROJECT" | "AI" | "SYSTEM";
export type Priority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export type NotificationSpec = {
  type: string;
  audience: Audience;
  category: Category;
  priority: Priority;
  /** Channels this event may use. Per-user preferences narrow this further. */
  channels: Channel[];
  title: (payload: Record<string, unknown>) => string;
  body: (payload: Record<string, unknown>) => string;
  /** Optional deep link into the app. */
  link?: (payload: Record<string, unknown>) => string | null;
};

/**
 * Code-based rule registry: domain event type -> notification specs. This is
 * the seam for a future DB-backed, org-configurable rules engine; the consumer
 * doesn't care where rules come from.
 *
 * `channels` is the *maximum* set a rule may fan out to; the worker intersects
 * it with the recipient's per-category preferences before dispatching.
 */
const RULES: Record<string, NotificationSpec[]> = {
  "org.registered": [
    {
      type: "welcome",
      audience: "owner",
      category: "SYSTEM",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: () => "Welcome to RetainIQ",
      body: (p) => `Your organization ${str(p.orgName, "your org")} is ready to go.`,
    },
  ],
  "employee.created": [
    {
      type: "employee.created",
      audience: "org-admins",
      category: "SYSTEM",
      priority: "LOW",
      channels: ["IN_APP"],
      title: () => "New employee added",
      body: (p) => `${str(p.firstName, "An employee")} ${str(p.lastName, "")}`.trim() + " was added to your organization.",
      link: () => "/employees",
    },
  ],

  // ---- Attendance ----
  "leave.requested": [
    {
      type: "leave.requested",
      audience: "approvers", // owner / managers / HR — whoever can approve leave
      category: "ATTENDANCE",
      priority: "HIGH",
      channels: ["IN_APP", "EMAIL", "PUSH"],
      title: () => "New leave request",
      body: (p) =>
        `${str(p.employeeName, "An employee")} requested ${Number(p.days) || "some"} day(s) of ${str(p.leaveTypeName, "leave")} (${str(p.startDate, "")} → ${str(p.endDate, "")}).`,
      link: () => "/leave",
    },
  ],
  "leave.decided": [
    {
      type: "leave.decided",
      audience: "requester", // the employee who applied
      category: "ATTENDANCE",
      priority: "HIGH",
      channels: ["IN_APP", "EMAIL", "PUSH"],
      title: (p) => (str(p.status, "") === "APPROVED" ? "Leave approved" : "Leave rejected"),
      body: (p) =>
        `Your ${str(p.leaveTypeName, "leave")} (${str(p.startDate, "")} → ${str(p.endDate, "")}) was ${str(p.status, "updated").toLowerCase()}.`,
      link: () => "/leave",
    },
  ],
  "leave.cancelled": [
    {
      type: "leave.cancelled",
      audience: "approver", // only the manager who approved it, carried on the event
      category: "ATTENDANCE",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: () => "Leave cancelled",
      body: (p) =>
        `${str(p.employeeName, "An employee")} cancelled their approved ${str(p.leaveTypeName, "leave")} (${str(p.startDate, "")} → ${str(p.endDate, "")}).`,
      link: () => "/leave",
    },
  ],
  "attendance.missed_checkin": [
    {
      type: "attendance.missed_checkin",
      audience: "requester",
      category: "ATTENDANCE",
      priority: "NORMAL",
      channels: ["IN_APP", "PUSH"],
      title: () => "You haven't checked in",
      body: (p) => `No check-in recorded for ${str(p.day, "today")}. Check in from the Attendance page.`,
      link: () => "/attendance",
    },
  ],
  "attendance.missed_checkout": [
    {
      type: "attendance.missed_checkout",
      audience: "requester",
      category: "ATTENDANCE",
      priority: "NORMAL",
      channels: ["IN_APP", "PUSH"],
      title: () => "You forgot to check out",
      body: (p) => `Your session on ${str(p.day, "the previous day")} was never closed.`,
      link: () => "/attendance",
    },
  ],
  "attendance.correction_requested": [
    {
      type: "attendance.correction_requested",
      audience: "approver", // their manager, or the Owner when they have none
      category: "ATTENDANCE",
      priority: "HIGH",
      channels: ["IN_APP", "EMAIL"],
      title: () => "Attendance correction to review",
      body: (p) => `${str(p.employeeName, "An employee")} raised a ${str(p.correctionType, "correction").replace(/_/g, " ").toLowerCase()} request.`,
      link: () => "/attendance",
    },
  ],
  "attendance.correction_decided": [
    {
      type: "attendance.correction_decided",
      audience: "requester",
      category: "ATTENDANCE",
      priority: "HIGH",
      channels: ["IN_APP", "EMAIL"],
      title: (p) => (str(p.status, "") === "APPROVED" ? "Attendance correction approved" : "Attendance correction rejected"),
      body: (p) => `Your attendance correction was ${str(p.status, "updated").toLowerCase()}.`,
      link: () => "/attendance",
    },
  ],
  "attendance.auto_checked_out": [
    {
      type: "attendance.auto_checked_out",
      audience: "requester",
      category: "ATTENDANCE",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: () => "We checked you out",
      body: (p) =>
        `You didn't check out, so your day was closed at ${str(p.endedAt, "your shift end").slice(11, 16)} — the later of your last activity or shift end. Overtime isn't counted on auto-closed days.`,
      link: () => "/attendance",
    },
  ],
  "attendance.late_arrival": [
    {
      type: "attendance.late_arrival",
      audience: "approvers",
      category: "ATTENDANCE",
      priority: "LOW",
      channels: ["IN_APP"],
      title: () => "Late arrival",
      body: (p) => `${str(p.employeeName, "An employee")} checked in late on ${str(p.day, "today")}.`,
      link: () => "/attendance",
    },
  ],
  "observation.created": [
    {
      type: "observation.created",
      audience: "requester", // the manager the observation routed to (requesterUserId)
      category: "ATTENDANCE",
      priority: "HIGH",
      channels: ["IN_APP", "EMAIL"],
      title: () => "New observation to review",
      body: (p) => `${str(p.title, "An issue")} — ${str(p.employeeName, "an employee")}. Review it in Observations.`,
      link: () => "/observations",
    },
  ],
  "observation.resolved": [
    {
      type: "observation.resolved",
      audience: "requester",
      category: "ATTENDANCE",
      priority: "NORMAL",
      channels: ["IN_APP"],
      title: () => "Observation resolved",
      body: (p) => `${str(p.title, "An observation")} was resolved.`,
      link: () => "/observations",
    },
  ],
  "escalation.created": [
    {
      type: "escalation.created",
      audience: "requester", // the level-N authority (requesterUserId)
      category: "ATTENDANCE",
      priority: "HIGH",
      channels: ["IN_APP", "EMAIL"],
      title: (p) => `Escalation — ${str(p.levelLabel, "review needed")}`,
      body: (p) => `${str(p.title, "An issue")} (${str(p.severity, "").toLowerCase()}) was escalated to you${p.auto ? " automatically (SLA elapsed)" : ""}. Review it in Observations.`,
      link: () => "/observations",
    },
  ],
  "incident.opened": [
    {
      type: "incident.opened",
      audience: "requester", // the assigned investigator (requesterUserId)
      category: "SYSTEM",
      priority: "HIGH",
      channels: ["IN_APP", "EMAIL"],
      title: (p) => `Incident opened — ${str(p.reference, "")}`,
      body: (p) => `${str(p.title, "A case")} (${str(p.severity, "").toLowerCase()}) was assigned to you for investigation.`,
      link: () => "/incidents",
    },
  ],
  "incident.resolved": [
    {
      type: "incident.resolved",
      audience: "requester",
      category: "SYSTEM",
      priority: "NORMAL",
      channels: ["IN_APP"],
      title: (p) => `Incident resolved — ${str(p.reference, "")}`,
      body: (p) => `${str(p.title, "A case")} was resolved.`,
      link: () => "/incidents",
    },
  ],
  "report.ready": [
    {
      type: "report.ready",
      audience: "requester", // the person who requested the async report
      category: "SYSTEM",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: (p) => `Your ${str(p.kind, "report")} report is ready`,
      body: (p) => `${str(p.fileName, "The report")} (${Number(p.rows) || 0} rows) has finished generating. Download it from Reports.`,
      link: (p) => str(p.link, "/reports"),
    },
  ],
  "report.scheduled": [
    {
      type: "report.scheduled",
      audience: "requester", // the specific manager who set the schedule up
      category: "ATTENDANCE",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: (p) => str(p.title, "Your attendance report"),
      body: (p) => `${linesOf(p.summaryLines)}\n\nThe full report is attached as a CSV.`,
      link: (p) => str(p.link, "/attendance"),
    },
  ],
  // A payslip was published (released) to the employee — they can now view/download it.
  "payroll.statement.published": [
    {
      type: "payroll.statement.published",
      audience: "requester", // the employee whose payslip it is (requesterUserId)
      category: "SYSTEM",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: (p) => `Payslip ready — ${str(p.period, "this period")}`,
      body: (p) => `Your payslip for ${str(p.period, "this period")} is now available to view and download${str(p.currencyCode, "") ? ` (net ${str(p.currencyCode, "")} ${Number(p.netAmount) || 0}).` : "."}`,
      link: () => "/payslips",
    },
  ],
  // A platform admin approved or rejected the org's seat/plan change request.
  "subscription.change_decided": [
    {
      type: "subscription.change_decided",
      audience: "org-admins", // Owner / Admin / HR — whoever manages billing
      category: "SYSTEM",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: (p) => (str(p.outcome, "") === "approved" ? "Seat change approved" : "Seat change declined"),
      body: (p) =>
        str(p.outcome, "") === "approved"
          ? `Your subscription change (${Number(p.fromSeats) || 0} → ${Number(p.toSeats) || 0} seats) was approved and is now active.`
          : `Your subscription change request (${Number(p.fromSeats) || 0} → ${Number(p.toSeats) || 0} seats) was declined.`,
      link: () => "/billing",
    },
  ],
  "certification.expiring": [
    {
      type: "certification.expiring",
      audience: "requester", // the employee's manager (or an org admin), via requesterUserId
      category: "SYSTEM",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: (p) => `Certification expiring: ${str(p.certName, "a certification")}`,
      body: (p) => `${str(p.employeeName, "An employee")}'s "${str(p.certName, "certification")}" expires in ${Number(p.daysLeft) || 0} day(s) (on ${str(p.expiresAt, "the listed date")}). Review it on their profile.`,
      link: (p) => `/employees/${str(p.employeeId, "")}`,
    },
  ],
  // A promotion/transfer approval is waiting on this approver.
  "employee.change_approval_pending": [
    {
      type: "employee.change_approval_pending",
      audience: "requester", // the assigned approver, via requesterUserId
      category: "SYSTEM",
      priority: "HIGH",
      channels: ["IN_APP", "EMAIL"],
      title: (p) => `${cap(str(p.kind, "change"))} approval needed`,
      body: (p) => `A ${str(p.kind, "change").toLowerCase()} request is awaiting your approval.`,
      link: () => "/employees",
    },
  ],
  // The requester learns their promotion/transfer was rejected/scheduled/applied.
  "employee.change_decided": [
    {
      type: "employee.change_decided",
      audience: "requester",
      category: "SYSTEM",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: (p) => `${cap(str(p.kind, "change"))} ${str(p.outcome, "updated")}`,
      body: (p) => `The ${str(p.kind, "change").toLowerCase()} request you raised has been ${str(p.outcome, "updated")}.`,
      link: () => "/employees",
    },
  ],
  // The employee (and org) is notified when a promotion/transfer takes effect.
  "employee.promoted": [
    {
      type: "employee.promoted",
      audience: "requester",
      category: "SYSTEM",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: () => "Promotion applied",
      body: (p) => `A promotion took effect${str(p.effectiveDate, "") ? ` on ${str(p.effectiveDate, "")}` : ""}.`,
      link: (p) => `/employees/${str(p.employeeId, "")}`,
    },
  ],
  "employee.transferred": [
    {
      type: "employee.transferred",
      audience: "requester",
      category: "SYSTEM",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: () => "Transfer applied",
      body: (p) => `A transfer took effect${str(p.effectiveDate, "") ? ` on ${str(p.effectiveDate, "")}` : ""}.`,
      link: (p) => `/employees/${str(p.employeeId, "")}`,
    },
  ],
  // Exit initiated — HR/org-admins should track the offboarding.
  "employee.exit_started": [
    {
      type: "employee.exit_started",
      audience: "org-admins",
      category: "SYSTEM",
      priority: "HIGH",
      channels: ["IN_APP", "EMAIL"],
      title: () => "Employee exit initiated",
      body: (p) => `An exit process has started (${str(p.reason, "reason not given").toLowerCase().replace(/_/g, " ")}). Offboarding checklist is ready.`,
      link: (p) => `/employees/${str(p.employeeId, "")}`,
    },
  ],
  // Exit completed — the employee has left.
  "employee.exited": [
    {
      type: "employee.exited",
      audience: "org-admins",
      category: "SYSTEM",
      priority: "NORMAL",
      channels: ["IN_APP"],
      title: () => "Employee exited",
      body: (p) => `An employee has completed their exit (${str(p.reason, "reason not given").toLowerCase().replace(/_/g, " ")}) and moved to alumni.`,
      link: () => "/employees",
    },
  ],
  // Probation is ending soon — the manager should run a review.
  "probation.ending": [
    {
      type: "probation.ending",
      audience: "requester", // the employee's manager (or admin), via requesterUserId
      category: "SYSTEM",
      priority: "HIGH",
      channels: ["IN_APP", "EMAIL"],
      title: (p) => `Probation review due: ${str(p.employeeName, "an employee")}`,
      body: (p) => `${str(p.employeeName, "An employee")}'s probation ends in ${Number(p.daysLeft) || 0} day(s) (on ${str(p.endDate, "the listed date")}). Complete their probation review.`,
      link: (p) => `/employees/${str(p.employeeId, "")}`,
    },
  ],
  // Recognition — the recognised employee is congratulated.
  "recognition.created": [
    {
      type: "recognition.created",
      audience: "requester", // the recognised employee, via requesterUserId
      category: "SYSTEM",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: (p) => `You've been recognised: ${str(p.title, "an award")}`,
      body: (p) => `You received recognition (${str(p.category, "award").toLowerCase()}): "${str(p.title, "")}". It's on your profile.`,
      link: (p) => `/employees/${str(p.employeeId, "")}`,
    },
  ],
  // Employee confirmed as permanent.
  "employee.confirmed": [
    {
      type: "employee.confirmed",
      audience: "requester",
      category: "SYSTEM",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: () => "Employee confirmed",
      body: () => "A probation review was completed and the employee is now confirmed as permanent.",
      link: (p) => `/employees/${str(p.employeeId, "")}`,
    },
  ],

  // ---- Projects ----
  "timesheet.submitted": [
    {
      type: "timesheet.submitted",
      audience: "approvers",
      category: "PROJECT",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: () => "Timesheet submitted",
      body: (p) => `${str(p.employeeName, "An employee")} submitted a timesheet for the week of ${str(p.weekStart, "")} (${hoursOf(p.totalMinutes)}).`,
      link: () => "/time",
    },
  ],
  "timesheet.decided": [
    {
      type: "timesheet.decided",
      audience: "requester",
      category: "PROJECT",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: (p) => (str(p.status, "") === "APPROVED" ? "Timesheet approved" : "Timesheet rejected"),
      body: (p) => `Your timesheet for the week of ${str(p.weekStart, "")} was ${str(p.status, "updated").toLowerCase()}.`,
      link: () => "/time",
    },
  ],
  "task.assigned": [
    {
      type: "task.assigned",
      audience: "assignee",
      category: "PROJECT",
      priority: "HIGH",
      channels: ["IN_APP", "EMAIL", "PUSH"],
      title: () => "New task assigned",
      body: (p) => `${str(p.assignerName, "Someone")} assigned you "${str(p.taskTitle, "a task")}"${p.projectName ? ` in ${str(p.projectName, "")}` : ""}.`,
      link: (p) => (p.projectId ? `/projects/${str(p.projectId, "")}` : "/tasks"),
    },
  ],
  "task.due_soon": [
    {
      type: "task.due_soon",
      audience: "assignee",
      category: "PROJECT",
      priority: "NORMAL",
      channels: ["IN_APP", "PUSH"],
      title: () => "Task due soon",
      body: (p) => `"${str(p.taskTitle, "A task")}" is due ${str(p.dueDate, "soon")}.`,
      link: (p) => (p.projectId ? `/projects/${str(p.projectId, "")}` : "/tasks"),
    },
  ],
  "task.overdue": [
    {
      type: "task.overdue",
      audience: "assignee",
      category: "PROJECT",
      priority: "HIGH",
      channels: ["IN_APP", "EMAIL", "PUSH"],
      title: () => "Task overdue",
      body: (p) => `"${str(p.taskTitle, "A task")}" was due ${str(p.dueDate, "earlier")} and is still open.`,
      link: (p) => (p.projectId ? `/projects/${str(p.projectId, "")}` : "/tasks"),
    },
  ],
  "milestone.completed": [
    {
      type: "milestone.completed",
      audience: "org-admins",
      category: "PROJECT",
      priority: "NORMAL",
      channels: ["IN_APP"],
      title: () => "Milestone completed",
      body: (p) => `"${str(p.milestoneTitle, "A milestone")}" was completed${p.projectName ? ` in ${str(p.projectName, "")}` : ""}.`,
      link: (p) => (p.projectId ? `/projects/${str(p.projectId, "")}` : "/projects"),
    },
  ],

  // ---- Productivity / AI ----
  "productivity.drop": [
    {
      type: "productivity.drop",
      audience: "approvers",
      category: "PRODUCTIVITY",
      priority: "NORMAL",
      channels: ["IN_APP", "EMAIL"],
      title: () => "Productivity drop detected",
      body: (p) => `${str(p.employeeName, "An employee")}'s productivity fell to ${Number(p.current) || 0}% (was ${Number(p.previous) || 0}%).`,
      link: () => "/insights",
    },
  ],
  "ai.recommendation": [
    {
      type: "ai.recommendation",
      audience: "approvers",
      category: "AI",
      priority: "NORMAL",
      channels: ["IN_APP"],
      title: (p) => str(p.title, "AI recommendation"),
      body: (p) => str(p.body, "A new workforce recommendation is available."),
      link: () => "/insights",
    },
  ],
};

function hoursOf(v: unknown): string {
  const min = Number(v) || 0;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** Join a payload's string[] summary lines into a notification body. */
function linesOf(v: unknown): string {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join("\n");
  return typeof v === "string" ? v : "Your scheduled attendance report is ready.";
}

export function rulesFor(eventType: string): NotificationSpec[] {
  return RULES[eventType] ?? [];
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Title-case a single word (e.g. "PROMOTION" → "Promotion"). */
function cap(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1).toLowerCase();
}
