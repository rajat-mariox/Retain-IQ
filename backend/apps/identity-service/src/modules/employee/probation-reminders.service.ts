import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";

const DEFAULT_REMINDER_DAYS = [30, 15, 7];

/**
 * Reminds the manager ahead of a probation ending so a review happens on time.
 * Once a day, finds ACTIVE/EXTENDED probations whose end date is within a reminder
 * threshold (configurable per org) not yet sent, notifies the employee's manager
 * (falling back to an admin), and stamps lastRemindedDays to avoid repeats.
 */
@Injectable()
export class ProbationRemindersService {
  private readonly log = new Logger(ProbationRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sweep(): Promise<void> {
    const now = new Date();
    // Widest possible window across all orgs' configs (30 default; cap generous).
    const horizon = new Date(now.getTime() + 45 * 86_400_000);
    const recs = await this.prisma.probationRecord.findMany({
      where: { status: { in: ["ACTIVE", "EXTENDED"] }, endDate: { lte: horizon } },
      select: { id: true, orgId: true, employeeId: true, endDate: true, lastRemindedDays: true },
    });
    if (recs.length === 0) return;

    // Cache each org's reminder thresholds.
    const thresholdsByOrg = new Map<string, number[]>();
    let sent = 0;
    for (const r of recs) {
      let thresholds = thresholdsByOrg.get(r.orgId);
      if (!thresholds) {
        const s = await this.prisma.workforceSetting.findUnique({ where: { orgId: r.orgId }, select: { probationReminderDays: true } });
        thresholds = (s?.probationReminderDays?.length ? s.probationReminderDays : DEFAULT_REMINDER_DAYS).slice().sort((a, b) => b - a);
        thresholdsByOrg.set(r.orgId, thresholds);
      }
      const days = Math.round((Date.UTC(r.endDate.getUTCFullYear(), r.endDate.getUTCMonth(), r.endDate.getUTCDate()) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
      if (days < 0) continue;
      const threshold = thresholds.find((t) => days <= t);
      if (threshold === undefined) continue;
      if (r.lastRemindedDays !== null && r.lastRemindedDays <= threshold) continue;

      const recipient = await this.resolveRecipient(r.orgId, r.employeeId);
      if (!recipient) { await this.prisma.probationRecord.update({ where: { id: r.id }, data: { lastRemindedDays: threshold } }); continue; }
      const emp = await this.prisma.employee.findUnique({ where: { id: r.employeeId }, select: { firstName: true, lastName: true } });
      const employeeName = emp ? `${emp.firstName} ${emp.lastName}`.trim() : "An employee";

      await this.prisma.$transaction(async (tx) => {
        await this.outbox.enqueue(tx, {
          eventType: "probation.ending",
          aggregateType: "probation",
          aggregateId: r.id,
          orgId: r.orgId,
          payload: { requesterUserId: recipient, probationId: r.id, employeeId: r.employeeId, employeeName, daysLeft: days, endDate: r.endDate.toISOString().slice(0, 10) },
        });
        await tx.probationRecord.update({ where: { id: r.id }, data: { lastRemindedDays: threshold } });
      });
      sent += 1;
    }
    if (sent > 0) this.log.log(`Probation-ending reminders dispatched: ${sent}`);
  }

  private async resolveRecipient(orgId: string, employeeId: string): Promise<string | null> {
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
    if (emp?.managerId) {
      const m = await this.prisma.organizationMembership.findFirst({ where: { orgId, employeeId: emp.managerId, status: "ACTIVE" }, select: { userId: true } });
      if (m?.userId) return m.userId;
    }
    const admin = await this.prisma.organizationMembership.findFirst({ where: { orgId, status: "ACTIVE", role: { permissions: { has: "employee.write" } } }, select: { userId: true }, orderBy: { createdAt: "asc" } });
    return admin?.userId ?? null;
  }
}
