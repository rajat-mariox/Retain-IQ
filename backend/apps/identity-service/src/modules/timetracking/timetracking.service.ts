import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { ApprovalService } from "../../common/approval/approval.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { OrgRolesService } from "../../common/org-roles/org-roles.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";

function parseDate(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid date.");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

/** Monday (UTC) of the week containing `d`. */
function weekStartOf(d: Date): Date {
  const backToMonday = (d.getUTCDay() + 6) % 7; // Sun→6, Mon→0…
  return addDays(d, -backToMonday);
}

@Injectable()
export class TimeTrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly approval: ApprovalService,
    private readonly accessScope: AccessScopeService,
    private readonly orgRoles: OrgRolesService,
  ) {}

  private async callerEmployeeId(): Promise<string> {
    const ctx = requireTenantContext();
    const m = await this.prisma.organizationMembership.findUnique({ where: { id: ctx.membershipId }, select: { employeeId: true } });
    if (!m?.employeeId) throw new BadRequestException("Your account is not linked to an employee record.");
    return m.employeeId;
  }

  /**
   * The caller's employee id for a SELF-SERVICE write (logging time, submitting a
   * timesheet). The Owner runs the org rather than staffing it — their hours would
   * flow into payroll and reports as if they were an employee — so they're kept
   * out of these flows entirely.
   */
  private async callerAsStaff(): Promise<string> {
    const ctx = requireTenantContext();
    const employeeId = await this.callerEmployeeId();
    if (await this.orgRoles.isOwnerEmployee(ctx.orgId, employeeId)) {
      throw new ForbiddenException("Timesheets are for the organization's staff. As the owner, you review and approve them rather than filing your own.");
    }
    return employeeId;
  }

  /** A week is locked for editing once its timesheet is submitted or approved. */
  private async weekLocked(orgId: string, employeeId: string, weekStart: Date): Promise<boolean> {
    const ts = await this.prisma.timesheet.findUnique({ where: { orgId_employeeId_weekStart: { orgId, employeeId, weekStart } }, select: { status: true } });
    return ts?.status === "SUBMITTED" || ts?.status === "APPROVED";
  }

  private async projectNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(rows.map((p) => [p.id, p.name]));
  }
  private async taskTitles(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.task.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
    return new Map(rows.map((t) => [t.id, t.title]));
  }

  private async serializeEntries(rows: { id: string; date: Date; projectId: string | null; taskId: string | null; minutes: number; billable: boolean; description: string | null; source: string }[]) {
    const projects = await this.projectNames([...new Set(rows.map((r) => r.projectId).filter((x): x is string => Boolean(x)))]);
    const tasks = await this.taskTitles([...new Set(rows.map((r) => r.taskId).filter((x): x is string => Boolean(x)))]);
    return rows.map((r) => ({
      id: r.id,
      date: iso(r.date),
      projectId: r.projectId,
      projectName: r.projectId ? (projects.get(r.projectId) ?? null) : null,
      taskId: r.taskId,
      taskTitle: r.taskId ? (tasks.get(r.taskId) ?? null) : null,
      minutes: r.minutes,
      billable: r.billable,
      description: r.description,
      source: r.source,
    }));
  }

  /** The caller's timesheet for a week: status, per-day entries, total, editability. */
  async getTimesheet(weekStr?: string) {
    const ctx = requireTenantContext();
    const employeeId = await this.callerEmployeeId();
    const weekStart = weekStartOf(weekStr ? parseDate(weekStr) : new Date());
    const weekEnd = addDays(weekStart, 7); // exclusive

    const [rows, ts] = await Promise.all([
      this.prisma.timeEntry.findMany({ where: { orgId: ctx.orgId, employeeId, date: { gte: weekStart, lt: weekEnd } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
      this.prisma.timesheet.findUnique({ where: { orgId_employeeId_weekStart: { orgId: ctx.orgId, employeeId, weekStart } } }),
    ]);
    const entries = await this.serializeEntries(rows);
    const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
    const billableMinutes = rows.reduce((s, r) => s + (r.billable ? r.minutes : 0), 0);
    const status = ts?.status ?? "DRAFT";

    return {
      weekStart: iso(weekStart),
      weekEnd: iso(addDays(weekStart, 6)),
      status,
      totalMinutes,
      billableMinutes,
      nonBillableMinutes: totalMinutes - billableMinutes,
      editable: status !== "SUBMITTED" && status !== "APPROVED",
      submittedAt: ts?.submittedAt ? ts.submittedAt.toISOString() : null,
      decidedAt: ts?.decidedAt ? ts.decidedAt.toISOString() : null,
      note: ts?.note ?? null,
      entries,
    };
  }

  async createEntry(input: { date: string; projectId?: string | null; taskId?: string | null; minutes: number; billable?: boolean; description?: string }) {
    const ctx = requireTenantContext();
    const employeeId = await this.callerAsStaff();
    const date = parseDate(input.date);
    if (await this.weekLocked(ctx.orgId, employeeId, weekStartOf(date))) throw new ConflictException("This week's timesheet is submitted and locked.");
    if (input.projectId) {
      const p = await this.prisma.project.findFirst({ where: { id: input.projectId, orgId: ctx.orgId }, select: { id: true } });
      if (!p) throw new NotFoundException("Project not found.");
    }
    const row = await this.prisma.timeEntry.create({
      data: {
        orgId: ctx.orgId,
        employeeId,
        date,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        minutes: input.minutes,
        billable: input.billable ?? true,
        description: input.description?.trim() || null,
        source: "MANUAL",
      },
    });
    return (await this.serializeEntries([row]))[0];
  }

  async updateEntry(id: string, input: { date?: string; projectId?: string | null; taskId?: string | null; minutes?: number; billable?: boolean; description?: string }) {
    const ctx = requireTenantContext();
    const employeeId = await this.callerAsStaff();
    const entry = await this.prisma.timeEntry.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!entry) throw new NotFoundException("Time entry not found.");
    if (entry.employeeId !== employeeId) throw new ForbiddenException("You can only edit your own time entries.");
    if (await this.weekLocked(ctx.orgId, employeeId, weekStartOf(entry.date))) throw new ConflictException("This week's timesheet is locked.");

    const data: Record<string, unknown> = {};
    if (input.date !== undefined) data.date = parseDate(input.date);
    if (input.projectId !== undefined) data.projectId = input.projectId;
    if (input.taskId !== undefined) data.taskId = input.taskId;
    if (input.minutes !== undefined) data.minutes = input.minutes;
    if (input.billable !== undefined) data.billable = input.billable;
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    const row = await this.prisma.timeEntry.update({ where: { id: entry.id }, data });
    return (await this.serializeEntries([row]))[0];
  }

  async deleteEntry(id: string) {
    const ctx = requireTenantContext();
    const employeeId = await this.callerAsStaff();
    const entry = await this.prisma.timeEntry.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!entry) throw new NotFoundException("Time entry not found.");
    if (entry.employeeId !== employeeId) throw new ForbiddenException("You can only delete your own time entries.");
    if (await this.weekLocked(ctx.orgId, employeeId, weekStartOf(entry.date))) throw new ConflictException("This week's timesheet is locked.");
    await this.prisma.timeEntry.delete({ where: { id: entry.id } });
    return { id: entry.id, deleted: true };
  }

  async submit(weekStr?: string) {
    const ctx = requireTenantContext();
    const employeeId = await this.callerAsStaff();
    const weekStart = weekStartOf(weekStr ? parseDate(weekStr) : new Date());
    const weekEnd = addDays(weekStart, 7);

    const agg = await this.prisma.timeEntry.aggregate({ where: { orgId: ctx.orgId, employeeId, date: { gte: weekStart, lt: weekEnd } }, _sum: { minutes: true }, _count: { _all: true } });
    if ((agg._count._all ?? 0) === 0) throw new BadRequestException("Add at least one time entry before submitting.");
    const existing = await this.prisma.timesheet.findUnique({ where: { orgId_employeeId_weekStart: { orgId: ctx.orgId, employeeId, weekStart } } });
    if (existing && (existing.status === "SUBMITTED" || existing.status === "APPROVED")) throw new ConflictException("This timesheet is already submitted.");

    const totalMinutes = agg._sum.minutes ?? 0;
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { firstName: true, lastName: true } });
    const employeeName = employee ? `${employee.firstName} ${employee.lastName}`.trim() : "An employee";

    return this.prisma.$transaction(async (tx) => {
      const ts = await tx.timesheet.upsert({
        where: { orgId_employeeId_weekStart: { orgId: ctx.orgId, employeeId, weekStart } },
        create: { orgId: ctx.orgId, employeeId, weekStart, status: "SUBMITTED", totalMinutes, submittedAt: new Date() },
        update: { status: "SUBMITTED", totalMinutes, submittedAt: new Date(), decidedAt: null, decidedBy: null, note: null },
      });
      await this.outbox.enqueue(tx, {
        eventType: "timesheet.submitted",
        aggregateType: "timesheet",
        aggregateId: ts.id,
        orgId: ctx.orgId,
        payload: { timesheetId: ts.id, employeeId, employeeName, weekStart: iso(weekStart), totalMinutes },
      });
      return ts;
    });
  }

  /**
   * The caller's own timesheet history across weeks — one row per week.
   * Submitted/approved/rejected weeks come from Timesheet rows; weeks that have
   * entries but were never submitted are synthesized as DRAFT.
   */
  async mine() {
    const ctx = requireTenantContext();
    const employeeId = await this.callerEmployeeId();
    const [timesheets, entries] = await Promise.all([
      this.prisma.timesheet.findMany({ where: { orgId: ctx.orgId, employeeId }, orderBy: { weekStart: "desc" } }),
      this.prisma.timeEntry.findMany({ where: { orgId: ctx.orgId, employeeId }, select: { date: true, minutes: true } }),
    ]);

    // Bucket entries by their week for live totals + counts (and to find drafts).
    const buckets = new Map<string, { minutes: number; count: number }>();
    for (const e of entries) {
      const w = iso(weekStartOf(e.date));
      const b = buckets.get(w) ?? { minutes: 0, count: 0 };
      b.minutes += e.minutes;
      b.count += 1;
      buckets.set(w, b);
    }

    const rows = timesheets.map((t) => {
      const w = iso(t.weekStart);
      const b = buckets.get(w);
      return {
        id: t.id,
        weekStart: w,
        weekEnd: iso(addDays(t.weekStart, 6)),
        status: t.status,
        totalMinutes: b ? b.minutes : t.totalMinutes,
        entryCount: b?.count ?? 0,
        submittedAt: t.submittedAt ? t.submittedAt.toISOString() : null,
        decidedAt: t.decidedAt ? t.decidedAt.toISOString() : null,
        note: t.note ?? null,
      };
    });

    const submittedWeeks = new Set(rows.map((r) => r.weekStart));
    for (const [w, b] of buckets) {
      if (submittedWeeks.has(w)) continue;
      rows.push({
        id: `draft:${w}`,
        weekStart: w,
        weekEnd: iso(addDays(parseDate(w), 6)),
        status: "DRAFT",
        totalMinutes: b.minutes,
        entryCount: b.count,
        submittedAt: null,
        decidedAt: null,
        note: null,
      });
    }

    rows.sort((a, b) => (a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0));
    return rows;
  }

  /** Submitted timesheets awaiting decision (managers/admins). */
  async pending() {
    const ctx = requireTenantContext();
    // Scope to the caller's queue: an Owner sees every submission, a manager
    // only their direct reports'. Returning others' would tease an approve button
    // the decide() guard then rejects.
    const approvable = await this.approval.approvableEmployeeIds();
    const where = { orgId: ctx.orgId, status: "SUBMITTED" as const, ...(approvable ? { employeeId: { in: approvable } } : {}) };
    const rows = await this.prisma.timesheet.findMany({ where, orderBy: { submittedAt: "asc" }, take: 200 });
    const names = new Map<string, string>();
    if (rows.length) {
      const emps = await this.prisma.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, firstName: true, lastName: true } });
      for (const e of emps) names.set(e.id, `${e.firstName} ${e.lastName}`.trim());
    }
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: names.get(r.employeeId) ?? "Unknown",
      weekStart: iso(r.weekStart),
      totalMinutes: r.totalMinutes,
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    }));
  }

  /** Full detail of a single timesheet for an approver to review before deciding. */
  async review(id: string) {
    const ctx = requireTenantContext();
    const ts = await this.prisma.timesheet.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!ts) throw new NotFoundException("Timesheet not found.");
    // Reviewing is the read half of approving — same reach as decide().
    const reach = await this.approval.approvableEmployeeIds();
    if (reach !== null && !reach.includes(ts.employeeId)) throw new NotFoundException("Timesheet not found.");
    const weekStart = ts.weekStart;
    const weekEnd = addDays(weekStart, 7); // exclusive

    const [rows, employee] = await Promise.all([
      this.prisma.timeEntry.findMany({ where: { orgId: ctx.orgId, employeeId: ts.employeeId, date: { gte: weekStart, lt: weekEnd } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
      this.prisma.employee.findUnique({ where: { id: ts.employeeId }, select: { firstName: true, lastName: true, email: true, title: true, designationRef: { select: { title: true } } } }),
    ]);
    const entries = await this.serializeEntries(rows);
    const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
    const billableMinutes = rows.reduce((s, r) => s + (r.billable ? r.minutes : 0), 0);

    // Per-day rollup across the Mon→Sun week (7 rows, zero-filled).
    const days = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i);
      const dayEntries = entries.filter((e) => e.date === iso(day));
      return {
        date: iso(day),
        minutes: dayEntries.reduce((s, e) => s + e.minutes, 0),
        billableMinutes: dayEntries.reduce((s, e) => s + (e.billable ? e.minutes : 0), 0),
        entries: dayEntries,
      };
    });

    // Project breakdown (unassigned bucketed under null), split billable/non-billable.
    const projMap = new Map<string, { projectId: string | null; projectName: string; minutes: number; billableMinutes: number }>();
    for (const e of entries) {
      const key = e.projectId ?? "__none__";
      const cur = projMap.get(key) ?? { projectId: e.projectId, projectName: e.projectName ?? "Unassigned", minutes: 0, billableMinutes: 0 };
      cur.minutes += e.minutes;
      if (e.billable) cur.billableMinutes += e.minutes;
      projMap.set(key, cur);
    }
    const byProject = [...projMap.values()].sort((a, b) => b.minutes - a.minutes);

    return {
      id: ts.id,
      employeeId: ts.employeeId,
      employeeName: employee ? `${employee.firstName} ${employee.lastName}`.trim() : "Unknown",
      employeeEmail: employee?.email ?? null,
      designation: employee?.title ?? employee?.designationRef?.title ?? null,
      weekStart: iso(weekStart),
      weekEnd: iso(addDays(weekStart, 6)),
      status: ts.status,
      totalMinutes,
      billableMinutes,
      nonBillableMinutes: totalMinutes - billableMinutes,
      submittedAt: ts.submittedAt ? ts.submittedAt.toISOString() : null,
      decidedAt: ts.decidedAt ? ts.decidedAt.toISOString() : null,
      note: ts.note ?? null,
      days,
      byProject,
      entries,
    };
  }

  /**
   * Billable vs non-billable rollup over a date range, grouped by one of
   * employee / team / project / client. Team and client are reached through the
   * entry's project (Project.teamId / Project.clientId), so a project is the
   * single place those relationships are set.
   *
   * Utilization here is billable ÷ tracked time — of the hours people logged,
   * how much is billable. It is not a share of capacity//available hours, which
   * would need contracted-hours data the schema doesn't carry yet.
   */
  async billableSummary(query: { from?: string; to?: string; groupBy?: "employee" | "team" | "project" | "client" }) {
    const ctx = requireTenantContext();
    const groupBy = query.groupBy ?? "project";

    // Default window: the last 30 days, inclusive of today.
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const from = query.from ? parseDate(query.from) : addDays(today, -29);
    const to = query.to ? parseDate(query.to) : today;
    if (to < from) throw new BadRequestException("The end date must be on or after the start date.");
    const toExclusive = addDays(to, 1);

    // Scoped readers only roll up their own departments'/teams' hours.
    const readScope = await this.accessScope.resolveScope(ctx.orgId, ctx.userId, permissions.attendanceRead);
    const visibleIds = await this.accessScope.visibleEmployeeIds(ctx.orgId, readScope);

    const rows = await this.prisma.timeEntry.findMany({
      where: {
        orgId: ctx.orgId,
        date: { gte: from, lt: toExclusive },
        ...(visibleIds !== null ? { employeeId: { in: visibleIds } } : {}),
      },
      select: { employeeId: true, projectId: true, minutes: true, billable: true },
    });

    // Resolve the labels each grouping needs, in one query per dimension.
    const projectIds = [...new Set(rows.map((r) => r.projectId).filter((x): x is string => Boolean(x)))];
    const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
    const projects =
      groupBy === "employee"
        ? []
        : await this.prisma.project.findMany({
            where: { id: { in: projectIds } },
            select: { id: true, name: true, teamId: true, clientId: true, team: { select: { name: true } }, client: { select: { name: true } } },
          });
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const employees =
      groupBy === "employee"
        ? await this.prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, firstName: true, lastName: true } })
        : [];
    const employeeById = new Map(employees.map((e) => [e.id, e]));

    // Bucket every entry under its group key. Entries whose project is missing
    // (or whose project has no team/client) fall into an explicit "Unassigned"
    // bucket rather than being dropped — totals must always reconcile.
    const buckets = new Map<string, { key: string | null; label: string; minutes: number; billableMinutes: number }>();
    const bucket = (key: string | null, label: string) => {
      const k = key ?? "__none__";
      const cur = buckets.get(k) ?? { key, label, minutes: 0, billableMinutes: 0 };
      buckets.set(k, cur);
      return cur;
    };

    for (const r of rows) {
      let b: { minutes: number; billableMinutes: number };
      if (groupBy === "employee") {
        const e = employeeById.get(r.employeeId);
        b = bucket(r.employeeId, e ? `${e.firstName} ${e.lastName}`.trim() : "Unknown");
      } else {
        const p = r.projectId ? projectById.get(r.projectId) : undefined;
        if (groupBy === "project") b = bucket(p?.id ?? null, p?.name ?? "Unassigned");
        else if (groupBy === "team") b = bucket(p?.teamId ?? null, p?.team?.name ?? "Unassigned");
        else b = bucket(p?.clientId ?? null, p?.client?.name ?? "Unassigned"); // client
      }
      b.minutes += r.minutes;
      if (r.billable) b.billableMinutes += r.minutes;
    }

    const groups = [...buckets.values()]
      .map((g) => ({
        key: g.key,
        label: g.label,
        minutes: g.minutes,
        billableMinutes: g.billableMinutes,
        nonBillableMinutes: g.minutes - g.billableMinutes,
        utilization: g.minutes > 0 ? Math.round((g.billableMinutes / g.minutes) * 100) : 0,
      }))
      .sort((a, b) => b.minutes - a.minutes);

    const totalMinutes = rows.reduce((s, r) => s + r.minutes, 0);
    const billableMinutes = rows.reduce((s, r) => s + (r.billable ? r.minutes : 0), 0);

    return {
      from: iso(from),
      to: iso(to),
      groupBy,
      totals: {
        minutes: totalMinutes,
        billableMinutes,
        nonBillableMinutes: totalMinutes - billableMinutes,
        utilization: totalMinutes > 0 ? Math.round((billableMinutes / totalMinutes) * 100) : 0,
        entryCount: rows.length,
      },
      groups,
    };
  }

  async decide(id: string, approve: boolean, note?: string) {
    const ctx = requireTenantContext();
    const ts = await this.prisma.timesheet.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!ts) throw new NotFoundException("Timesheet not found.");
    if (ts.status !== "SUBMITTED") throw new ConflictException("This timesheet has already been decided.");
    // Only the submitter's own manager (or an Owner) may decide.
    await this.approval.assertCanApprove(ts.employeeId);
    const status = approve ? "APPROVED" : "REJECTED";

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.timesheet.update({ where: { id: ts.id }, data: { status, decidedBy: ctx.userId, decidedAt: new Date(), note: note?.trim() || null } });
      const membership = await tx.organizationMembership.findFirst({ where: { orgId: ctx.orgId, employeeId: ts.employeeId, status: "ACTIVE" }, select: { userId: true } });
      await this.outbox.enqueue(tx, {
        eventType: "timesheet.decided",
        aggregateType: "timesheet",
        aggregateId: ts.id,
        orgId: ctx.orgId,
        payload: { timesheetId: ts.id, employeeId: ts.employeeId, requesterUserId: membership?.userId ?? null, status, weekStart: iso(ts.weekStart) },
      });
      return updated;
    });
  }
}
