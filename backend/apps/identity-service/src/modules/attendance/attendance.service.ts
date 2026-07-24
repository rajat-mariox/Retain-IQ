import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { getRequestContext, requireTenantContext } from "../../common/context/request-context.store.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { OrgRolesService } from "../../common/org-roles/org-roles.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { RealtimePublisher } from "../../common/realtime/realtime-publisher.service.js";
import { AttendancePolicyService } from "./attendance-policy.service.js";
import { AttendanceRecomputeService } from "./attendance-recompute.service.js";
import {
  availableActions,
  can,
  computeTotals,
  deriveState,
  deriveStatus,
  type AttendanceAction,
  type AttendancePolicy as PolicyShape,
  type AttendanceState as AttendanceStateName,
  type DaySnapshot,
} from "./attendance-state.js";

/** Which client performed an attendance action. */
export type AttendanceSource = "web" | "agent";

const minutesBetween = (from: Date, to: Date): number => Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));

// Fallback threshold when an employee has no shift and the org has no default:
// checking out before 17:00 is an early exit.
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

/**
 * The org-local calendar date of an instant, returned as a UTC-midnight Date so
 * it keys the `AttendanceRecord.day` column consistently (that column stores a
 * date, not an instant). Uses the same `Intl.DateTimeFormat` technique as
 * `minuteOfDayInTz`: format the instant in the org tz, then rebuild the Y/M/D at
 * UTC midnight. This is what makes an after-midnight-IST check-in bucket under
 * the correct local date instead of drifting a day back to UTC.
 */
function attendanceDayFor(instant: Date, tz: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
    const y = Number(parts.find((p) => p.type === "year")?.value);
    const m = Number(parts.find((p) => p.type === "month")?.value);
    const d = Number(parts.find((p) => p.type === "day")?.value);
    if (!y || !m || !d) return startOfUtcDay(instant);
    return new Date(Date.UTC(y, m - 1, d));
  } catch {
    return startOfUtcDay(instant);
  }
}

/** A shift whose end is at or before its start spans midnight (e.g. 22:00–06:00). */
function isOvernight(shift: ShiftLike): boolean {
  return shift.endMinute <= shift.startMinute;
}

/**
 * The calendar-day bucket for an attendance action, in the org timezone.
 *
 * For an overnight shift (e.g. 22:00–06:00) the whole session must land on ONE
 * row keyed to the shift's START local date, so an after-midnight check-in/out
 * doesn't split across two rows. When the instant's local time-of-day is already
 * past the shift start we're on the start date; when it's before the shift start
 * (i.e. after midnight, in the tail of the shift) we belong to the PREVIOUS
 * local date.
 */
function shiftDayFor(instant: Date, tz: string, shift: ShiftLike | null): Date {
  const localDay = attendanceDayFor(instant, tz);
  if (!shift || !isOvernight(shift)) return localDay;
  const mod = minuteOfDayInTz(instant, tz);
  if (mod < shift.startMinute) {
    // After midnight, in the tail of the overnight shift → belongs to yesterday's start date.
    return new Date(localDay.getTime() - 86_400_000);
  }
  return localDay;
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

interface ShiftBreakDef {
  name: string;
  startMinute: number;
  endMinute: number;
}

function parseBreaks(raw: unknown): ShiftBreakDef[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (b): b is ShiftBreakDef => Boolean(b) && typeof b === "object" && typeof (b as ShiftBreakDef).startMinute === "number" && typeof (b as ShiftBreakDef).endMinute === "number",
  );
}

/**
 * Scheduled break minutes overlapping a worked window [inMin, outMin] in the org
 * timezone. Overnight worked windows (out ≤ in) deduct the full scheduled break.
 */
