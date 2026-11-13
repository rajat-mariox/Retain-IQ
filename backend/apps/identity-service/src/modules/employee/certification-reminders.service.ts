import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { logger } from "../../common/observability/observability.js";

// Warn ahead of a certification lapsing. Descending so the largest still-unsent
// threshold for a given cert is chosen each run; configurable here.
const REMINDER_DAYS = [90, 60, 30, 7];

/**
 * Certification expiry reminders. Once a day, finds certifications whose expiry
 * is within a reminder threshold not yet sent, notifies the employee's manager
 * (falling back to org admins), and stamps lastRemindedDays so the same warning
 * never repeats. Reuses the transactional outbox → notifications path.
 */
@Injectable()
export class CertificationRemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async sweep(): Promise<void> {
    const maxWindow = REMINDER_DAYS[0]!;
    const now = new Date();
    const horizon = new Date(now.getTime() + (maxWindow + 1) * 86_400_000);

    // Candidates: have an expiry, not already expired more than we care about,
    // within the widest reminder window.
    const certs = await this.prisma.employeeCertification.findMany({
      where: { expiresAt: { not: null, lte: horizon } },
      select: { id: true, orgId: true, employeeId: true, name: true, expiresAt: true, lastRemindedDays: true },
    });
    if (certs.length === 0) return;

    let sent = 0;
    for (const c of certs) {
      const expiresAt = c.expiresAt;
      if (!expiresAt) continue;
      const days = Math.round((Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth(), expiresAt.getUTCDate()) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
      if (days < 0) continue; // already expired — no forward reminder
      // The tightest threshold this cert has now crossed (e.g. 25 days left → 30).
      const threshold = REMINDER_DAYS.find((t) => days <= t);
      if (threshold === undefined) continue;
      // Already reminded at this (or a tighter) threshold? skip.
      if (c.lastRemindedDays !== null && c.lastRemindedDays <= threshold) continue;

      const recipient = await this.resolveRecipient(c.orgId, c.employeeId);
      if (!recipient) { // no one to tell — still stamp so we don't loop
        await this.prisma.employeeCertification.update({ where: { id: c.id }, data: { lastRemindedDays: threshold } });
        continue;
      }
      const employee = await this.prisma.employee.findUnique({ where: { id: c.employeeId }, select: { firstName: true, lastName: true } });
      const employeeName = employee ? `${employee.firstName} ${employee.lastName}`.trim() : "An employee";

      await this.prisma.$transaction(async (tx) => {
        await this.outbox.enqueue(tx, {
          eventType: "certification.expiring",
          aggregateType: "certification",
          aggregateId: c.id,
          orgId: c.orgId,
          payload: { requesterUserId: recipient, certId: c.id, employeeId: c.employeeId, employeeName, certName: c.name, daysLeft: days, expiresAt: expiresAt.toISOString().slice(0, 10) },
        });
        await tx.employeeCertification.update({ where: { id: c.id }, data: { lastRemindedDays: threshold } });
      });
      sent += 1;
    }
    if (sent > 0) logger.info({ sent }, "certification expiry reminders dispatched");
  }

  /** The employee's manager's login userId, else the first org owner/admin. */
  private async resolveRecipient(orgId: string, employeeId: string): Promise<string | null> {
    const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
    if (emp?.managerId) {
      const m = await this.prisma.organizationMembership.findFirst({ where: { orgId, employeeId: emp.managerId, status: "ACTIVE" }, select: { userId: true } });
      if (m?.userId) return m.userId;
    }
    const admin = await this.prisma.organizationMembership.findFirst({
      where: { orgId, status: "ACTIVE", role: { permissions: { has: "employee.write" } } },
      select: { userId: true },
      orderBy: { createdAt: "asc" },
    });
    return admin?.userId ?? null;
  }
}
