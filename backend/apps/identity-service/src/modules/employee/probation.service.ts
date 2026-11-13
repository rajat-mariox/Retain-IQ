import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { ExitService } from "./exit.service.js";

/** Add N whole months to a date (day-of-month preserved, clamped to month end). */
function addMonths(d: Date, months: number): Date {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
  return r;
}

/**
 * Structured probation + confirmation. Starting probation creates a record with an
 * auto-calculated end date; a manager's review drives the outcome — CONFIRM moves
 * the employee to CONFIRMED/ACTIVE, EXTEND pushes the end date while preserving the
 * original (an immutable extension row), TERMINATE hands off to the structured exit
 * process. A reminder cron warns ahead of the end date. Reuses the ABAC gate,
 * transactional outbox, audit, and (for terminate) the exit engine.
 */
@Injectable()
export class ProbationService {
  private readonly log = new Logger(ProbationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly exits: ExitService,
  ) {}

  private async assertEmployee(orgId: string, employeeId: string, permission: string) {
    const ctx = requireTenantContext();
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true } });
    if (!e) throw new NotFoundException("Employee not found.");
    const scope = await this.accessScope.resolveScope(orgId, ctx.userId, permission);
    if (scope.tier === "org") return;
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    if (visible !== null && !visible.includes(employeeId)) throw new NotFoundException("Employee not found.");
  }

  private async defaultMonths(orgId: string): Promise<number> {
    const s = await this.prisma.workforceSetting.findUnique({ where: { orgId }, select: { probationMonths: true } });
    return s?.probationMonths ?? 6;
  }

  // ---- start ---------------------------------------------------------------

  async start(employeeId: string, input: { durationMonths?: number; startDate?: string }) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId, permissions.employeeWrite);
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId: ctx.orgId }, select: { id: true, lifecycleStage: true } });
    if (!emp) throw new NotFoundException("Employee not found.");
    if (emp.lifecycleStage === "EXITED") throw new ConflictException("This employee has exited.");
    const open = await this.prisma.probationRecord.findFirst({ where: { orgId: ctx.orgId, employeeId, status: { in: ["ACTIVE", "EXTENDED"] } }, select: { id: true } });
    if (open) throw new ConflictException("This employee is already on probation.");

    const months = input.durationMonths ?? (await this.defaultMonths(ctx.orgId));
    if (months < 1 || months > 24) throw new BadRequestException("Probation length must be 1–24 months.");
    const startDate = input.startDate ? new Date(input.startDate) : new Date();
    const endDate = addMonths(startDate, months);

    const rec = await this.prisma.$transaction(async (tx) => {
      const created = await tx.probationRecord.create({
        data: { orgId: ctx.orgId, employeeId, startDate, endDate, originalEndDate: endDate, durationMonths: months, createdBy: ctx.userId },
      });
      await tx.employee.update({ where: { id: employeeId }, data: { lifecycleStage: "PROBATION", probationEndsAt: endDate } });
      await tx.employmentEvent.create({ data: { orgId: ctx.orgId, employeeId, type: "LIFECYCLE", title: `Probation started (${months} months)`, effectiveDate: startDate, createdBy: ctx.userId } });
      return created;
    });
    await this.audit.record({ orgId: ctx.orgId, action: "employee.probation_started", resourceType: "employee", resourceId: employeeId, after: { probationId: rec.id, months } });
    return this.get(rec.id);
  }

  // ---- review (confirm / extend / terminate) -------------------------------

  async review(probationId: string, input: { recommendation: "CONFIRM" | "EXTEND" | "TERMINATE"; performanceNote?: string; attendanceNote?: string; reviewNote?: string; extendMonths?: number; exitReason?: string }) {
    const ctx = requireTenantContext();
    const rec = await this.prisma.probationRecord.findFirst({ where: { id: probationId, orgId: ctx.orgId } });
    if (!rec) throw new NotFoundException("Probation record not found.");
    if (rec.status === "CONFIRMED" || rec.status === "TERMINATED") throw new ConflictException("This probation is already closed.");
    await this.assertEmployee(ctx.orgId, rec.employeeId, permissions.employeeWrite);

    const reviewData = {
      performanceNote: input.performanceNote?.trim() || rec.performanceNote,
      attendanceNote: input.attendanceNote?.trim() || rec.attendanceNote,
      reviewNote: input.reviewNote?.trim() || rec.reviewNote,
      recommendation: input.recommendation,
      reviewedBy: ctx.userId,
      reviewedAt: new Date(),
    };

    if (input.recommendation === "CONFIRM") {
      await this.prisma.$transaction(async (tx) => {
        await tx.probationRecord.update({ where: { id: rec.id }, data: { ...reviewData, status: "CONFIRMED" } });
        await tx.employee.update({ where: { id: rec.employeeId }, data: { lifecycleStage: "CONFIRMED", confirmedAt: new Date(), status: "ACTIVE" } });
        await tx.employmentEvent.create({ data: { orgId: ctx.orgId, employeeId: rec.employeeId, type: "LIFECYCLE", title: "Confirmed as permanent", createdBy: ctx.userId } });
        await this.outbox.enqueue(tx, { eventType: "employee.confirmed", aggregateType: "employee", aggregateId: rec.employeeId, orgId: ctx.orgId, payload: { probationId: rec.id, employeeId: rec.employeeId, requesterUserId: ctx.userId } });
      });
      await this.audit.record({ orgId: ctx.orgId, action: "employee.confirmed", resourceType: "employee", resourceId: rec.employeeId, after: { probationId: rec.id } });
      return this.get(rec.id);
    }

    if (input.recommendation === "EXTEND") {
      const months = input.extendMonths ?? 3;
      if (months < 1 || months > 12) throw new BadRequestException("Extension must be 1–12 months.");
      const newEnd = addMonths(rec.endDate, months);
      await this.prisma.$transaction(async (tx) => {
        await tx.probationExtension.create({ data: { orgId: ctx.orgId, probationId: rec.id, fromEndDate: rec.endDate, toEndDate: newEnd, reason: input.reviewNote?.trim() || null, extendedBy: ctx.userId } });
        // Bump the end date + reset the reminder ledger so fresh warnings fire; the
        // original end date is preserved on the record and in the extension row.
        await tx.probationRecord.update({ where: { id: rec.id }, data: { ...reviewData, status: "EXTENDED", endDate: newEnd, lastRemindedDays: null } });
        await tx.employee.update({ where: { id: rec.employeeId }, data: { probationEndsAt: newEnd } });
        await tx.employmentEvent.create({ data: { orgId: ctx.orgId, employeeId: rec.employeeId, type: "LIFECYCLE", title: `Probation extended to ${newEnd.toISOString().slice(0, 10)}`, createdBy: ctx.userId } });
      });
      await this.audit.record({ orgId: ctx.orgId, action: "employee.probation_extended", resourceType: "employee", resourceId: rec.employeeId, after: { probationId: rec.id, newEnd } });
      return this.get(rec.id);
    }

    // TERMINATE → close the probation and hand off to the structured exit process.
    await this.prisma.probationRecord.update({ where: { id: rec.id }, data: { ...reviewData, status: "TERMINATED" } });
    await this.audit.record({ orgId: ctx.orgId, action: "employee.probation_terminated", resourceType: "employee", resourceId: rec.employeeId, after: { probationId: rec.id } });
    // Kick off the exit process (offboarding checklist, alumni on completion).
    await this.exits.initiate(rec.employeeId, { reason: (input.exitReason as "TERMINATION") || "TERMINATION", reasonNote: `Probation not cleared. ${input.reviewNote ?? ""}`.trim() });
    return this.get(rec.id);
  }

  // ---- reads ---------------------------------------------------------------

  async get(probationId: string) {
    const ctx = requireTenantContext();
    const rec = await this.prisma.probationRecord.findFirst({ where: { id: probationId, orgId: ctx.orgId }, include: { extensions: { orderBy: { createdAt: "asc" } } } });
    if (!rec) throw new NotFoundException("Probation record not found.");
    return this.serialize(rec);
  }

  async listForEmployee(employeeId: string) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId, permissions.employeeRead);
    const rows = await this.prisma.probationRecord.findMany({ where: { orgId: ctx.orgId, employeeId }, orderBy: { createdAt: "desc" }, include: { extensions: { orderBy: { createdAt: "asc" } } } });
    return rows.map((r) => this.serialize(r));
  }

  private serialize(r: { id: string; employeeId: string; startDate: Date; endDate: Date; originalEndDate: Date; durationMonths: number; status: string; performanceNote: string | null; attendanceNote: string | null; reviewNote: string | null; recommendation: string | null; reviewedAt: Date | null; createdAt: Date; extensions: { id: string; fromEndDate: Date; toEndDate: Date; reason: string | null; createdAt: Date }[] }) {
    const now = new Date();
    const daysLeft = Math.round((Date.UTC(r.endDate.getUTCFullYear(), r.endDate.getUTCMonth(), r.endDate.getUTCDate()) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
    return {
      id: r.id, employeeId: r.employeeId,
      startDate: r.startDate.toISOString().slice(0, 10), endDate: r.endDate.toISOString().slice(0, 10),
      originalEndDate: r.originalEndDate.toISOString().slice(0, 10), durationMonths: r.durationMonths,
      status: r.status, daysLeft: ["ACTIVE", "EXTENDED"].includes(r.status) ? daysLeft : null,
      performanceNote: r.performanceNote, attendanceNote: r.attendanceNote, reviewNote: r.reviewNote,
      recommendation: r.recommendation, reviewedAt: r.reviewedAt?.toISOString() ?? null,
      extensions: r.extensions.map((e) => ({ id: e.id, from: e.fromEndDate.toISOString().slice(0, 10), to: e.toEndDate.toISOString().slice(0, 10), reason: e.reason })),
      createdAt: r.createdAt.toISOString(),
    };
  }
}