function breakMinutesInWindow(breaks: ShiftBreakDef[], inMin: number, outMin: number): number {
  if (breaks.length === 0) return 0;
  if (outMin <= inMin) return breaks.reduce((s, b) => s + Math.max(0, b.endMinute - b.startMinute), 0);
  let overlap = 0;
  for (const b of breaks) {
    const s = Math.max(inMin, b.startMinute);
    const e = Math.min(outMin, b.endMinute);
    if (e > s) overlap += e - s;
  }
  return overlap;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly orgRoles: OrgRolesService,
    private readonly realtime: RealtimePublisher,
    private readonly policies: AttendancePolicyService,
    private readonly recompute: AttendanceRecomputeService,
  ) {}

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

  /**
   * The tz-aware "current" attendance day bucket for this employee, plus the tz
   * and shift used to derive it (so callers can reuse them). For an overnight
   * shift the whole session keys to the shift's start local date. New records
   * only — historical UTC-bucketed rows are left untouched (no backfill).
   */
  private async resolveToday(orgId: string, employeeId: string, at = new Date()): Promise<{ day: Date; tz: string; shift: ShiftLike | null }> {
    const { tz, shift } = await this.resolveShift(orgId, employeeId);
    return { day: shiftDayFor(at, tz, shift), tz, shift };
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

  /**
   * The Owner runs the organization rather than working shifts in it, so they
   * are not rostered, chased for attendance, or counted in workforce reports.
   * Blocking the write here keeps that rule true no matter which client calls —
   * browser, desktop agent, or a direct API call.
   */
  private async assertTracksAttendance(orgId: string, employeeId: string): Promise<void> {
    if (await this.orgRoles.isOwnerEmployee(orgId, employeeId)) {
      throw new ForbiddenException("Attendance is tracked for staff only; owner accounts are excluded.");
    }
  }

  /**
   * Load everything the state machine needs about a day, in one round trip.
   * Sessions and breaks are the source of truth; the AttendanceRecord row is a
   * roll-up we recompute from them.
   */
  private async loadDay(orgId: string, employeeId: string, day: Date) {
    const [record, holiday, leave, employee] = await Promise.all([
      this.prisma.attendanceRecord.findUnique({
        where: { orgId_employeeId_day: { orgId, employeeId, day } },
        include: { sessions: { orderBy: { sequence: "asc" } }, breaks: { orderBy: { startedAt: "asc" } } },
      }),
      this.prisma.holiday.findFirst({
        where: { orgId, date: day, OR: [{ type: { not: "DEPARTMENT" } }, { departmentId: undefined }] },
        select: { id: true },
      }),
      this.prisma.leaveRequest.findFirst({
        where: { orgId, employeeId, status: "APPROVED", startDate: { lte: day }, endDate: { gte: day } },
        select: { id: true },
      }),
      this.prisma.employee.findUnique({ where: { id: employeeId }, select: { departmentId: true } }),
    ]);
    void employee;

    const sessions = record?.sessions ?? [];
    const breaks = record?.breaks ?? [];
    const openSession = sessions.find((s) => s.endedAt === null) ?? null;
    const openBreak = breaks.find((b) => b.endedAt === null) ?? null;
    const { tz, shift } = await this.resolveShift(orgId, employeeId);

    const isWeekend = !(shift?.workingDays ?? DEFAULT_WORKING_DAYS).includes(day.getUTCDay());
    const now = Date.now();
    const snapshot: DaySnapshot = {
      isWeekend,
      isHoliday: Boolean(holiday),
      isOnLeave: Boolean(leave),
      sessionCount: sessions.length,
      hasOpenSession: Boolean(openSession),
      hasClosedSession: sessions.some((s) => s.endedAt !== null),
      hasOpenBreak: Boolean(openBreak),
      breakCount: breaks.length,
      breakMinutesSoFar: breaks.reduce((a, b) => a + b.minutes, 0),
      openBreakMinutes: openBreak ? Math.max(0, Math.round((now - openBreak.startedAt.getTime()) / 60000)) : 0,
    };

    return { record, sessions, breaks, openSession, openBreak, snapshot, tz, shift };
  }

  /** Guard an action through the state machine, raising the reason it gave. */
  private assertAllowed(action: AttendanceAction, snapshot: DaySnapshot, policy: PolicyShape): void {
    const decision = can(action, snapshot, policy);
    if (!decision.allowed) throw new BadRequestException(decision.reason ?? "That action isn't available right now.");
  }

  /**
   * Recompute the day roll-up from its sessions and breaks, then persist it.
   * Everything user-visible (totals, state, status) is derived here so the
   * summary can never drift from the underlying events.
   */
  private async recomputeDay(orgId: string, employeeId: string, day: Date, policy: PolicyShape) {
    return this.recompute.recomputeDay(orgId, employeeId, day, policy);
  }

  /** Append to the audit trail. Never blocks the action it describes. */
  private async recordEvent(args: {
    orgId: string;
    employeeId: string;
    attendanceId: string;
    type: string;
    fromState: AttendanceStateName;
    toState: AttendanceStateName;
    source: string;
    workLocation?: string | null;
    note?: string | null;
  }): Promise<void> {
    try {
      const ctx = getRequestContext();
      await this.prisma.attendanceEvent.create({
        data: {
          orgId: args.orgId,
          employeeId: args.employeeId,
          attendanceId: args.attendanceId,
          type: args.type,
          fromState: args.fromState,
          toState: args.toState,
          source: args.source,
          actorUserId: ctx?.userId ?? null,
          workLocation: args.workLocation ?? null,
          ipAddress: ctx?.ipAddress ?? null,
          note: args.note ?? null,
        },
      });
    } catch {
      // The audit trail is supporting evidence, not a gate on the action.
    }
  }

  /**
   * Open a work session. The first of the day creates the record; later ones are
   * re-entry / split shifts, allowed only when org policy says so.
   */
  async checkIn(source: AttendanceSource = "web", workLocation?: string) {
    const { orgId, employeeId } = await this.caller();
    await this.assertTracksAttendance(orgId, employeeId);
    const policy = await this.policies.get(orgId);
    const { day } = await this.resolveToday(orgId, employeeId);

    const before = await this.loadDay(orgId, employeeId, day);
    this.assertAllowed("CHECK_IN", before.snapshot, policy);
    const location = this.resolveLocation(workLocation, policy);
    const fromState = deriveState(before.snapshot, policy);
    const ctx = getRequestContext();
    const now = new Date();

    // Ensure the day row exists, then append the session.
    const record =
      before.record ??
      (await this.prisma.attendanceRecord.create({
        data: { orgId, employeeId, day, status: "PRESENT", source, ipAddress: ctx?.ipAddress ?? null, workLocation: location },
      }));

    await this.prisma.attendanceSession.create({
      data: {
        orgId,
        employeeId,
        attendanceId: record.id,
        sequence: before.sessions.length + 1,
        startedAt: now,
        startSource: source,
        workLocation: location,
        startIp: ctx?.ipAddress ?? null,
      },
    });

    const updated = await this.recomputeDay(orgId, employeeId, day, policy);
    await this.recordEvent({
      orgId, employeeId, attendanceId: record.id, type: "CHECK_IN",
      fromState, toState: "WORKING", source, workLocation: location,
    });
    await this.publish(orgId, employeeId, "checked-in", record);
    return updated ?? record;
  }

  /** Close the open session (and any break still running inside it). */
  async checkOut(source: AttendanceSource = "web") {
    const { orgId, employeeId } = await this.caller();
    await this.assertTracksAttendance(orgId, employeeId);
    const policy = await this.policies.get(orgId);
    const { day } = await this.resolveToday(orgId, employeeId);

    const before = await this.loadDay(orgId, employeeId, day);
    this.assertAllowed("CHECK_OUT", before.snapshot, policy);
    const fromState = deriveState(before.snapshot, policy);
    const ctx = getRequestContext();
    const now = new Date();

    // Policy may permit checking out mid-break; close that break too so its
    // time is accounted for rather than left running.
    if (before.openBreak) {
      await this.prisma.attendanceBreak.update({
        where: { id: before.openBreak.id },
        data: { endedAt: now, minutes: minutesBetween(before.openBreak.startedAt, now) },
      });
    }
    if (before.openSession) {
      await this.prisma.attendanceSession.update({
        where: { id: before.openSession.id },
        data: {
          endedAt: now,
          endSource: source,
          endIp: ctx?.ipAddress ?? null,
          minutes: minutesBetween(before.openSession.startedAt, now),
        },
      });
    }

    const updated = await this.recomputeDay(orgId, employeeId, day, policy);
    const after = await this.loadDay(orgId, employeeId, day);
    await this.recordEvent({
      orgId, employeeId, attendanceId: before.record!.id, type: "CHECK_OUT",
      fromState, toState: deriveState(after.snapshot, policy), source,
    });
    await this.publish(orgId, employeeId, "checked-out", before.record!);
    return updated;
  }

  /** Start a break inside the open session. */
  async startBreak(source: AttendanceSource = "web", kind = "BREAK") {
    const { orgId, employeeId } = await this.caller();
    await this.assertTracksAttendance(orgId, employeeId);
    const policy = await this.policies.get(orgId);
    const { day } = await this.resolveToday(orgId, employeeId);

    const before = await this.loadDay(orgId, employeeId, day);
    this.assertAllowed("BREAK_START", before.snapshot, policy);
    const fromState = deriveState(before.snapshot, policy);

    // Paid vs unpaid is decided at day level (first N minutes are paid), so the
    // flag here records intent; the roll-up does the actual split.
    const br = await this.prisma.attendanceBreak.create({
      data: {
        orgId,
        employeeId,
        attendanceId: before.record!.id,
        sessionId: before.openSession?.id ?? null,
        kind,
        source,
        paid: policy.paidBreakMinutesPerDay > 0,
      },
    });

    await this.recomputeDay(orgId, employeeId, day, policy);
    await this.recordEvent({
      orgId, employeeId, attendanceId: before.record!.id, type: "BREAK_START",
      fromState, toState: "ON_BREAK", source, note: kind,
    });
    await this.publish(orgId, employeeId, "break-started", before.record!);
    return br;
  }

  /** End the open break; its minutes flow into the day roll-up. */
  async endBreak(source: AttendanceSource = "web") {
    const { orgId, employeeId } = await this.caller();
    await this.assertTracksAttendance(orgId, employeeId);
    const policy = await this.policies.get(orgId);
    const { day } = await this.resolveToday(orgId, employeeId);

    const before = await this.loadDay(orgId, employeeId, day);
    this.assertAllowed("BREAK_END", before.snapshot, policy);
    const fromState = deriveState(before.snapshot, policy);
    const now = new Date();
    const open = before.openBreak!;

    const br = await this.prisma.attendanceBreak.update({
      where: { id: open.id },
      data: { endedAt: now, minutes: minutesBetween(open.startedAt, now), source },
    });

    await this.recomputeDay(orgId, employeeId, day, policy);
    const after = await this.loadDay(orgId, employeeId, day);
    await this.recordEvent({
      orgId, employeeId, attendanceId: before.record!.id, type: "BREAK_END",
      fromState, toState: deriveState(after.snapshot, policy), source,
    });
    await this.publish(orgId, employeeId, "break-ended", before.record!);
    return br;
  }

  /** Only locations the org permits; ignored entirely when not required. */
  private resolveLocation(requested: string | undefined, policy: PolicyShape): string | null {
    if (!requested) {
      if (policy.requireLocation) throw new BadRequestException("A work location is required to check in.");
      return null;
    }
    const upper = requested.toUpperCase();
    if (!policy.allowedLocations.includes(upper)) {
      throw new BadRequestException(`"${requested}" is not an allowed work location for your organization.`);
    }
    return upper;
  }

  /**
   * Live state for the caller — the single source both the web app and the
   * desktop agent render from, including which actions are currently valid.
   */
  async liveStatus() {
    const { orgId, employeeId } = await this.caller();
    const { day } = await this.resolveToday(orgId, employeeId);
    const isOwner = await this.orgRoles.isOwnerEmployee(orgId, employeeId);
    const policy = await this.policies.get(orgId);
    const { record, sessions, breaks, openSession, openBreak, snapshot, shift } = await this.loadDay(orgId, employeeId, day);

    const state = deriveState(snapshot, policy);
    const now = new Date();
    const grossMinutes = sessions.reduce((acc, s) => acc + minutesBetween(s.startedAt, s.endedAt ?? now), 0);
    const breakMinutes = breaks.reduce((acc, b) => acc + (b.endedAt ? b.minutes : minutesBetween(b.startedAt, now)), 0);
    const shiftMinutes = shift ? Math.max(0, shift.endMinute - shift.startMinute) : 0;
    const totals = computeTotals({ grossMinutes, breakMinutes, shiftMinutes, policy });

    return {
      tracksAttendance: !isOwner,
      day: day.toISOString().slice(0, 10),
      state,
      availableActions: isOwner ? [] : availableActions(snapshot, policy),
      // Kept for existing clients that read booleans rather than the state.
      checkedIn: snapshot.hasOpenSession || snapshot.hasOpenBreak,
      checkedOut: Boolean(record?.checkOutAt) && !snapshot.hasOpenSession,
      onBreak: snapshot.hasOpenBreak,
      checkInAt: record?.checkInAt ? record.checkInAt.toISOString() : null,
      checkOutAt: record?.checkOutAt ? record.checkOutAt.toISOString() : null,
      source: record?.source ?? null,
      checkOutSource: record?.checkOutSource ?? null,
      workLocation: record?.workLocation ?? null,
      openBreakStartedAt: openBreak ? openBreak.startedAt.toISOString() : null,
      openSessionStartedAt: openSession ? openSession.startedAt.toISOString() : null,
      // Live totals — tick along with an open session.
      workMinutes: totals.workMinutes,
      breakMinutes: totals.breakMinutes,
      unpaidBreakMinutes: totals.unpaidBreakMinutes,
      overtimeMinutes: totals.overtimeMinutes,
      lateMinutes: record?.lateMinutes ?? 0,
      earlyExitMinutes: record?.earlyExitMinutes ?? 0,
      sessionCount: sessions.length,
      breakCount: breaks.length,
      status: record?.status ?? null,
      policy: {
        allowMultipleSessions: policy.allowMultipleSessions,
        allowReEntry: policy.allowReEntry,
        maxSessionsPerDay: policy.maxSessionsPerDay,
        allowCheckOutOnBreak: policy.allowCheckOutOnBreak,
        requireLocation: policy.requireLocation,
        allowedLocations: policy.allowedLocations,
        workModel: policy.workModel,
      },
      sessions: sessions.map((s) => ({
        id: s.id,
        sequence: s.sequence,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
        minutes: s.endedAt ? s.minutes : minutesBetween(s.startedAt, now),
        startSource: s.startSource,
        endSource: s.endSource,
        workLocation: s.workLocation,
        autoClosed: s.autoClosed,
      })),
      breaks: breaks.map((b) => ({
        id: b.id,
        sessionId: b.sessionId,
        startedAt: b.startedAt.toISOString(),
        endedAt: b.endedAt ? b.endedAt.toISOString() : null,
        minutes: b.endedAt ? b.minutes : minutesBetween(b.startedAt, now),
        kind: b.kind,
        paid: b.paid,
        source: b.source,
      })),
    };
  }

  /**
   * Push the new state to every live client of this user (browser tabs + the
   * desktop agent) so a check-in on one surface reflects on the other at once.
   * Best-effort: attendance is already persisted, this is only the nudge.
   */
  private async publish(orgId: string, employeeId: string, event: string, record: { id: string }): Promise<void> {
    try {
      const membership = await this.prisma.organizationMembership.findFirst({
        where: { orgId, employeeId, status: "ACTIVE" },
        select: { userId: true },
      });
      if (!membership?.userId) return;
      await this.realtime.publishToUser(membership.userId, {
        type: "attendance",
        event,
        attendanceId: record.id,
        at: new Date().toISOString(),
      });
    } catch {
      // never fail the attendance write because a live nudge couldn't be sent
    }
  }

  async me() {
    const { orgId, employeeId } = await this.caller();
    const { day, tz } = await this.resolveToday(orgId, employeeId);
    const since = attendanceDayFor(new Date(Date.now() - 14 * 86_400_000), tz);
    const [today, history] = await Promise.all([
      this.prisma.attendanceRecord.findUnique({ where: { orgId_employeeId_day: { orgId, employeeId, day } } }),
      this.prisma.attendanceRecord.findMany({ where: { orgId, employeeId, day: { gte: since } }, orderBy: { day: "desc" } }),
    ]);
    return { today, history };
  }

  /** The org's IANA timezone (defaults to UTC), for report day/month boundaries. */
  private async orgTz(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
    return org?.timezone || "UTC";
  }

  /** Today's calendar day in the org timezone, keyed as UTC-midnight (matches record buckets). */
  private async orgToday(orgId: string): Promise<Date> {
    return attendanceDayFor(new Date(), await this.orgTz(orgId));
  }

  /** Org-wide attendance metrics for today (admin view) — owner excluded, absentees counted. */
  async today() {
    const ctx = requireTenantContext();
    const day = await this.orgToday(ctx.orgId);
    const rows = await this.dayRoster(ctx.orgId, day);
    const summary = this.summarize(rows);
    return { day: day.toISOString().slice(0, 10), totalEmployees: summary.total, ...summary };
  }

  /** Owner accounts are provisioned as employees but excluded from workforce reports. */
  /** Per-employee attendance rows for a single day; no-record employees are ABSENT (or ON_LEAVE). */
  private async dayRoster(orgId: string, day: Date) {
    const ctx = requireTenantContext();
    const exclude = await this.orgRoles.ownerEmployeeIds(orgId);
    // A department/team-scoped reader only sees their own people's attendance.
    const scope = await this.accessScope.resolveScope(orgId, ctx.userId, permissions.attendanceRead);
    const scopeWhere = this.accessScope.employeeWhere(scope);
    const [org, shifts, employees, records, holidays, leaves] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
      this.prisma.shift.findMany({ where: { orgId }, select: { id: true, startMinute: true, endMinute: true, graceMinutes: true, workingDays: true, breaks: true, isDefault: true, status: true } }),
      this.prisma.employee.findMany({
        where: { orgId, status: { in: ["ACTIVE", "ON_LEAVE", "NOTICE_PERIOD"] }, ...scopeWhere, ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}) },
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
      // Deduct scheduled shift breaks (lunch/dinner/…) from worked time → net.
      const workMinutes = r?.workMinutes ?? 0;
      let breakMinutes = 0;
      if (r?.checkInAt && r?.checkOutAt && shift) {
        breakMinutes = breakMinutesInWindow(parseBreaks(shift.breaks), minuteOfDayInTz(r.checkInAt, tz), minuteOfDayInTz(r.checkOutAt, tz));
      }
      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        departmentId: e.departmentId,
        department: e.departmentRef?.name ?? null,
        status,
        checkInAt: r?.checkInAt ?? null,
        checkOutAt: r?.checkOutAt ?? null,
        workMinutes,
        breakMinutes,
        netWorkMinutes: Math.max(0, workMinutes - breakMinutes),
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

  // An explicit YYYY-MM-DD is a date-only value keyed at UTC midnight (matching
  // the record buckets); only the "today" default needs the org timezone.
  private async resolveDay(orgId: string, dayStr?: string): Promise<Date> {
    if (!dayStr) return this.orgToday(orgId);
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
    const day = await this.orgToday(ctx.orgId);
    const rows = await this.dayRoster(ctx.orgId, day);
    return { day: day.toISOString().slice(0, 10), summary: this.summarize(rows), rows };
  }

  /** Daily Attendance report — per-employee attendance for any day (defaults to today). */
  async reportDaily(dayStr?: string) {
    const ctx = requireTenantContext();
    const day = await this.resolveDay(ctx.orgId, dayStr);
    const rows = await this.dayRoster(ctx.orgId, day);
    return { day: day.toISOString().slice(0, 10), summary: this.summarize(rows), rows };
  }

  /** Department Attendance report — attendance grouped by department for a day. */
  async reportDepartment(dayStr?: string) {
    const ctx = requireTenantContext();
    const day = await this.resolveDay(ctx.orgId, dayStr);
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
    // "Today" and the default month are keyed to the org timezone so month
    // boundaries agree with the tz-bucketed record days.
    const today = await this.orgToday(ctx.orgId);
    let year = today.getUTCFullYear();
    let month = today.getUTCMonth() + 1;
    if (monthStr) {
      const [y, m] = monthStr.split("-").map(Number);
      if (!y || !m || m < 1 || m > 12) throw new BadRequestException("Invalid month (expected YYYY-MM).");
      year = y;
      month = m;
    }
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1)); // exclusive

    const rangeEnd = end.getTime() < today.getTime() + 86_400_000 ? end : new Date(today.getTime() + 86_400_000); // min(end, today+1)
    const exclude = await this.orgRoles.ownerEmployeeIds(ctx.orgId);
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
