import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { permissions } from "@retainiq/authz";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { logger } from "../../common/observability/observability.js";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// Kept in step with the matrix in escalation.service.ts.
const MATRIX: Record<Severity, { maxLevel: number; slaHours: Record<number, number | undefined> }> = {
  LOW: { maxLevel: 2, slaHours: { 1: undefined, 2: undefined } },
  MEDIUM: { maxLevel: 3, slaHours: { 1: 72, 2: 72, 3: undefined } },
  HIGH: { maxLevel: 3, slaHours: { 1: 24, 2: 24, 3: undefined } },
  CRITICAL: { maxLevel: 3, slaHours: { 2: 4, 3: undefined } },
};
const LEVEL_LABEL: Record<number, string> = { 1: "Manager", 2: "Department head", 3: "HR / Owner" };

/**
 * SLA sweep — auto-escalates any PENDING escalation past its dueAt to the next
 * level (severity-based). Runs hourly (context-free, cross-org). This is the
 * "escalates if needed" hop of the workflow: an unacknowledged escalation doesn't
 * sit silently — it climbs the ladder and re-notifies until someone owns it.
 */
@Injectable()
export class EscalationSlaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  private dueAtFor(severity: Severity, level: number): Date | null {
    const hours = MATRIX[severity].slaHours[level];
    return hours ? new Date(Date.now() + hours * 3600 * 1000) : null;
  }

  private async authorityFor(orgId: string, employeeId: string, level: number): Promise<string | null> {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { managerId: true, departmentId: true, teamId: true } });
    if (!emp) return null;
    const userIdOf = async (empId: string | null): Promise<string | null> => {
      if (!empId) return null;
      const m = await this.prisma.organizationMembership.findFirst({ where: { orgId, employeeId: empId, status: "ACTIVE" }, select: { userId: true } });
      return m?.userId ?? null;
    };
    if (level <= 1) return userIdOf(emp.managerId);
    if (level === 2) {
      if (emp.managerId) {
        const mgr = await this.prisma.employee.findFirst({ where: { id: emp.managerId, orgId }, select: { managerId: true } });
        const up = await userIdOf(mgr?.managerId ?? null);
        if (up) return up;
      }
      const scopeIds = [emp.departmentId, emp.teamId].filter((x): x is string => Boolean(x));
      if (scopeIds.length > 0) {
        const grant = await this.prisma.roleAssignment.findFirst({ where: { orgId, status: "ACTIVE", scopeType: { in: ["DEPARTMENT", "TEAM"] }, scopeId: { in: scopeIds }, role: { permissions: { has: permissions.observationManage } } }, select: { userId: true } });
        if (grant?.userId) return grant.userId;
      }
    }
    const inc = await this.prisma.roleAssignment.findFirst({ where: { orgId, status: "ACTIVE", role: { permissions: { has: permissions.incidentManage } } }, select: { userId: true } });
    if (inc?.userId) return inc.userId;
    const owner = await this.prisma.organizationMembership.findFirst({ where: { orgId, status: "ACTIVE", role: { name: "Owner" } }, select: { userId: true } });
    return owner?.userId ?? null;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    try {
      const due = await this.prisma.escalation.findMany({
        where: { status: "PENDING", dueAt: { not: null, lt: new Date() } },
        select: { id: true, orgId: true, observationId: true, employeeId: true, severity: true, level: true },
        take: 500,
      });
      let bumped = 0;
      for (const e of due) {
        const severity = e.severity as Severity;
        const nextLevel = e.level + 1;
        if (nextLevel > MATRIX[severity].maxLevel) {
          // Top of the ladder — stop auto-bumping (clear the SLA so we don't re-scan it).
          await this.prisma.escalation.update({ where: { id: e.id }, data: { dueAt: null } });
          continue;
        }
        const assignedTo = await this.authorityFor(e.orgId, e.employeeId, nextLevel);
        const dueAt = this.dueAtFor(severity, nextLevel);
        await this.prisma.escalation.update({ where: { id: e.id }, data: { level: nextLevel, assignedTo, dueAt } });
        await this.prisma.escalationEvent.create({ data: { orgId: e.orgId, escalationId: e.id, kind: "BUMPED", level: nextLevel, actorUserId: null, note: "Auto-escalated: SLA elapsed" } });
        if (assignedTo) {
          const obs = await this.prisma.observation.findFirst({ where: { id: e.observationId, orgId: e.orgId }, select: { title: true } });
          await this.prisma.$transaction(async (tx) => {
            await this.outbox.enqueue(tx, { eventType: "escalation.created", aggregateType: "escalation", aggregateId: `esc:${e.id}:l${nextLevel}:auto`, orgId: e.orgId, payload: { requesterUserId: assignedTo, title: obs?.title ?? "Escalation", severity, level: nextLevel, levelLabel: LEVEL_LABEL[nextLevel] ?? `Level ${nextLevel}`, escalationId: e.id, auto: true } });
          });
        }
        bumped += 1;
      }
      if (bumped > 0) logger.info({ bumped }, "escalation SLA sweep auto-bumped");
    } catch (error) {
      logger.warn({ err: String(error) }, "escalation SLA sweep failed");
    }
  }
}
