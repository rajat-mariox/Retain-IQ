import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AuditService } from "../../common/audit/audit.service.js";

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri (0=Sun … 6=Sat)

/** A @db.Date value keyed at UTC-midnight, as "YYYY-MM-DD". */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Every calendar day in [start, end] (inclusive), as UTC-midnight Dates. */
function eachUtcDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    days.push(new Date(t));
  }
  return days;
}

/** The numeric facts a snapshot freezes, plus their provenance. */
export interface SnapshotFacts {
  scheduledDays: number;
  workingDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  holidays: number;
  weeklyOffs: number;
  payableDays: number;
  regularHours: number;
  overtimeHours: number;
  nightHours: number | null;
  sources: Prisma.InputJsonValue;
}

/** Fields a manual override may set on a frozen snapshot (§12 — with reason + approval). */
export interface SnapshotOverride {
  scheduledDays?: number;
  workingDays?: number;
  presentDays?: number;
  paidLeaveDays?: number;
  unpaidLeaveDays?: number;
  holidays?: number;
  weeklyOffs?: number;
  payableDays?: number;
  regularHours?: number;
  overtimeHours?: number;
  nightHours?: number | null;
}

/**
 * Freezes an immutable per-employee input snapshot for a payroll batch (§12).
 *
 * The snapshot is the single source of truth the calculation reads from, so it is
 * built once from APPROVED facts only — approved attendance (present days, worked
 * and approved-overtime minutes) and approved leave (paid vs unpaid, from the
 * leave type). Nothing pending or draft ever reaches payroll. Every input's
 * provenance is recorded in `sources`, and a manual override (present days, LOP,
 * …) is allowed but must carry a reason and is stamped with who applied it, so the
 * override is auditable and the computed baseline it replaced stays visible.
 *
 * Tenant-isolated: every read and write filters by the caller's orgId.
 */
