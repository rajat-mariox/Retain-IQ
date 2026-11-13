import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../common/database/prisma.service.js";
import { logger } from "../../common/observability/observability.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { ObservationService } from "../observation/observation.service.js";
import { AttendancePolicyService } from "./attendance-policy.service.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** ISO-week key (e.g. 2026-W31) — stable per calendar week, for observation dedupe. */
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// A pattern needs repetition, not a single bad day.
const PATTERN_WINDOW_DAYS = 14;
const LATE_PATTERN_MIN_DAYS = 3; // late on >= 3 days in the window
const ABSENCE_PATTERN_MIN_DAYS = 3; // absent (no record, working day) on >= 3 days

/**
 * Scheduled attendance alerts (§4 of the notifications spec).
 *
 * These are time-based conditions rather than user actions, so they're swept on
 * a schedule instead of being emitted inline. Each notification is deduped
 * downstream by (eventId, type, recipient, channel), and eventIds here are
 * derived from the attendance row + day so a re-run can't double-notify.
 */
@Injectable()
export class AttendanceAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly policies: AttendancePolicyService,
    private readonly observations: ObservationService,
  ) {}

  /**
   * Safety net for days still open the morning after.
   *
   * When the org enables `autoCheckOutAtShiftEnd`, AttendanceAutoCloseService
   * has already closed and notified these — this only catches orgs that leave
   * auto-close off, so nobody's day is silently left hanging.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async sweepMissedCheckouts(): Promise<void> {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    const day = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate()));
    try {
      const open = await this.prisma.attendanceRecord.findMany({
        where: { day, checkInAt: { not: null }, checkOutAt: null },
        select: { id: true, orgId: true, employeeId: true },
        take: 500,
      });
      for (const row of open) {
        // Auto-close owns these orgs; alerting again would double-notify.
        const policy = await this.policies.get(row.orgId);
        if (policy.autoCheckOutAtShiftEnd) continue;
        const userId = await this.userIdFor(row.orgId, row.employeeId);
        if (!userId) continue;
        await this.emit("attendance.missed_checkout", row.orgId, `missed-checkout:${row.id}`, {
          requesterUserId: userId,
          day: iso(day),
        });
      }
      if (open.length > 0) logger.info({ count: open.length, day: iso(day) }, "missed-checkout alerts swept");
    } catch (error) {
      logger.warn({ err: String(error) }, "missed-checkout sweep failed");
    }
  }

  /**
   * Mid-morning: anyone with no attendance row for today at all. Runs late
   * enough that normal arrivals have already checked in.
   */
  @Cron(CronExpression.EVERY_DAY_AT_11AM)
  async sweepMissedCheckins(): Promise<void> {
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    // Weekends are off by default — don't nag.
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) return;

    try {
      const memberships = await this.prisma.organizationMembership.findMany({
        where: { status: "ACTIVE", employeeId: { not: null } },
        select: { orgId: true, userId: true, employeeId: true },
        take: 1000,
      });
      const employeeIds = memberships.map((m) => m.employeeId!).filter(Boolean);
      if (employeeIds.length === 0) return;

      const [present, onLeave] = await Promise.all([
        this.prisma.attendanceRecord.findMany({ where: { day, employeeId: { in: employeeIds } }, select: { employeeId: true } }),
        this.prisma.leaveRequest.findMany({
          where: { status: "APPROVED", startDate: { lte: day }, endDate: { gte: day }, employeeId: { in: employeeIds } },
          select: { employeeId: true },
        }),
      ]);
      const excused = new Set([...present.map((p) => p.employeeId), ...onLeave.map((l) => l.employeeId)]);

      let count = 0;
      for (const m of memberships) {
        if (!m.employeeId || excused.has(m.employeeId)) continue;
        await this.emit("attendance.missed_checkin", m.orgId, `missed-checkin:${m.employeeId}:${iso(day)}`, {
          requesterUserId: m.userId,
          day: iso(day),
        });
        count += 1;
      }
      if (count > 0) logger.info({ count, day: iso(day) }, "missed-checkin alerts swept");
    } catch (error) {
      logger.warn({ err: String(error) }, "missed-checkin sweep failed");
    }
  }

  /**
   * Weekly pattern sweep → attendance Observations. A single late/absent day is
   * noise; a repeated pattern is a real concern. Over a trailing 14-day window,
   * per employee: >= 3 late days → a LATE_PATTERN observation; >= 3 unexplained
   * absences (working day, no record, no approved leave) → an ATTENDANCE_ANOMALY.
   * Deduped per ISO-week so a re-run can't double-create. Context-free (cross-org).
   */
  @Cron(CronExpression.EVERY_WEEK)
  async sweepAttendancePatterns(): Promise<void> {
    const now = new Date();
    const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - PATTERN_WINDOW_DAYS));
    const week = isoWeek(now);
    try {
      // Late-day counts per (org, employee) from LATE records in the window.
      const lateRecords = await this.prisma.attendanceRecord.findMany({
        where: { day: { gte: windowStart }, status: "LATE" },
        select: { orgId: true, employeeId: true, lateMinutes: true },
        take: 5000,
      });
      const late = new Map<string, { org: string; emp: string; days: number; lateMin: number }>();
      for (const r of lateRecords) {
        const k = `${r.orgId}:${r.employeeId}`;
        const e = late.get(k) ?? { org: r.orgId, emp: r.employeeId, days: 0, lateMin: 0 };
        e.days += 1;
        e.lateMin += r.lateMinutes;
        late.set(k, e);
      }

      let created = 0;
      for (const e of late.values()) {
        if (e.days < LATE_PATTERN_MIN_DAYS) continue;
        const avgLate = Math.round(e.lateMin / e.days);
        const severity = e.days >= 6 || avgLate >= 30 ? "HIGH" : "MEDIUM";
        const emp = await this.prisma.employee.findFirst({ where: { id: e.emp, orgId: e.org }, select: { firstName: true, lastName: true } });
        if (!emp) continue;
        const name = `${emp.firstName} ${emp.lastName}`.trim();
        const res = await this.observations
          .createFromAi({
            orgId: e.org,
            employeeId: e.emp,
            type: "LATE_PATTERN",
            severity,
            title: `Repeated late arrivals — ${name}`,
            detail: `Late on ${e.days} day(s) in the last ${PATTERN_WINDOW_DAYS} days (avg ${avgLate} min late).`,
            metric: { lateDays: e.days, avgLateMinutes: avgLate, windowDays: PATTERN_WINDOW_DAYS },
            dedupeKey: `late-pattern:${e.emp}:${week}`,
          })
          .catch((err) => { logger.warn({ err: String(err), employeeId: e.emp }, "late-pattern observation failed"); return null; });
        if (res?.created) created += 1;
      }

      // Absence pattern: unexplained absences (working day, no record, no leave).
      created += await this.sweepAbsencePatterns(windowStart, now, week);
      if (created > 0) logger.info({ created, week }, "attendance-pattern observations created");
    } catch (error) {
      logger.warn({ err: String(error) }, "attendance-pattern sweep failed");
    }
  }

  /** Count per-employee unexplained absences over the window and raise observations. */
  private async sweepAbsencePatterns(windowStart: Date, now: Date, week: string): Promise<number> {
    // Active employees with a membership, grouped by org.
    const memberships = await this.prisma.organizationMembership.findMany({
      where: { status: "ACTIVE", employeeId: { not: null } },
      select: { orgId: true, employeeId: true },
      take: 5000,
    });
    if (memberships.length === 0) return 0;

    // Build the set of working weekdays we scan (Mon–Fri in the window, up to yesterday).
    const days: Date[] = [];
    for (let d = new Date(windowStart); d < now; d.setUTCDate(d.getUTCDate() + 1)) {
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) days.push(new Date(d));
    }
    if (days.length === 0) return 0;

    const empIds = memberships.map((m) => m.employeeId!).filter(Boolean);
    const [records, leaves, holidays] = await Promise.all([
      this.prisma.attendanceRecord.findMany({ where: { employeeId: { in: empIds }, day: { gte: windowStart } }, select: { employeeId: true, day: true } }),
      this.prisma.leaveRequest.findMany({ where: { status: "APPROVED", employeeId: { in: empIds }, startDate: { lt: now }, endDate: { gte: windowStart } }, select: { employeeId: true, startDate: true, endDate: true } }),
      this.prisma.holiday.findMany({ where: { date: { gte: windowStart, lt: now } }, select: { date: true, type: true } }),
    ]);
    const hasRecord = new Set(records.map((r) => `${r.employeeId}:${iso(r.day)}`));
    const companyHolidays = new Set(holidays.filter((h) => h.type !== "DEPARTMENT").map((h) => iso(h.date)));
    const onLeave = new Set<string>();
    for (const lr of leaves) {
      for (let d = new Date(Math.max(lr.startDate.getTime(), windowStart.getTime())); d < now && d <= lr.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
        onLeave.add(`${lr.employeeId}:${iso(d)}`);
      }
    }

    const absentCount = new Map<string, { org: string; emp: string; n: number }>();
    for (const m of memberships) {
      const emp = m.employeeId!;
      let n = 0;
      for (const d of days) {
        const key = iso(d);
        if (companyHolidays.has(key)) continue;
        if (hasRecord.has(`${emp}:${key}`)) continue;
        if (onLeave.has(`${emp}:${key}`)) continue;
        n += 1;
      }
      if (n >= ABSENCE_PATTERN_MIN_DAYS) absentCount.set(`${m.orgId}:${emp}`, { org: m.orgId, emp, n });
    }

    let created = 0;
    for (const e of absentCount.values()) {
      const emp = await this.prisma.employee.findFirst({ where: { id: e.emp, orgId: e.org }, select: { firstName: true, lastName: true } });
      if (!emp) continue;
      const name = `${emp.firstName} ${emp.lastName}`.trim();
      const severity = e.n >= 5 ? "HIGH" : "MEDIUM";
      const res = await this.observations
        .createFromAi({
          orgId: e.org,
          employeeId: e.emp,
          type: "ATTENDANCE_ANOMALY",
          severity,
          title: `Repeated unexplained absences — ${name}`,
          detail: `Absent (no check-in, no approved leave) on ${e.n} working day(s) in the last ${PATTERN_WINDOW_DAYS} days.`,
          metric: { absentDays: e.n, windowDays: PATTERN_WINDOW_DAYS },
          dedupeKey: `absence-pattern:${e.emp}:${week}`,
        })
        .catch((err) => { logger.warn({ err: String(err), employeeId: e.emp }, "absence-pattern observation failed"); return null; });
      if (res?.created) created += 1;
    }
    return created;
  }

  /** Map an employee to their login account — notifications address users. */
  private async userIdFor(orgId: string, employeeId: string): Promise<string | null> {
    const m = await this.prisma.organizationMembership.findFirst({
      where: { orgId, employeeId, status: "ACTIVE" },
      select: { userId: true },
    });
    return m?.userId ?? null;
  }

  private async emit(eventType: string, orgId: string, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.outbox.enqueue(tx, { eventType, aggregateType: "attendance", aggregateId, orgId, payload });
    });
  }
}
