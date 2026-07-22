import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../common/database/prisma.service.js";
import { logger } from "../../common/observability/observability.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { AttendancePolicyService } from "./attendance-policy.service.js";

const iso = (d: Date) => d.toISOString().slice(0, 10);

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
