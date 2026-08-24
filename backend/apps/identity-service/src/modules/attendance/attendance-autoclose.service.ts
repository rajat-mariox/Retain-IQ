import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AnalyticsReadPrismaService } from "../../common/database/analytics-prisma.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { logger } from "../../common/observability/observability.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { AttendancePolicyService } from "./attendance-policy.service.js";
import { ShiftRotationService, type RotationStep } from "../org-structure/shift-rotation.service.js";

const DAY_MS = 24 * 3600 * 1000;

interface ShiftLike {
  startMinute: number;
  endMinute: number;
  graceMinutes: number;
  workingDays: number[];
}

/**
 * Closes work sessions the employee never closed themselves.
 *
 * ## Why the end time is clamped
 *
 * Auto-closing at the moment the sweeper happens to run would reward *not*
 * checking out: leave the session open until midnight and the day bills five
 * extra hours. So the recorded end time is the earliest defensible instant:
 *
 *     endedAt = min(last observed activity, shift end + grace)
 *
 * Both bounds matter. Last activity is the truth when the desktop agent is
 * running — someone who genuinely worked late still gets credited to their last
 * keystroke. The shift bound catches the case where there is no activity signal
 * at all (browser-only user), and caps an agent left running on an idle machine.
 * Neither can push the day beyond what was actually worked.
 *
 * Overtime is additionally zeroed on auto-closed days: overtime is a claim, and
 * a claim requires the deliberate act of checking out. This removes the last
 * incentive to "forget" — leaving a session open can only ever lose you time,
 * never gain it.
 */
