import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { ApprovalService } from "../../common/approval/approval.service.js";
import { OrgRolesService } from "../../common/org-roles/org-roles.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { CompOffService } from "./comp-off.service.js";

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

function parseDate(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid date.");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Midnight-UTC of the current day, for date-only comparisons. */
function todayUtc(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly approval: ApprovalService,
    private readonly orgRoles: OrgRolesService,
    private readonly compOff: CompOffService,
  ) {}

  /** Resolve the caller's employee record via their active membership. */
  private async callerEmployeeId(): Promise<string> {
    const ctx = requireTenantContext();
    const m = await this.prisma.organizationMembership.findUnique({ where: { id: ctx.membershipId }, select: { employeeId: true } });
    if (!m?.employeeId) throw new BadRequestException("Your account is not linked to an employee record.");
    return m.employeeId;
  }

  // ---- Leave types ----

  async listTypes() {
    const ctx = requireTenantContext();
    return this.prisma.leaveType.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ status: "asc" }, { name: "asc" }] });
  }

  async createType(input: { name: string; code: string; annualQuota?: number; paid?: boolean; color?: string | null }) {
    const ctx = requireTenantContext();
    try {
      return await this.prisma.leaveType.create({
        data: { orgId: ctx.orgId, name: input.name.trim(), code: input.code.trim().toUpperCase(), annualQuota: input.annualQuota ?? 0, paid: input.paid ?? true, color: input.color ?? null },
      });
    } catch (e) {
      if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") throw new ConflictException("A leave type with this code already exists.");
      throw e;
    }
  }

  async updateType(id: string, input: { name?: string; annualQuota?: number; paid?: boolean; color?: string | null; status?: string }) {
    const ctx = requireTenantContext();
    const found = await this.prisma.leaveType.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!found) throw new NotFoundException("Leave type not found.");
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.annualQuota !== undefined) data.annualQuota = input.annualQuota;
    if (input.paid !== undefined) data.paid = input.paid;
    if (input.color !== undefined) data.color = input.color;
    if (input.status !== undefined) data.status = input.status;
    return this.prisma.leaveType.update({ where: { id: found.id }, data });
  }

  // ---- Balances ----

  /** Per-type allocated / used / pending / remaining for an employee in a year. */
  async balances(employeeId?: string, year?: number) {
    const ctx = requireTenantContext();
    const callerId = await this.callerEmployeeId();
    const empId = employeeId ?? callerId;
    // Someone else's balances are only visible within the caller's approval reach
    // (their departments/teams, or direct reports) — never org-wide by default.
    if (empId !== callerId) {
      const reach = await this.approval.approvableEmployeeIds();
      if (reach !== null && !reach.includes(empId)) {
        throw new ForbiddenException("You can only view leave balances for people in the teams you manage.");
      }
    }
    const y = year ?? new Date().getUTCFullYear();
    const start = new Date(Date.UTC(y, 0, 1));
    const end = new Date(Date.UTC(y + 1, 0, 1));

    const [types, requests] = await Promise.all([
      this.prisma.leaveType.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE" }, orderBy: { name: "asc" } }),
      this.prisma.leaveRequest.findMany({
        where: { orgId: ctx.orgId, employeeId: empId, status: { in: ["APPROVED", "PENDING"] }, startDate: { gte: start, lt: end } },
        select: { leaveTypeId: true, days: true, status: true },
      }),
    ]);

    const used = new Map<string, number>();
    const pending = new Map<string, number>();
    for (const r of requests) {
      const map = r.status === "APPROVED" ? used : pending;
      map.set(r.leaveTypeId, (map.get(r.leaveTypeId) ?? 0) + r.days);
    }

    return {
      year: y,
      employeeId: empId,
      balances: types.map((t) => {
        const u = used.get(t.id) ?? 0;
        const p = pending.get(t.id) ?? 0;
        return {
          leaveTypeId: t.id,
          name: t.name,
          code: t.code,
          color: t.color,
          paid: t.paid,
          allocated: t.annualQuota,
          used: u,
          pending: p,
          remaining: t.annualQuota > 0 ? Math.max(0, t.annualQuota - u - p) : null, // null = uncapped
        };
      }),
    };
  }

  // ---- Requests ----

  /** Working days between two dates for an employee (excludes weekly-offs & holidays). */
  private async computeLeaveDays(orgId: string, employeeId: string, start: Date, end: Date): Promise<number> {
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { departmentId: true, shiftRef: { select: { workingDays: true, status: true } } } });
    let workingDays = emp?.shiftRef && emp.shiftRef.status === "ACTIVE" ? emp.shiftRef.workingDays : null;
    if (!workingDays || workingDays.length === 0) {
      const def = await this.prisma.shift.findFirst({ where: { orgId, isDefault: true, status: "ACTIVE" }, select: { workingDays: true } });
      workingDays = def?.workingDays?.length ? def.workingDays : DEFAULT_WORKING_DAYS;
    }
    const wd = new Set(workingDays);
    const holidays = await this.prisma.holiday.findMany({
      where: { orgId, date: { gte: start, lte: end }, OR: [{ type: { not: "DEPARTMENT" } }, { departmentId: emp?.departmentId ?? undefined }] },
      select: { date: true },
    });
    const holidaySet = new Set(holidays.map((h) => iso(h.date)));
    let days = 0;
    for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (wd.has(d.getUTCDay()) && !holidaySet.has(iso(d))) days += 1;
    }
    return days;
  }

  async createRequest(input: { leaveTypeId: string; startDate: string; endDate: string; dayPart?: string; reason?: string }) {
    const ctx = requireTenantContext();
    const employeeId = await this.callerEmployeeId();
    // The Owner grants leave rather than requesting it — a leave balance for them
    // would be counted against a quota nobody sets.
    if (await this.orgRoles.isOwnerEmployee(ctx.orgId, employeeId)) {
      throw new ForbiddenException("Leave is for the organization's staff. As the owner, you approve requests rather than filing your own.");
    }
    const start = parseDate(input.startDate);
    const end = parseDate(input.endDate);
    if (end < start) throw new BadRequestException("End date must be on or after the start date.");
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (start < today) throw new BadRequestException("Leave cannot be applied for past dates.");

    // A half-day only applies to a single date. Reject FIRST_HALF/SECOND_HALF across a range.
    const dayPart = input.dayPart === "FIRST_HALF" || input.dayPart === "SECOND_HALF" ? input.dayPart : "FULL";
    const isHalfDay = dayPart !== "FULL";
    if (isHalfDay && start.getTime() !== end.getTime()) {
      throw new BadRequestException("A half-day leave must be for a single date.");
    }

    const type = await this.prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, orgId: ctx.orgId, status: "ACTIVE" } });
    if (!type) throw new NotFoundException("Leave type not found.");

    // Reject overlaps with existing active requests.
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: { orgId: ctx.orgId, employeeId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: end }, endDate: { gte: start } },
      select: { id: true },
    });
    if (overlap) throw new ConflictException("You already have a leave request overlapping these dates.");

    const workingDays = await this.computeLeaveDays(ctx.orgId, employeeId, start, end);
    if (workingDays <= 0) throw new BadRequestException("The selected range has no working days to take leave on.");
    // Half-day deducts exactly 0.5 (the single date is already confirmed to be a working day above).
    const days = isHalfDay ? 0.5 : workingDays;

    // Comp-off leave draws on the earned comp-off ledger, not an annual quota —
    // reject upfront if the balance can't cover it (the spend is written on approve).
    if (type.code === "COMP_OFF") {
      const balance = await this.compOff.balanceOf(ctx.orgId, employeeId);
      if (days > balance) {
        throw new BadRequestException(`You have ${balance} comp-off day(s) available but requested ${days}.`);
      }
    }

    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { firstName: true, lastName: true } });
    const employeeName = employee ? `${employee.firstName} ${employee.lastName}`.trim() : "An employee";

    // Persist the request and its notification event atomically (transactional outbox):
    // notifications-service turns leave.requested into inbox notifications for the
    // approvers (owner/managers/HR), idempotently per (event, recipient).
    return this.prisma.$transaction(async (tx) => {
      const req = await tx.leaveRequest.create({
        data: { orgId: ctx.orgId, employeeId, leaveTypeId: type.id, startDate: start, endDate: end, days, dayPart, reason: input.reason?.trim() || null },
      });
      await this.outbox.enqueue(tx, {
        eventType: "leave.requested",
        aggregateType: "leave_request",
        aggregateId: req.id,
        orgId: ctx.orgId,
        payload: { leaveRequestId: req.id, employeeId, employeeName, leaveTypeName: type.name, leaveTypeCode: type.code, startDate: iso(start), endDate: iso(end), days, dayPart },
      });
      return req;
    });
  }

  private serialize(r: {
    id: string;
    employeeId: string;
    startDate: Date;
    endDate: Date;
    days: number;
    dayPart: string;
    reason: string | null;
    status: string;
    decidedAt: Date | null;
    decisionNote: string | null;
    createdAt: Date;
    leaveType: { id: string; name: string; code: string; color: string | null };
    employee: { firstName: string; lastName: string } | null;
  }) {
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeName: r.employee ? `${r.employee.firstName} ${r.employee.lastName}`.trim() : null,
      leaveType: r.leaveType,
      startDate: iso(r.startDate),
      endDate: iso(r.endDate),
      days: r.days,
      dayPart: r.dayPart,
      reason: r.reason,
      status: r.status,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** scope="mine" → caller's requests; scope="all" → org (needs attendance.read at controller). */
  async listRequests(query: { scope?: "mine" | "all"; status?: string; employeeId?: string }) {
    const ctx = requireTenantContext();
    const where: Record<string, unknown> = { orgId: ctx.orgId };
    if (query.scope !== "all") {
      where.employeeId = await this.callerEmployeeId();
    } else {
      // Approval center: an Owner sees the whole org, a manager only their
      // reports. A specific employeeId filter must stay within that scope.
      const approvable = await this.approval.approvableEmployeeIds();
      if (approvable) {
        where.employeeId = query.employeeId && approvable.includes(query.employeeId) ? query.employeeId : { in: approvable };
      } else if (query.employeeId) {
        where.employeeId = query.employeeId;
      }
    }
    if (query.status) where.status = query.status;

    const rows = await this.prisma.leaveRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      include: {
        leaveType: { select: { id: true, name: true, code: true, color: true } },
        employee: { select: { firstName: true, lastName: true, teamId: true, departmentId: true } },
      },
    });

    // Approval center (scope=all): attach team/department leave conflicts so the
    // approver can see, per request, who ELSE on the same team/department overlaps
    // these dates — avoiding accidentally granting half a team the same days off.
    if (query.scope === "all") {
      const conflicts = await this.computeConflicts(ctx.orgId, rows);
      return rows.map((r) => ({ ...this.serialize(r), conflict: conflicts.get(r.id) ?? null }));
    }
    return rows.map((r) => this.serialize(r));
  }

  /** Leave requests as a { baseName, columns, rows } table for CSV/xlsx export. */
  async exportRequests(scope: "mine" | "all") {
    const items = await this.listRequests({ scope });
    const columns = ["Employee", "Leave type", "Start", "End", "Days", "Day part", "Status", "Reason", "Decided at", "Requested at"];
    const rows = items.map((r) => [
      r.employeeName ?? "",
      r.leaveType?.name ?? "",
      r.startDate,
      r.endDate,
      r.days,
      r.dayPart,
      r.status,
      r.reason ?? "",
      r.decidedAt ? r.decidedAt.slice(0, 10) : "",
      r.createdAt.slice(0, 10),
    ]);
    return { baseName: `leave-${scope}-${iso(new Date())}`, columns, rows };
  }

  /**
   * For each request, find OTHER active (pending/approved) requests from the same
   * team (or department, if no team) whose dates overlap. Returns a map of
   * requestId → { count, peers: [{ name, startDate, endDate, status }] }.
   */
  private async computeConflicts(
    orgId: string,
    rows: { id: string; employeeId: string; startDate: Date; endDate: Date; employee: { teamId: string | null; departmentId: string | null } | null }[],
  ): Promise<Map<string, { count: number; peers: { name: string; startDate: string; endDate: string; status: string }[] }>> {
    const result = new Map<string, { count: number; peers: { name: string; startDate: string; endDate: string; status: string }[] }>();
    if (rows.length === 0) return result;

    // The group of employees to compare against = everyone in the same team/dept as
    // any request in this list. One batched query, then match in memory.
    const teamIds = [...new Set(rows.map((r) => r.employee?.teamId).filter((v): v is string => Boolean(v)))];
    const deptIds = [...new Set(rows.map((r) => r.employee?.departmentId).filter((v): v is string => Boolean(v)))];
    if (teamIds.length === 0 && deptIds.length === 0) return result;

    const minStart = new Date(Math.min(...rows.map((r) => r.startDate.getTime())));
    const maxEnd = new Date(Math.max(...rows.map((r) => r.endDate.getTime())));

    const peers = await this.prisma.leaveRequest.findMany({
      where: {
        orgId,
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { lte: maxEnd },
        endDate: { gte: minStart },
        employee: { OR: [{ teamId: { in: teamIds } }, { departmentId: { in: deptIds } }] },
      },
      select: {
        id: true, employeeId: true, startDate: true, endDate: true, status: true,
        employee: { select: { firstName: true, lastName: true, teamId: true, departmentId: true } },
      },
    });

    const overlaps = (aS: Date, aE: Date, bS: Date, bE: Date) => aS <= bE && bS <= aE;
    for (const r of rows) {
      const group = r.employee?.teamId ?? r.employee?.departmentId;
      if (!group) continue;
      const clash = peers.filter(
        (p) =>
          p.id !== r.id &&
          p.employeeId !== r.employeeId &&
          (p.employee?.teamId === r.employee?.teamId || p.employee?.departmentId === r.employee?.departmentId) &&
          overlaps(r.startDate, r.endDate, p.startDate, p.endDate),
      );
      if (clash.length > 0) {
        result.set(r.id, {
          count: clash.length,
          peers: clash.map((p) => ({
            name: p.employee ? `${p.employee.firstName} ${p.employee.lastName}`.trim() : "—",
            startDate: iso(p.startDate),
            endDate: iso(p.endDate),
            status: p.status,
          })),
        });
      }
    }
    return result;
  }

  async decide(id: string, approve: boolean, note?: string) {
    const ctx = requireTenantContext();
    const req = await this.prisma.leaveRequest.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!req) throw new NotFoundException("Leave request not found.");
    if (req.status !== "PENDING") throw new ConflictException("This request has already been decided.");
    // Only the requester's own manager (or an Owner) may decide — not any approver.
    await this.approval.assertCanApprove(req.employeeId);
    const status = approve ? "APPROVED" : "REJECTED";
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.leaveRequest.update({
        where: { id: req.id },
        data: { status, decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: note?.trim() || null },
        include: { leaveType: { select: { name: true, code: true } } },
      });
      // The requesting employee's user, so notifications-service can notify them.
      const membership = await tx.organizationMembership.findFirst({ where: { orgId: ctx.orgId, employeeId: req.employeeId, status: "ACTIVE" }, select: { userId: true } });
      await this.outbox.enqueue(tx, {
        eventType: "leave.decided",
        aggregateType: "leave_request",
        aggregateId: req.id,
        orgId: ctx.orgId,
        payload: { leaveRequestId: req.id, employeeId: req.employeeId, requesterUserId: membership?.userId ?? null, status, leaveTypeName: updated.leaveType.name, startDate: iso(updated.startDate), endDate: iso(updated.endDate) },
      });
      return updated;
    });

    // On approval of a comp-off leave, debit the ledger (balance was checked at
    // request time; this makes the spend). Post-commit so a ledger issue surfaces
    // as an error to the approver without corrupting the decision transaction.
    if (approve && result.leaveType.code === "COMP_OFF") {
      await this.compOff.spendForLeave(ctx.orgId, req.employeeId, req.id, req.days);
    }
    return result;
  }

  /**
   * The caller's leave calendar for a month: their shift's working days (so
   * week-offs are org- & shift-dependent), applicable holidays, and their own
   * leave days.
   */
  async calendar(monthStr?: string) {
    const ctx = requireTenantContext();
    const employeeId = await this.callerEmployeeId();
    const now = new Date();
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth() + 1;
    if (monthStr) {
      const [y, m] = monthStr.split("-").map(Number);
      if (!y || !m || m < 1 || m > 12) throw new BadRequestException("Invalid month (expected YYYY-MM).");
      year = y;
      month = m;
    }
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1)); // exclusive

    // Resolve the employee's working-day pattern: their shift → org default → Mon-Fri.
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { departmentId: true, shiftRef: { select: { name: true, workingDays: true, status: true } } },
    });
    let workingDays = emp?.shiftRef && emp.shiftRef.status === "ACTIVE" ? emp.shiftRef.workingDays : null;
    let shiftName = emp?.shiftRef && emp.shiftRef.status === "ACTIVE" ? emp.shiftRef.name : null;
    if (!workingDays || workingDays.length === 0) {
      const def = await this.prisma.shift.findFirst({ where: { orgId: ctx.orgId, isDefault: true, status: "ACTIVE" }, select: { name: true, workingDays: true } });
      workingDays = def?.workingDays?.length ? def.workingDays : DEFAULT_WORKING_DAYS;
      shiftName = shiftName ?? def?.name ?? "Default";
    }

    const [holidays, leaves] = await Promise.all([
      this.prisma.holiday.findMany({
        where: { orgId: ctx.orgId, date: { gte: start, lt: end }, OR: [{ type: { not: "DEPARTMENT" } }, { departmentId: emp?.departmentId ?? undefined }] },
        select: { date: true, name: true, type: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: { orgId: ctx.orgId, employeeId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lt: end }, endDate: { gte: start } },
        include: { leaveType: { select: { name: true, code: true, color: true } } },
      }),
    ]);

    const leaveDays: { date: string; status: string; typeName: string; code: string; color: string | null; dayPart: string }[] = [];
    for (const lr of leaves) {
      const s = lr.startDate < start ? new Date(start) : new Date(lr.startDate);
      for (const d = s; d < end && d <= lr.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
        leaveDays.push({ date: iso(d), status: lr.status, typeName: lr.leaveType.name, code: lr.leaveType.code, color: lr.leaveType.color, dayPart: lr.dayPart });
      }
    }

    return {
      month: `${year}-${String(month).padStart(2, "0")}`,
      workingDays,
      shiftName,
      holidays: holidays.map((h) => ({ date: iso(h.date), name: h.name, type: h.type })),
      leaves: leaveDays,
    };
  }

  /**
   * Org-wide leave calendar for a month: every employee's PENDING/APPROVED leave
   * that touches the month, plus holidays. Returns leave spans enriched with the
   * employee's department and team so the org view can filter by name/dept/team.
   * Gated by attendance.read at the controller (admin/manager only).
   */
  async orgCalendar(monthStr?: string) {
    const ctx = requireTenantContext();
    const now = new Date();
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth() + 1;
    if (monthStr) {
      const [y, m] = monthStr.split("-").map(Number);
      if (!y || !m || m < 1 || m > 12) throw new BadRequestException("Invalid month (expected YYYY-MM).");
      year = y;
      month = m;
    }
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1)); // exclusive

    // A scoped approver's org calendar covers their departments/teams, not the org.
    const reach = await this.approval.approvableEmployeeIds();

    const [holidays, leaves, teams] = await Promise.all([
      this.prisma.holiday.findMany({ where: { orgId: ctx.orgId, date: { gte: start, lt: end } }, select: { date: true, name: true, type: true } }),
      this.prisma.leaveRequest.findMany({
        where: {
          orgId: ctx.orgId,
          status: { in: ["PENDING", "APPROVED"] },
          startDate: { lt: end },
          endDate: { gte: start },
          ...(reach !== null ? { employeeId: { in: reach } } : {}),
        },
        include: {
          leaveType: { select: { name: true, code: true, color: true } },
          employee: { select: { firstName: true, lastName: true, teamId: true, departmentRef: { select: { name: true } } } },
        },
        orderBy: [{ startDate: "asc" }],
      }),
      this.prisma.team.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
    ]);
    const teamName = new Map(teams.map((t) => [t.id, t.name]));

    return {
      month: `${year}-${String(month).padStart(2, "0")}`,
      holidays: holidays.map((h) => ({ date: iso(h.date), name: h.name, type: h.type })),
      entries: leaves.map((lr) => ({
        id: lr.id,
        employeeId: lr.employeeId,
        employeeName: lr.employee ? `${lr.employee.firstName} ${lr.employee.lastName}`.trim() : "—",
        departmentName: lr.employee?.departmentRef?.name ?? null,
        teamId: lr.employee?.teamId ?? null,
        teamName: lr.employee?.teamId ? (teamName.get(lr.employee.teamId) ?? null) : null,
        startDate: iso(lr.startDate),
        endDate: iso(lr.endDate),
        days: lr.days,
        dayPart: lr.dayPart,
        status: lr.status,
        typeName: lr.leaveType.name,
        code: lr.leaveType.code,
        color: lr.leaveType.color,
      })),
    };
  }

  /**
   * Approval-center analytics for the caller's approval scope (Owner → org,
   * manager → their reports). Summarises the pending queue, who's out now / soon,
   * and how leave splits across types for the year — the numbers an approver needs
   * to make good decisions, without paging through every request.
   */
  async analytics() {
    const ctx = requireTenantContext();
    const reach = await this.approval.approvableEmployeeIds(); // null = whole org
    const scope = reach !== null ? { employeeId: { in: reach } } : {};

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const in14 = new Date(todayUtc);
    in14.setUTCDate(in14.getUTCDate() + 14);
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const yearEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));

    const [pending, outNow, upcoming, yearApproved, types] = await Promise.all([
      // Pending queue awaiting a decision.
      this.prisma.leaveRequest.count({ where: { orgId: ctx.orgId, status: "PENDING", ...scope } }),
      // Currently on approved leave (today falls in the range).
      this.prisma.leaveRequest.count({
        where: { orgId: ctx.orgId, status: "APPROVED", startDate: { lte: todayUtc }, endDate: { gte: todayUtc }, ...scope },
      }),
      // Approved leave starting within the next 14 days.
      this.prisma.leaveRequest.count({
        where: { orgId: ctx.orgId, status: "APPROVED", startDate: { gt: todayUtc, lte: in14 }, ...scope },
      }),
      // This year's approved leave, grouped by type, to show the mix.
      this.prisma.leaveRequest.groupBy({
        by: ["leaveTypeId"],
        where: { orgId: ctx.orgId, status: "APPROVED", startDate: { gte: yearStart, lt: yearEnd }, ...scope },
        _sum: { days: true },
        _count: { _all: true },
      }),
      this.prisma.leaveType.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true, code: true, color: true } }),
    ]);

    const typeById = new Map(types.map((t) => [t.id, t]));
    const byType = yearApproved
      .map((g) => {
        const t = typeById.get(g.leaveTypeId);
        return {
          leaveTypeId: g.leaveTypeId,
          name: t?.name ?? "—",
          code: t?.code ?? "",
          color: t?.color ?? null,
          days: g._sum.days ?? 0,
          requests: g._count._all,
        };
      })
      .sort((a, b) => b.days - a.days);

    const totalDaysYear = byType.reduce((s, t) => s + t.days, 0);

    return {
      pending,
      outNow,
      upcoming14: upcoming,
      totalDaysYear,
      byType,
    };
  }

  /**
   * Cancel one's own leave.
   *
   * A PENDING request just goes away — nobody had committed to it. Cancelling an
   * APPROVED one, though, unwinds something the team already planned around, so
   * the approver is notified (via the leave.cancelled event). The employee can
   * still cancel it directly — they own their own leave — the manager is simply
   * kept in the loop.
   */
  async cancel(id: string) {
    const ctx = requireTenantContext();
    const employeeId = await this.callerEmployeeId();
    const req = await this.prisma.leaveRequest.findFirst({
      where: { id, orgId: ctx.orgId },
      include: { leaveType: { select: { name: true, code: true } } },
    });
    if (!req) throw new NotFoundException("Leave request not found.");
    if (req.employeeId !== employeeId) throw new ForbiddenException("You can only cancel your own leave requests.");
    if (req.status === "REJECTED" || req.status === "CANCELLED") throw new ConflictException("This request cannot be cancelled.");
    // Past leave is a record, not a plan — cancelling it retroactively would
    // rewrite history the payroll/attendance rollups already counted.
    if (req.startDate < todayUtc() && req.status === "APPROVED") {
      throw new ConflictException("Approved leave that has already started can't be cancelled — ask an admin to adjust it.");
    }

    const wasApproved = req.status === "APPROVED";

    // Cancelling an approved comp-off leave returns the spent days to the ledger.
    if (wasApproved && req.leaveType.code === "COMP_OFF") {
      await this.compOff.reverseForLeave(ctx.orgId, req.employeeId, req.id);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.leaveRequest.update({ where: { id: req.id }, data: { status: "CANCELLED" } });

      // Only an approved cancellation needs to reach the approver; a pending one
      // never made it onto anyone's plate.
      if (wasApproved) {
        const employee = await tx.employee.findUnique({
          where: { id: req.employeeId },
          select: { firstName: true, lastName: true, managerId: true },
        });
        const employeeName = employee ? `${employee.firstName} ${employee.lastName}`.trim() : "An employee";

        // Notify the assigned manager specifically (not every manager). Fall back
        // to null — the notification rule then targets nobody rather than spamming.
        let approverUserId: string | null = null;
        if (employee?.managerId) {
          const managerMembership = await tx.organizationMembership.findFirst({
            where: { orgId: ctx.orgId, employeeId: employee.managerId, status: "ACTIVE" },
            select: { userId: true },
          });
          approverUserId = managerMembership?.userId ?? null;
        }

        await this.outbox.enqueue(tx, {
          eventType: "leave.cancelled",
          aggregateType: "leave_request",
          aggregateId: req.id,
          orgId: ctx.orgId,
          payload: {
            leaveRequestId: req.id,
            employeeId: req.employeeId,
            employeeName,
            approverUserId,
            leaveTypeName: req.leaveType.name,
            startDate: iso(req.startDate),
            endDate: iso(req.endDate),
            days: req.days,
          },
        });
      }
      return updated;
    });
  }
}
