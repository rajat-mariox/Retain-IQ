import { Injectable } from "@nestjs/common";
import type { Prisma } from "@retainiq/database/identity";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AttendancePolicyService } from "./attendance-policy.service.js";
import { computeTotals, deriveState, deriveStatus, type AttendancePolicy as PolicyShape, type DaySnapshot } from "./attendance-state.js";

interface ShiftLike {
  startMinute: number;
  endMinute: number;
  graceMinutes: number;
  workingDays: number[];
}

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri

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

/** Minutes late past the shift start + grace, in the org's timezone. */
function lateBy(checkInAt: Date, tz: string, shift: ShiftLike | null, graceMinutes: number): number {
  if (!shift) return 0;
  const local = minuteOfDayInTz(checkInAt, tz);
  const allowed = shift.startMinute + (shift.graceMinutes ?? graceMinutes);
  return Math.max(0, local - allowed);
}

/** Minutes left before the shift ended, in the org's timezone. */
function earlyExitBy(checkOutAt: Date, tz: string, shift: ShiftLike): number {
  const local = minuteOfDayInTz(checkOutAt, tz);
  return Math.max(0, shift.endMinute - local);
}

/**
 * Single source of truth for the attendance day roll-up. Loads a day's sessions
 * and breaks plus the applicable policy/shift, derives EVERY user-visible field
 * (totals, overtime, late, early-exit, state, status) and persists it.
 *
 * Both the live check-in/out flow (AttendanceService) and the correction
 * approval flow (AttendanceCorrectionService) recompute through here, so an
 * approved time fix leaves exactly the same derived data a real checkout would —
 * never a partially-rewritten record. Accepts an optional transaction client so
 * it can run inside the correction's `$transaction`.
 *
 * Extracted into its own provider (rather than shared via AttendanceService) to
 * keep AttendanceService and AttendanceCorrectionService free of a DI cycle.
 */
@Injectable()
export class AttendanceRecomputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: AttendancePolicyService,
  ) {}

  /** The employee's own shift (assigned → org default) + the org timezone. */
  private async resolveShift(db: Prisma.TransactionClient, orgId: string, employeeId: string): Promise<{ tz: string; shift: ShiftLike | null }> {
    const [org, employee] = await Promise.all([
      db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
      db.employee.findUnique({ where: { id: employeeId }, select: { shiftRef: { select: { startMinute: true, endMinute: true, graceMinutes: true, workingDays: true, status: true } } } }),
    ]);
    const tz = org?.timezone || "UTC";
    let shift: ShiftLike | null = employee?.shiftRef && employee.shiftRef.status === "ACTIVE" ? employee.shiftRef : null;
    if (!shift) {
      shift = await db.shift.findFirst({ where: { orgId, isDefault: true, status: "ACTIVE" }, select: { startMinute: true, endMinute: true, graceMinutes: true, workingDays: true } });
    }
    return { tz, shift };
  }

  /**
   * Recompute the day roll-up from its sessions and breaks, then persist it.
   * `tx` defaults to the base client, so callers outside a transaction can use
   * it directly; correction approval passes its transaction client so the rewrite
   * and the roll-up commit atomically.
   */
  async recomputeDay(orgId: string, employeeId: string, day: Date, policy?: PolicyShape, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const resolvedPolicy = policy ?? (await this.policies.get(orgId));

    const record = await db.attendanceRecord.findUnique({
      where: { orgId_employeeId_day: { orgId, employeeId, day } },
      include: { sessions: { orderBy: { sequence: "asc" } }, breaks: { orderBy: { startedAt: "asc" } } },
    });
    if (!record) return null;

    const [holiday, leave] = await Promise.all([
      db.holiday.findFirst({ where: { orgId, date: day, OR: [{ type: { not: "DEPARTMENT" } }, { departmentId: undefined }] }, select: { id: true } }),
      db.leaveRequest.findFirst({ where: { orgId, employeeId, status: "APPROVED", startDate: { lte: day }, endDate: { gte: day } }, select: { id: true } }),
    ]);
    const { tz, shift } = await this.resolveShift(db, orgId, employeeId);

    const sessions = record.sessions;
    const breaks = record.breaks;
    const openSession = sessions.find((s) => s.endedAt === null) ?? null;
    const openBreak = breaks.find((b) => b.endedAt === null) ?? null;
    const now = new Date();

    const snapshot: DaySnapshot = {
      isWeekend: !(shift?.workingDays ?? DEFAULT_WORKING_DAYS).includes(day.getUTCDay()),
      isHoliday: Boolean(holiday),
      isOnLeave: Boolean(leave),
      sessionCount: sessions.length,
      hasOpenSession: Boolean(openSession),
      hasClosedSession: sessions.some((s) => s.endedAt !== null),
      hasOpenBreak: Boolean(openBreak),
      breakCount: breaks.length,
      breakMinutesSoFar: breaks.reduce((a, b) => a + b.minutes, 0),
      openBreakMinutes: openBreak ? Math.max(0, Math.round((now.getTime() - openBreak.startedAt.getTime()) / 60000)) : 0,
      openSessionMinutes: openSession ? Math.max(0, Math.round((now.getTime() - openSession.startedAt.getTime()) / 60000)) : 0,
    };

    // Open sessions count up to "now" so live totals tick along with the day.
    const grossMinutes = sessions.reduce((acc, s) => {
      const end = s.endedAt ?? now;
      return acc + Math.max(0, Math.round((end.getTime() - s.startedAt.getTime()) / 60000));
    }, 0);
    const breakMinutes = breaks.reduce((acc, b) => {
      const end = b.endedAt ?? now;
      return acc + (b.endedAt ? b.minutes : Math.max(0, Math.round((end.getTime() - b.startedAt.getTime()) / 60000)));
    }, 0);

    const shiftMinutes = shift ? Math.max(0, shift.endMinute - shift.startMinute) : 0;
    const totals = computeTotals({ grossMinutes, breakMinutes, shiftMinutes, policy: resolvedPolicy });

    const first = sessions[0] ?? null;
    const lastClosed = [...sessions].reverse().find((s) => s.endedAt !== null) ?? null;
    const lateMinutes = first ? lateBy(first.startedAt, tz, shift, resolvedPolicy.graceMinutes) : 0;
    const earlyExitMinutes = lastClosed && shift ? earlyExitBy(lastClosed.endedAt!, tz, shift) : 0;
    const state = deriveState(snapshot, resolvedPolicy);
    const status = deriveStatus({ workMinutes: totals.workMinutes, lateMinutes, policy: resolvedPolicy, hasAnySession: sessions.length > 0 });

    return db.attendanceRecord.update({
      where: { id: record.id },
      data: {
        checkInAt: first?.startedAt ?? null,
        checkOutAt: lastClosed?.endedAt ?? null,
        source: first?.startSource ?? "web",
        checkOutSource: lastClosed?.endSource ?? null,
        workMinutes: totals.workMinutes,
        breakMinutes: totals.breakMinutes,
        unpaidBreakMinutes: totals.unpaidBreakMinutes,
        overtimeMinutes: totals.overtimeMinutes,
        lateMinutes,
        earlyExitMinutes,
        state,
        status,
      },
    });
  }
}