@Injectable()
export class PayrollInputService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Freeze snapshots for every included member of a batch. A member that already
   * carries a manual override is left untouched (re-freezing must never silently
   * discard a hand-entered correction). Returns how many were (re)frozen.
   */
  async freezeForBatch(batchId: string): Promise<{ batchId: string; frozen: number; skippedOverrides: number }> {
    const { orgId } = requireTenantContext();
    const batch = await this.prisma.payrollBatch.findFirst({
      where: { orgId, id: batchId },
      select: { id: true, periodId: true, period: { select: { periodStart: true, periodEnd: true } } },
    });
    if (!batch) throw new NotFoundException("Payroll batch not found.");

    const members = await this.prisma.payrollBatchEmployee.findMany({
      where: { orgId, batchId: batch.id, included: true },
      select: { employeeId: true },
    });

    let frozen = 0;
    let skippedOverrides = 0;
    for (const m of members) {
      const existing = await this.prisma.payrollInputSnapshot.findUnique({
        where: { batchId_employeeId: { batchId: batch.id, employeeId: m.employeeId } },
        select: { manualOverride: true },
      });
      if (existing?.manualOverride) {
        skippedOverrides += 1;
        continue;
      }
      await this.freezeEmployee(orgId, batch.id, m.employeeId, batch.period.periodStart, batch.period.periodEnd);
      frozen += 1;
    }
    return { batchId: batch.id, frozen, skippedOverrides };
  }

  /** Freeze (or re-freeze) one employee's snapshot from approved facts. */
  async freezeEmployee(orgId: string, batchId: string, employeeId: string, periodStart: Date, periodEnd: Date) {
    const facts = await this.computeFacts(orgId, employeeId, periodStart, periodEnd);
    const data = {
      orgId,
      batchId,
      employeeId,
      scheduledDays: new Prisma.Decimal(facts.scheduledDays),
      workingDays: new Prisma.Decimal(facts.workingDays),
      presentDays: new Prisma.Decimal(facts.presentDays),
      paidLeaveDays: new Prisma.Decimal(facts.paidLeaveDays),
      unpaidLeaveDays: new Prisma.Decimal(facts.unpaidLeaveDays),
      holidays: new Prisma.Decimal(facts.holidays),
      weeklyOffs: new Prisma.Decimal(facts.weeklyOffs),
      payableDays: new Prisma.Decimal(facts.payableDays),
      regularHours: new Prisma.Decimal(facts.regularHours),
      overtimeHours: new Prisma.Decimal(facts.overtimeHours),
      nightHours: facts.nightHours === null ? null : new Prisma.Decimal(facts.nightHours),
      sources: facts.sources,
      manualOverride: false,
      overrideReason: null,
      overrideBy: null,
      frozenAt: new Date(),
    };
    const snapshot = await this.prisma.payrollInputSnapshot.upsert({
      where: { batchId_employeeId: { batchId, employeeId } },
      create: data,
      update: data,
    });
    return this.serialize(snapshot);
  }

  /**
   * Apply a manual correction to a frozen snapshot (§12). Requires a reason; stamps
   * the actor and flips `manualOverride` so the calculation and audit trail both
   * know the numbers were hand-adjusted rather than derived. The batch's freeze
   * step then leaves this snapshot alone.
   */
  async applyOverride(batchId: string, employeeId: string, patch: SnapshotOverride, reason: string) {
    const { orgId, userId } = requireTenantContext();
    const trimmed = reason?.trim();
    if (!trimmed) throw new BadRequestException("A reason is required to override payroll inputs.");

    const before = await this.prisma.payrollInputSnapshot.findUnique({
      where: { batchId_employeeId: { batchId, employeeId } },
    });
    if (!before || before.orgId !== orgId) throw new NotFoundException("Input snapshot not found for this batch/employee.");

    const dec = (v: number | undefined) => (v === undefined ? undefined : new Prisma.Decimal(v));
    const updated = await this.prisma.payrollInputSnapshot.update({
      where: { batchId_employeeId: { batchId, employeeId } },
      data: {
        ...(patch.scheduledDays !== undefined ? { scheduledDays: dec(patch.scheduledDays) } : {}),
        ...(patch.workingDays !== undefined ? { workingDays: dec(patch.workingDays) } : {}),
        ...(patch.presentDays !== undefined ? { presentDays: dec(patch.presentDays) } : {}),
        ...(patch.paidLeaveDays !== undefined ? { paidLeaveDays: dec(patch.paidLeaveDays) } : {}),
        ...(patch.unpaidLeaveDays !== undefined ? { unpaidLeaveDays: dec(patch.unpaidLeaveDays) } : {}),
        ...(patch.holidays !== undefined ? { holidays: dec(patch.holidays) } : {}),
        ...(patch.weeklyOffs !== undefined ? { weeklyOffs: dec(patch.weeklyOffs) } : {}),
        ...(patch.payableDays !== undefined ? { payableDays: dec(patch.payableDays) } : {}),
        ...(patch.regularHours !== undefined ? { regularHours: dec(patch.regularHours) } : {}),
        ...(patch.overtimeHours !== undefined ? { overtimeHours: dec(patch.overtimeHours) } : {}),
        ...(patch.nightHours !== undefined ? { nightHours: patch.nightHours === null ? null : new Prisma.Decimal(patch.nightHours) } : {}),
        manualOverride: true,
        overrideReason: trimmed,
        overrideBy: userId,
        frozenAt: new Date(),
      },
    });

    await this.audit.record({
      orgId,
      actorUserId: userId,
      resourceType: "PayrollInputSnapshot",
      resourceId: updated.id,
      action: "payroll.input.override",
      before: this.serialize(before),
      after: this.serialize(updated),
      metadata: { reason: trimmed },
    });
    return this.serialize(updated);
  }

  /** Read one frozen snapshot (org-scoped). */
  async get(batchId: string, employeeId: string) {
    const { orgId } = requireTenantContext();
    const snap = await this.prisma.payrollInputSnapshot.findUnique({
      where: { batchId_employeeId: { batchId, employeeId } },
    });
    if (!snap || snap.orgId !== orgId) throw new NotFoundException("Input snapshot not found.");
    return this.serialize(snap);
  }

  // ---- Fact derivation (APPROVED inputs only) ----

  /**
   * Derive the payroll facts for one employee over [periodStart, periodEnd] from
   * approved attendance and approved leave. Working days come from the employee's
   * shift pattern (falling back to the org default shift, then Mon–Fri), minus
   * holidays. Present days count only PRESENT/LATE attendance rows; hours come from
   * the recorded net worked minutes and the manager-approved overtime minutes.
   */
  private async computeFacts(orgId: string, employeeId: string, periodStart: Date, periodEnd: Date): Promise<SnapshotFacts> {
    const employee = await this.prisma.employee.findFirst({
      where: { orgId, id: employeeId },
      select: { departmentId: true, shiftRef: { select: { workingDays: true } } },
    });
    if (!employee) throw new NotFoundException("Employee not found.");

    const defaultShift = await this.prisma.shift.findFirst({
      where: { orgId, isDefault: true, status: "ACTIVE" },
      select: { workingDays: true },
    });
    const workingPattern =
      employee.shiftRef?.workingDays && employee.shiftRef.workingDays.length > 0
        ? employee.shiftRef.workingDays
        : defaultShift?.workingDays && defaultShift.workingDays.length > 0
          ? defaultShift.workingDays
          : DEFAULT_WORKING_DAYS;
    const patternSet = new Set(workingPattern);

    const [attendance, holidayRows, approvedLeaves] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { orgId, employeeId, day: { gte: periodStart, lte: periodEnd } },
        select: { id: true, day: true, status: true, workMinutes: true, approvedOvertimeMinutes: true },
      }),
      this.prisma.holiday.findMany({
        where: { orgId, date: { gte: periodStart, lte: periodEnd } },
        select: { date: true, type: true, departmentId: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: { orgId, employeeId, status: "APPROVED", startDate: { lte: periodEnd }, endDate: { gte: periodStart } },
        select: { id: true, startDate: true, endDate: true, dayPart: true, leaveType: { select: { paid: true, code: true } } },
      }),
    ]);

    // Holiday date-keys that apply to this employee: company/regional apply to all,
    // DEPARTMENT holidays only when they match the employee's department.
    const holidayKeys = new Set<string>();
    for (const h of holidayRows) {
      if (h.type === "DEPARTMENT") {
        if (h.departmentId && h.departmentId === employee.departmentId) holidayKeys.add(dateKey(h.date));
      } else {
        holidayKeys.add(dateKey(h.date));
      }
    }
    const isWorkingDay = (d: Date): boolean => patternSet.has(d.getUTCDay()) && !holidayKeys.has(dateKey(d));

    const days = eachUtcDay(periodStart, periodEnd);
    const scheduledDays = days.length;
    let workingDays = 0;
    let weeklyOffs = 0;
    for (const d of days) {
      const key = dateKey(d);
      if (!patternSet.has(d.getUTCDay())) weeklyOffs += 1;
      else if (!holidayKeys.has(key)) workingDays += 1;
    }
    const holidays = days.filter((d) => holidayKeys.has(dateKey(d))).length;

    // Present days = approved attendance marked PRESENT or LATE. Hours + approved OT
    // come straight off the roll-up (workMinutes is already net of unpaid breaks).
    const presentKeys = new Set<string>();
    let regularMinutes = 0;
    let overtimeMinutes = 0;
    const attendanceIds: string[] = [];
    for (const r of attendance) {
      attendanceIds.push(r.id);
      if (r.status === "PRESENT" || r.status === "LATE") presentKeys.add(dateKey(r.day));
      regularMinutes += r.workMinutes;
      overtimeMinutes += r.approvedOvertimeMinutes;
    }
    const presentDays = presentKeys.size;

    // Approved leave, split paid vs unpaid by the leave type. Only working days that
    // fall inside the period count; a half-day request contributes 0.5.
    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;
    const leaveIds: string[] = [];
    for (const lr of approvedLeaves) {
      leaveIds.push(lr.id);
      const from = lr.startDate < periodStart ? periodStart : lr.startDate;
      const to = lr.endDate > periodEnd ? periodEnd : lr.endDate;
      let count = 0;
      for (const d of eachUtcDay(from, to)) if (isWorkingDay(d)) count += 1;
      // A half-day only applies to a single-date request (matches leave module rules).
      if (lr.dayPart !== "FULL" && dateKey(lr.startDate) === dateKey(lr.endDate)) count = count > 0 ? 0.5 : 0;
      if (lr.leaveType.paid) paidLeaveDays += count;
      else unpaidLeaveDays += count;
    }

    // Payable working days. Two models, chosen by whether attendance is tracked:
    //   • Attendance tracked (there are attendance rows this period): pay follows
    //     attendance — payable = present + paid leave, so genuine absences reduce
    //     pay (correct for shops/factories where presence is the pay signal).
    //   • Attendance NOT tracked (no rows at all): the salaried default — the
    //     employee is paid the full period minus only EXPLICIT unpaid leave. A new
    //     org that hasn't rolled out attendance still runs salaried payroll
    //     correctly instead of docking everyone to zero.
    // (This heuristic can later move to a per-org policy.)
    const attendanceTracked = attendanceIds.length > 0;
    const payableDays = attendanceTracked
      ? Math.min(workingDays, presentDays + paidLeaveDays)
      : Math.max(0, workingDays - unpaidLeaveDays);

    const sources = {
      attendance: { recordIds: attendanceIds, count: attendanceIds.length },
      leave: { requestIds: leaveIds, count: leaveIds.length },
      holidays: { dates: [...holidayKeys] },
      shift: { workingDays: [...patternSet], source: employee.shiftRef ? "employee" : defaultShift ? "org-default" : "fallback" },
      period: { start: dateKey(periodStart), end: dateKey(periodEnd) },
      computedAt: new Date().toISOString(),
      approvedOnly: true,
    } satisfies Prisma.InputJsonValue;

    return {
      scheduledDays,
      workingDays,
      presentDays,
      paidLeaveDays,
      unpaidLeaveDays,
      holidays,
      weeklyOffs,
      payableDays,
      regularHours: round2(regularMinutes / 60),
      overtimeHours: round2(overtimeMinutes / 60),
      nightHours: null, // night-shift hours are not tracked in Phase 1
      sources,
    };
  }

  private serialize(s: {
    id: string;
    batchId: string;
    employeeId: string;
    scheduledDays: Prisma.Decimal | null;
    workingDays: Prisma.Decimal | null;
    presentDays: Prisma.Decimal | null;
    paidLeaveDays: Prisma.Decimal | null;
    unpaidLeaveDays: Prisma.Decimal | null;
    holidays: Prisma.Decimal | null;
    weeklyOffs: Prisma.Decimal | null;
    payableDays: Prisma.Decimal | null;
    regularHours: Prisma.Decimal | null;
    overtimeHours: Prisma.Decimal | null;
    nightHours: Prisma.Decimal | null;
    sources: Prisma.JsonValue;
    manualOverride: boolean;
    overrideReason: string | null;
    overrideBy: string | null;
    frozenAt: Date;
  }) {
    const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
    return {
      id: s.id,
      batchId: s.batchId,
      employeeId: s.employeeId,
      scheduledDays: num(s.scheduledDays),
      workingDays: num(s.workingDays),
      presentDays: num(s.presentDays),
      paidLeaveDays: num(s.paidLeaveDays),
      unpaidLeaveDays: num(s.unpaidLeaveDays),
      holidays: num(s.holidays),
      weeklyOffs: num(s.weeklyOffs),
      payableDays: num(s.payableDays),
      regularHours: num(s.regularHours),
      overtimeHours: num(s.overtimeHours),
      nightHours: num(s.nightHours),
      sources: s.sources,
      manualOverride: s.manualOverride,
      overrideReason: s.overrideReason,
      overrideBy: s.overrideBy,
      frozenAt: s.frozenAt.toISOString(),
    };
  }
}

/** Round to 2 decimal places (half-up) for a display-friendly hours figure. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