@Injectable()
export class AttendanceAutoCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsReadPrismaService,
    private readonly policies: AttendancePolicyService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Runs often so shifts close near their own end rather than all at midnight —
   * a night shift ending 06:00 shouldn't stay "working" until the next night.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    try {
      const open = await this.prisma.attendanceSession.findMany({
        where: { endedAt: null },
        select: { id: true, orgId: true, employeeId: true, startedAt: true, attendanceId: true },
        take: 500,
      });
      if (open.length === 0) return;

      let closed = 0;
      for (const session of open) {
        if (await this.maybeClose(session)) closed += 1;
      }
      if (closed > 0) logger.info({ closed, candidates: open.length }, "auto-closed stale attendance sessions");
    } catch (error) {
      logger.warn({ err: String(error) }, "attendance auto-close sweep failed");
    }
  }

  private async maybeClose(session: {
    id: string;
    orgId: string;
    employeeId: string;
    startedAt: Date;
    attendanceId: string;
  }): Promise<boolean> {
    const policy = await this.policies.get(session.orgId);
    if (!policy.autoCheckOutAtShiftEnd) return false;

    const { tz, shift } = await this.resolveShift(session.orgId, session.employeeId, session.startedAt);
    const now = new Date();

    // The instant the shift was over for this session's day, plus the org's
    // configured slack. Until then, an open session is simply someone at work.
    const shiftEnd = this.shiftEndInstant(session.startedAt, tz, shift);
    const closeAfter = new Date(shiftEnd.getTime() + policy.autoCheckOutAfterMinutes * 60_000);
    if (now < closeAfter) return false;

    const lastActivity = await this.lastActivityAt(session.orgId, session.employeeId, session.startedAt);

    // Clamp: never past the shift end, never past observed activity, and never
    // before the session started (a zero-length day beats a negative one).
    const candidates = [shiftEnd];
    if (lastActivity) candidates.push(lastActivity);
    let endedAt = new Date(Math.min(...candidates.map((d) => d.getTime())));
    if (endedAt < session.startedAt) endedAt = session.startedAt;

    const minutes = Math.max(0, Math.round((endedAt.getTime() - session.startedAt.getTime()) / 60_000));

    await this.prisma.$transaction(async (tx) => {
      // Close any break still running inside the session, bounded the same way.
      const openBreak = await tx.attendanceBreak.findFirst({
        where: { sessionId: session.id, endedAt: null },
        select: { id: true, startedAt: true },
      });
      if (openBreak) {
        const breakEnd = endedAt < openBreak.startedAt ? openBreak.startedAt : endedAt;
        await tx.attendanceBreak.update({
          where: { id: openBreak.id },
          data: { endedAt: breakEnd, minutes: Math.max(0, Math.round((breakEnd.getTime() - openBreak.startedAt.getTime()) / 60_000)) },
        });
      }

      await tx.attendanceSession.update({
        where: { id: session.id },
        data: {
          endedAt,
          minutes,
          endSource: "system",
          autoClosed: true,
          note: lastActivity ? "Auto-closed at last observed activity" : "Auto-closed at shift end",
        },
      });

      await tx.attendanceEvent.create({
        data: {
          orgId: session.orgId,
          employeeId: session.employeeId,
          attendanceId: session.attendanceId,
          type: "AUTO_CHECK_OUT",
          fromState: "WORKING",
          toState: "COMPLETED",
          source: "system",
          occurredAt: new Date(),
          note: `Clamped to ${endedAt.toISOString()} (${lastActivity ? "last activity" : "shift end"})`,
        },
      });
    });

    await this.recomputeAutoClosedDay(session.orgId, session.employeeId, session.attendanceId);
    await this.notify(session.orgId, session.employeeId, session.attendanceId, endedAt);
    return true;
  }

  /**
   * Recompute the day roll-up for an auto-closed day, with overtime forced to
   * zero — see the class comment for why a missed check-out can't earn OT.
   */
  private async recomputeAutoClosedDay(orgId: string, employeeId: string, attendanceId: string): Promise<void> {
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { id: attendanceId },
      include: { sessions: true, breaks: true },
    });
    if (!record) return;

    const policy = await this.policies.get(orgId);
    const now = new Date();
    const gross = record.sessions.reduce(
      (acc, s) => acc + Math.max(0, Math.round(((s.endedAt ?? now).getTime() - s.startedAt.getTime()) / 60_000)),
      0,
    );
    const breakMinutes = record.breaks.reduce((acc, b) => acc + b.minutes, 0);
    const paid = Math.min(breakMinutes, Math.max(0, policy.paidBreakMinutesPerDay));
    const unpaid = Math.max(0, breakMinutes - paid);

    const lastClosed = [...record.sessions].reverse().find((s) => s.endedAt !== null) ?? null;
    await this.prisma.attendanceRecord.update({
      where: { id: attendanceId },
      data: {
        checkOutAt: lastClosed?.endedAt ?? null,
        checkOutSource: "system",
        workMinutes: Math.max(0, gross - unpaid),
        breakMinutes,
        unpaidBreakMinutes: unpaid,
        overtimeMinutes: 0, // a missed check-out cannot claim overtime
        state: "COMPLETED",
      },
    });
    void employeeId;
  }

  /** Latest activity we have evidence for, from the agent's event stream. */
  private async lastActivityAt(orgId: string, employeeId: string, since: Date): Promise<Date | null> {
    try {
      const latest = await this.analytics.activityEvent.findFirst({
        where: { orgId, employeeId, occurredAt: { gte: since } },
        orderBy: { occurredAt: "desc" },
        select: { occurredAt: true },
      });
      return latest?.occurredAt ?? null;
    } catch {
      // No analytics reachable -> fall back to the shift bound alone.
      return null;
    }
  }

  /** The instant the employee's shift ended, on the calendar day it started. */
  private shiftEndInstant(sessionStart: Date, tz: string, shift: ShiftLike | null): Date {
    const endMinute = shift ? shift.endMinute : 18 * 60; // no shift configured -> 18:00
    const overnight = shift ? shift.endMinute <= shift.startMinute : false;

    // Work in the org's local day, then convert back to an instant.
    const offsetMs = this.tzOffsetMs(sessionStart, tz);
    const local = new Date(sessionStart.getTime() + offsetMs);
    const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    const endLocal = localMidnight + endMinute * 60_000 + (overnight ? DAY_MS : 0);
    return new Date(endLocal - offsetMs);
  }

  /** Milliseconds to add to a UTC instant to read it as local time in `tz`. */
  private tzOffsetMs(at: Date, tz: string): number {
    try {
      const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
      const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
      const asUtc = Date.UTC(
        Number(p.year), Number(p.month) - 1, Number(p.day),
        Number(p.hour) % 24, Number(p.minute), Number(p.second),
      );
      return asUtc - at.getTime();
    } catch {
      return 0;
    }
  }

  /** Shift for an employee on the session's day: active rotation → fixed → default. */
  private async resolveShift(orgId: string, employeeId: string, onDay: Date): Promise<{ tz: string; shift: ShiftLike | null }> {
    const shiftSelect = { startMinute: true, endMinute: true, graceMinutes: true, workingDays: true, status: true } as const;
    const [org, employee] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
      this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { shiftRef: { select: shiftSelect }, rotationRef: { select: { anchorDate: true, steps: true, status: true } } },
      }),
    ]);
    const tz = org?.timezone || "UTC";

    let shift: ShiftLike | null = null;
    const rot = employee?.rotationRef;
    if (rot && rot.status === "ACTIVE") {
      const shiftId = ShiftRotationService.shiftIdOn(rot.anchorDate, (rot.steps as unknown as RotationStep[]) ?? [], onDay);
      if (shiftId) {
        const s = await this.prisma.shift.findFirst({ where: { id: shiftId, orgId, status: "ACTIVE" }, select: shiftSelect });
        if (s) shift = s;
      }
    }
    if (!shift && employee?.shiftRef && employee.shiftRef.status === "ACTIVE") shift = employee.shiftRef;
    if (!shift) {
      shift = await this.prisma.shift.findFirst({ where: { orgId, isDefault: true, status: "ACTIVE" }, select: shiftSelect });
    }
    return { tz, shift };
  }

  /** Tell the employee their day was closed for them, and to what time. */
  private async notify(orgId: string, employeeId: string, attendanceId: string, endedAt: Date): Promise<void> {
    try {
      const membership = await this.prisma.organizationMembership.findFirst({
        where: { orgId, employeeId, status: "ACTIVE" },
        select: { userId: true },
      });
      if (!membership?.userId) return;
      await this.prisma.$transaction(async (tx) => {
        await this.outbox.enqueue(tx, {
          eventType: "attendance.auto_checked_out",
          aggregateType: "attendance",
          aggregateId: attendanceId,
          orgId,
          payload: { requesterUserId: membership.userId, endedAt: endedAt.toISOString() },
        });
      });
    } catch {
      // Notification is a courtesy; the close itself already happened.
    }
  }
}
