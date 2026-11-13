import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { logger } from "../../common/observability/observability.js";
import { AttendanceService } from "./attendance.service.js";

const SCOPES = ["org", "department", "team", "employee"];
const PERIODS = ["today", "week", "month"];
const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
type Frequency = (typeof FREQUENCIES)[number];

export interface ScheduleInput {
  scope: string;
  scopeId?: string | null;
  period: string;
  frequency: string;
  recipients?: string[];
}

/**
 * Saved recurring attendance reports. Managers create a schedule (scope + period +
 * frequency); a daily @Cron sweep finds the ones due and enqueues a
 * `report.scheduled` notification (summary in the body) to each recipient, then
 * stamps lastSentAt so a re-run within the period can't double-send.
 */
@Injectable()
export class ReportScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly attendance: AttendanceService,
  ) {}

  async list() {
    const ctx = requireTenantContext();
    const rows = await this.prisma.reportSchedule.findMany({ where: { orgId: ctx.orgId }, orderBy: { createdAt: "desc" } });
    // Resolve a human label per schedule for the UI.
    return Promise.all(rows.map(async (r) => ({ ...r, scopeLabel: await this.attendance.scopeLabel(ctx.orgId, r.scope, r.scopeId) })));
  }

  async create(input: ScheduleInput) {
    const ctx = requireTenantContext();
    const scope = (input.scope ?? "org").toLowerCase();
    const period = (input.period ?? "month").toLowerCase();
    const frequency = (input.frequency ?? "WEEKLY").toUpperCase() as Frequency;
    if (!SCOPES.includes(scope)) throw new BadRequestException("Invalid scope.");
    if (!PERIODS.includes(period)) throw new BadRequestException("Invalid period.");
    if (!FREQUENCIES.includes(frequency)) throw new BadRequestException("Invalid frequency.");
    if (scope !== "org" && !input.scopeId) throw new BadRequestException(`A ${scope} must be selected.`);

    // Default recipient is the creator; validate any supplied ones are members.
    let recipients = (input.recipients ?? []).filter(Boolean);
    if (recipients.length === 0) recipients = [ctx.userId];
    const valid = await this.prisma.organizationMembership.findMany({
      where: { orgId: ctx.orgId, userId: { in: recipients }, status: "ACTIVE" },
      select: { userId: true },
    });
    const validSet = new Set(valid.map((v) => v.userId));
    recipients = recipients.filter((r) => validSet.has(r));
    if (recipients.length === 0) recipients = [ctx.userId];

    return this.prisma.reportSchedule.create({
      data: { orgId: ctx.orgId, createdBy: ctx.userId, scope, scopeId: input.scopeId || null, period, frequency, recipients },
    });
  }

  async remove(id: string) {
    const ctx = requireTenantContext();
    const row = await this.prisma.reportSchedule.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
    if (!row) throw new NotFoundException("Schedule not found.");
    await this.prisma.reportSchedule.delete({ where: { id } });
    return { ok: true };
  }

  /** Run a schedule immediately (used by the "send now" action + the sweep). */
  async runOne(scheduleId: string): Promise<number> {
    const s = await this.prisma.reportSchedule.findUnique({ where: { id: scheduleId } });
    if (!s || !s.active) return 0;
    return this.dispatch(s);
  }

  private async dispatch(s: { id: string; orgId: string; createdBy: string; scope: string; scopeId: string | null; period: string; recipients: string[] }): Promise<number> {
    // Build the report as the schedule's creator (their reach defines breadth).
    const report = await this.attendance.buildReport({ scope: s.scope, scopeId: s.scopeId, period: s.period }, s.orgId, s.createdBy);
    const summaryLines = [
      `Scope: ${report.scopeLabel} · Period: ${report.period} (${report.from} → ${report.to})`,
      `Employees: ${report.summary.employees} · Present: ${report.summary.present} · Late: ${report.summary.late} · Attendance: ${report.summary.attendanceRate}%`,
    ];
    // The full report as a CSV, attached to the email (not just the summary).
    const csv = this.attendance.reportCsv(report);
    const recipients = s.recipients.length > 0 ? s.recipients : [s.createdBy];
    for (const userId of recipients) {
      await this.prisma.$transaction(async (tx) => {
        await this.outbox.enqueue(tx, {
          eventType: "report.scheduled",
          aggregateType: "report",
          aggregateId: `report:${s.id}:${userId}:${report.to}`,
          orgId: s.orgId,
          payload: {
            requesterUserId: userId,
            title: `Attendance report — ${report.scopeLabel}`,
            scopeLabel: report.scopeLabel,
            period: report.period,
            summaryLines,
            reportCsv: { filename: csv.filename, content: csv.body },
            link: "/attendance",
          },
        });
      });
    }
    await this.prisma.reportSchedule.update({ where: { id: s.id }, data: { lastSentAt: new Date() } });
    return recipients.length;
  }

  /**
   * Daily sweep — sends each active schedule that's due. "Due" = never sent, or
   * last sent before the start of the current period for its frequency (so a
   * DAILY schedule sends once a day, WEEKLY once a Monday-week, MONTHLY once a
   * calendar month). lastSentAt gates re-sends within the same period.
   */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async sweep(): Promise<void> {
    const now = new Date();
    try {
      const schedules = await this.prisma.reportSchedule.findMany({ where: { active: true }, take: 1000 });
      let sent = 0;
      for (const s of schedules) {
        if (!this.isDue(s.frequency, s.lastSentAt, now)) continue;
        try {
          sent += await this.dispatch(s);
        } catch (err) {
          logger.warn({ err: String(err), scheduleId: s.id }, "scheduled report dispatch failed");
        }
      }
      if (sent > 0) logger.info({ sent }, "scheduled reports swept");
    } catch (error) {
      logger.warn({ err: String(error) }, "report-schedule sweep failed");
    }
  }

  private isDue(frequency: Frequency, lastSentAt: Date | null, now: Date): boolean {
    if (!lastSentAt) return true;
    if (frequency === "DAILY") {
      return lastSentAt.toISOString().slice(0, 10) < now.toISOString().slice(0, 10);
    }
    if (frequency === "WEEKLY") {
      const weekStart = (d: Date) => {
        const dow = (d.getUTCDay() + 6) % 7;
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
      };
      return weekStart(lastSentAt) < weekStart(now);
    }
    // MONTHLY
    return lastSentAt.getUTCFullYear() < now.getUTCFullYear() || (lastSentAt.getUTCFullYear() === now.getUTCFullYear() && lastSentAt.getUTCMonth() < now.getUTCMonth());
  }
}
