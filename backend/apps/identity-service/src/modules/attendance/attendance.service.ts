import { BadRequestException, Injectable } from "@nestjs/common";
import { getRequestContext, requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

// Fallback thresholds when an employee has no shift and the org has no default:
// checking in after 09:15 is LATE, checking out before 17:00 is an early exit.
const LATE_AFTER_MINUTES = 9 * 60 + 15;
const EARLY_EXIT_BEFORE_MINUTES = 17 * 60;

interface ShiftLike {
  startMinute: number;
  endMinute: number;
  graceMinutes: number;
  workingDays: number[];
}

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** A shift whose end is at or before its start spans midnight (e.g. 22:00–06:00). */
function isOvernight(shift: ShiftLike): boolean {
  return shift.endMinute <= shift.startMinute;
}

/** Minute-of-day (0–1439) of an instant, evaluated in the given IANA timezone. */
function minuteOfDayInTz(d: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return h * 60 + m;
  } catch {
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

/** LATE if the check-in is after shift start + grace. Handles overnight wrap-around. */
function lateStatus(checkInAt: Date, tz: string, shift: ShiftLike | null): "PRESENT" | "LATE" {
  const mod = minuteOfDayInTz(checkInAt, tz);
  if (!shift) return mod > LATE_AFTER_MINUTES ? "LATE" : "PRESENT";
  const threshold = shift.startMinute + shift.graceMinutes;
  // Overnight: a check-in after midnight belongs to the shift's second calendar day.
  const effective = isOvernight(shift) && mod < shift.startMinute ? mod + 1440 : mod;
  return effective > threshold ? "LATE" : "PRESENT";
}

/** Early exit if checked out before the shift end. Handles overnight wrap-around. */
function earlyExitFor(checkOutAt: Date | null, tz: string, shift: ShiftLike | null): boolean {
  if (!checkOutAt) return false;
  const mod = minuteOfDayInTz(checkOutAt, tz);
  if (!shift) return mod < EARLY_EXIT_BEFORE_MINUTES;
  if (isOvernight(shift)) {
    // Window is [start, end+1440); a checkout after midnight is offset by a day.
    const effectiveOut = mod < shift.startMinute ? mod + 1440 : mod;
    return effectiveOut < shift.endMinute + 1440;
  }
  return mod < shift.endMinute;
}

/** Whether a given weekday (0=Sun … 6=Sat) is a working day for the shift. */
function worksOnDay(shift: ShiftLike | null, weekday: number): boolean {
  const days = shift && shift.workingDays.length > 0 ? shift.workingDays : DEFAULT_WORKING_DAYS;
  return days.includes(weekday);
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve the calling user's employee record via their org membership. */
  private async caller(): Promise<{ orgId: string; employeeId: string }> {
    const ctx = requireTenantContext();
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { id: ctx.membershipId },
      select: { orgId: true, employeeId: true },
    });
    if (!membership?.employeeId) {
      throw new BadRequestException("Your account is not linked to an employee record.");
    }
    return { orgId: membership.orgId, employeeId: membership.employeeId };
  }

  /** The employee's own shift (assigned → org default) + the org timezone. */
  private async resolveShift(orgId: string, employeeId: string): Promise<{ tz: string; shift: ShiftLike | null }> {
    const [org, employee] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
      this.prisma.employee.findUnique({ where: { id: employeeId }, select: { shiftRef: { select: { startMinute: true, endMinute: true, graceMinutes: true, workingDays: true, status: true } } } }),
    ]);
    const tz = org?.timezone || "UTC";
    let shift: ShiftLike | null = employee?.shiftRef && employee.shiftRef.status === "ACTIVE" ? employee.shiftRef : null;
    if (!shift) {
      shift = await this.prisma.shift.findFirst({ where: { orgId, isDefault: true, status: "ACTIVE" }, select: { startMinute: true, endMinute: true, graceMinutes: true, workingDays: true } });
    }
    return { tz, shift };
  }

  async checkIn() {
    const { orgId, employeeId } = await this.caller();
    const day = startOfUtcDay();
    const key = { orgId_employeeId_day: { orgId, employeeId, day } };

    const existing = await this.prisma.attendanceRecord.findUnique({ where: key });
    if (existing?.checkInAt) {
      return existing; // already checked in today — idempotent
    }

    const now = new Date();
    const ctx = getRequestContext();
    const { tz, shift } = await this.resolveShift(orgId, employeeId);
    const status = lateStatus(now, tz, shift);
    return this.prisma.attendanceRecord.upsert({
      where: key,
      create: { orgId, employeeId, day, checkInAt: now, status, source: "web", ipAddress: ctx.ipAddress ?? null },
      update: { checkInAt: now, status },
    });
  }

  async checkOut() {
    const { orgId, employeeId } = await this.caller();
    const day = startOfUtcDay();
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { orgId_employeeId_day: { orgId, employeeId, day } },
    });
    if (!record?.checkInAt) {
      throw new BadRequestException("You have not checked in today.");
    }
    const now = new Date();
    const workMinutes = Math.max(0, Math.round((now.getTime() - record.checkInAt.getTime()) / 60000));
    return this.prisma.attendanceRecord.update({ where: { id: record.id }, data: { checkOutAt: now, workMinutes } });
  }

  async me() {
    const { orgId, employeeId } = await this.caller();
    const day = startOfUtcDay();
    const since = startOfUtcDay(new Date(Date.now() - 14 * 86_400_000));
    const [today, history] = await Promise.all([
      this.prisma.attendanceRecord.findUnique({ where: { orgId_employeeId_day: { orgId, employeeId, day } } }),
      this.prisma.attendanceRecord.findMany({ where: { orgId, employeeId, day: { gte: since } }, orderBy: { day: "desc" } }),
    ]);
    return { today, history };
  }

  /** Org-wide attendance metrics for today (admin view) — owner excluded, absentees counted. */
  async today() {
    const ctx = requireTenantContext();
    const day = startOfUtcDay();
    const rows = await this.dayRoster(ctx.orgId, day);
    const summary = this.summarize(rows);
    return { day: day.toISOString().slice(0, 10), totalEmployees: summary.total, ...summary };
  }

  /** Owner accounts are provisioned as employees but excluded from workforce reports. */
  private async ownerEmployeeIds(orgId: string): Promise<string[]> {
    const admins = await this.prisma.organizationMembership.findMany({
      where: { orgId, status: "ACTIVE", role: { name: "Owner" }, employeeId: { not: null } },
      select: { employeeId: true },
    });
    return admins.map((a) => a.employeeId).filter((x): x is string => Boolean(x));
  }

  /** Per-employee attendance rows for a single day; no-record employees are ABSENT (or ON_LEAVE). */
  private async dayRoster(orgId: string, day: Date) {
    const exclude = await this.ownerEmployeeIds(orgId);
    const [org, shifts, employees, records, holidays, leaves] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
      this.prisma.shift.findMany({ where: { orgId }, select: { id: true, startMinute: true, endMinute: true, graceMinutes: true, workingDays: true, isDefault: true, status: true } }),
      this.prisma.employee.findMany({
        where: { orgId, status: { in: ["ACTIVE", "ON_LEAVE", "NOTICE_PERIOD"] }, ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}) },
        select: { id: true, firstName: true, lastName: true, status: true, departmentId: true, shiftId: true, departmentRef: { select: { name: true } } },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      }),
      this.prisma.attendanceRecord.findMany({
        where: { orgId, day },
        select: { employeeId: true, status: true, checkInAt: true, checkOutAt: true, workMinutes: true },
      }),
      this.prisma.holiday.findMany({ where: { orgId, date: day }, select: { type: true, departmentId: true } }),
      this.prisma.leaveRequest.findMany({ where: { orgId, status: "APPROVED", startDate: { lte: day }, endDate: { gte: day } }, select: { employeeId: true } }),
    ]);

    const tz = org?.timezone || "UTC";
    const shiftById = new Map(shifts.map((s) => [s.id, s]));
    const defaultShift = shifts.find((s) => s.isDefault && s.status === "ACTIVE") ?? null;
    const weekday = day.getUTCDay();
    const companyHoliday = holidays.some((h) => h.type !== "DEPARTMENT");
    const holidayDeptIds = new Set(holidays.filter((h) => h.type === "DEPARTMENT").map((h) => h.departmentId));
    const onLeaveIds = new Set(leaves.map((l) => l.employeeId));

    const byEmp = new Map(records.map((r) => [r.employeeId, r]));
    return employees.map((e) => {
      const r = byEmp.get(e.id);
      const empShift = (e.shiftId ? shiftById.get(e.shiftId) : null) ?? defaultShift;
      const shift = empShift && empShift.status === "ACTIVE" ? empShift : defaultShift;
      const isHoliday = companyHoliday || (e.departmentId ? holidayDeptIds.has(e.departmentId) : false);
      // Precedence for employees without a check-in record: holiday → approved leave →
      // employee-level leave → weekly-off (non-working day) → absent.
      const status = r
        ? r.status
        : isHoliday
          ? "HOLIDAY"
          : onLeaveIds.has(e.id) || e.status === "ON_LEAVE"
            ? "ON_LEAVE"
            : worksOnDay(shift, weekday)
              ? "ABSENT"
              : "WEEKLY_OFF";
      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        departmentId: e.departmentId,
        department: e.departmentRef?.name ?? null,
        status,
        checkInAt: r?.checkInAt ?? null,
        checkOutAt: r?.checkOutAt ?? null,
        workMinutes: r?.workMinutes ?? 0,
        earlyExit: earlyExitFor(r?.checkOutAt ?? null, tz, shift),
      };
    });
  }

  private summarize<T extends { status: string; earlyExit?: boolean }>(rows: T[]) {
    const present = rows.filter((r) => r.status === "PRESENT").length;
    const late = rows.filter((r) => r.status === "LATE").length;
    const onLeave = rows.filter((r) => r.status === "ON_LEAVE").length;
    const absent = rows.filter((r) => r.status === "ABSENT").length;
    const weeklyOff = rows.filter((r) => r.status === "WEEKLY_OFF").length;
    const holiday = rows.filter((r) => r.status === "HOLIDAY").length;
    const earlyExits = rows.filter((r) => r.earlyExit).length;
    // Attendance rate is over people scheduled to work today (excludes weekly-off & holidays).
    const scheduled = rows.length - weeklyOff - holiday;
    return {
      total: rows.length,
      present,
      late,
      earlyExits,
      absent,
      onLeave,
      weeklyOff,
      holiday,
      checkedIn: present + late,
      attendanceRate: scheduled > 0 ? Math.round(((present + late) / scheduled) * 100) : 0,
    };
  }

  private resolveDay(dayStr?: string): Date {
    if (!dayStr) return startOfUtcDay();
    const d = new Date(`${dayStr}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid day.");
    return startOfUtcDay(d);
  }

  /**
   * Full per-employee attendance roster for today (admin view) — every active
   * employee with their status, marking those without a record ABSENT.
   */
  async roster() {
    const ctx = requireTenantContext();
    const day = startOfUtcDay();
    const rows = await this.dayRoster(ctx.orgId, day);
    return { day: day.toISOString().slice(0, 10), summary: this.summarize(rows), rows };
  }

  /** Daily Attendance report — per-employee attendance for any day (defaults to today). */
  async reportDaily(dayStr?: string) {
    const ctx = requireTenantContext();
    const day = this.resolveDay(dayStr);
    const rows = await this.dayRoster(ctx.orgId, day);
    return { day: day.toISOString().slice(0, 10), summary: this.summarize(rows), rows };
  }

  /** Department Attendance report — attendance grouped by department for a day. */
  async reportDepartment(dayStr?: string) {
    const ctx = requireTenantContext();
    const day = this.resolveDay(dayStr);
    const rows = await this.dayRoster(ctx.orgId, day);

    const groups = new Map<string, { departmentId: string | null; name: string; rows: typeof rows }>();
    for (const r of rows) {
      const key = r.departmentId ?? "none";
      const g = groups.get(key) ?? { departmentId: r.departmentId, name: r.department ?? "No department", rows: [] };
      g.rows.push(r);
      groups.set(key, g);
    }

    const departments = [...groups.values()]
      .map((g) => ({ departmentId: g.departmentId, name: g.name, ...this.summarize(g.rows) }))
      .sort((a, b) => b.total - a.total);
    return { day: day.toISOString().slice(0, 10), departments };
  }

  /**
   * Monthly Attendance report — per-employee present/late/leave/absent counts and
   * rate across the month's weekdays (up to today). Defaults to the current month.
   */
  async reportMonthly(monthStr?: string) {
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
    const today = startOfUtcDay();

    const rangeEnd = end.getTime() < today.getTime() + 86_400_000 ? end : new Date(today.getTime() + 86_400_000); // min(end, today+1)
    const exclude = await this.ownerEmployeeIds(ctx.orgId);
    const [shifts, employees, records, holidays, approvedLeaves] = await Promise.all([
      this.prisma.shift.findMany({ where: { orgId: ctx.orgId }, select: { id: true, workingDays: true, isDefault: true, status: true } }),
      this.prisma.employee.findMany({
        where: { orgId: ctx.orgId, status: { in: ["ACTIVE", "ON_LEAVE", "NOTICE_PERIOD"] }, ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}) },
        select: { id: true, firstName: true, lastName: true, shiftId: true, departmentId: true, departmentRef: { select: { name: true } } },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      }),
      this.prisma.attendanceRecord.findMany({
        where: { orgId: ctx.orgId, day: { gte: start, lt: end } },
        select: { employeeId: true, status: true, day: true },
      }),
      this.prisma.holiday.findMany({ where: { orgId: ctx.orgId, date: { gte: start, lt: end } }, select: { date: true, type: true, departmentId: true } }),
      this.prisma.leaveRequest.findMany({ where: { orgId: ctx.orgId, status: "APPROVED", startDate: { lt: end }, endDate: { gte: start } }, select: { employeeId: true, startDate: true, endDate: true } }),
    ]);

    const shiftById = new Map(shifts.map((s) => [s.id, s]));
    const defaultShift = shifts.find((s) => s.isDefault && s.status === "ACTIVE") ?? null;

    const companyHolidays = new Set(holidays.filter((h) => h.type !== "DEPARTMENT").map((h) => this.dateKey(h.date)));
    const deptHolidays = new Map<string, Set<string>>();
    for (const h of holidays) {
      if (h.type === "DEPARTMENT" && h.departmentId) {
        const set = deptHolidays.get(h.departmentId) ?? new Set<string>();
        set.add(this.dateKey(h.date));
        deptHolidays.set(h.departmentId, set);
      }
    }

    // Set of working-day date-keys for a (shift pattern × department) combo, holidays removed.
    const wdCache = new Map<string, Set<string>>();
    const workingDaySet = (pattern: number[], deptId: string | null): Set<string> => {
      const eff = pattern.length > 0 ? pattern : DEFAULT_WORKING_DAYS;
      const key = `${[...eff].sort((a, b) => a - b).join(",")}|${deptId ?? ""}`;
      const cached = wdCache.get(key);
      if (cached) return cached;
      const patternSet = new Set(eff);
      const deptSet = deptId ? deptHolidays.get(deptId) : undefined;
      const set = new Set<string>();
      for (const d = new Date(start); d < rangeEnd; d.setUTCDate(d.getUTCDate() + 1)) {
        const k = this.dateKey(d);
        if (patternSet.has(d.getUTCDay()) && !companyHolidays.has(k) && !(deptSet && deptSet.has(k))) set.add(k);
      }
      wdCache.set(key, set);
      return set;
    };

    // Per-employee day-sets from attendance records.
    const present = new Map<string, Set<string>>();
    const late = new Map<string, Set<string>>();
    const leave = new Map<string, Set<string>>();
    const add = (m: Map<string, Set<string>>, id: string, k: string) => {
      const s = m.get(id) ?? new Set<string>();
      s.add(k);
      m.set(id, s);
    };
    for (const r of records) {
      const k = this.dateKey(r.day);
      if (r.status === "PRESENT") add(present, r.employeeId, k);
      else if (r.status === "LATE") add(late, r.employeeId, k);
      else if (r.status === "ON_LEAVE") add(leave, r.employeeId, k);
    }
    // Approved leave ranges → leave day-set (capped at today).
    for (const lr of approvedLeaves) {
      const s = lr.startDate < start ? new Date(start) : new Date(lr.startDate);
      for (const d = s; d < rangeEnd && d <= lr.endDate; d.setUTCDate(d.getUTCDate() + 1)) add(leave, lr.employeeId, this.dateKey(d));
    }

    const rows = employees.map((e) => {
      const empShift = (e.shiftId ? shiftById.get(e.shiftId) : null) ?? defaultShift;
      const shift = empShift && empShift.status === "ACTIVE" ? empShift : defaultShift;
      const wdSet = workingDaySet(shift ? shift.workingDays : DEFAULT_WORKING_DAYS, e.departmentId);
      const presentDays = present.get(e.id) ?? new Set<string>();
      const lateDays = late.get(e.id) ?? new Set<string>();
      const leaveDays = leave.get(e.id) ?? new Set<string>();
      let onSchedule = 0;
      let onLeave = 0;
      for (const k of wdSet) {
        if (presentDays.has(k) || lateDays.has(k)) onSchedule += 1;
        else if (leaveDays.has(k)) onLeave += 1;
      }
      const workingDays = wdSet.size;
      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        department: e.departmentRef?.name ?? null,
        present: presentDays.size,
        late: lateDays.size,
        onLeave,
        absent: Math.max(0, workingDays - onSchedule - onLeave),
        workingDays,
        attendanceRate: workingDays > 0 ? Math.round((onSchedule / workingDays) * 100) : 0,
      };
    });

    return { month: `${year}-${String(month).padStart(2, "0")}`, workingDays: workingDaySet(defaultShift ? defaultShift.workingDays : DEFAULT_WORKING_DAYS, null).size, rows };
  }

  private dateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
