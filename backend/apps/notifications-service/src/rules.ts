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

export function rulesFor(eventType: string): NotificationSpec[] {
  return RULES[eventType] ?? [];
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
