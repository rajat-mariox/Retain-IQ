import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@retainiq/database/identity";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { AuditService } from "../../common/audit/audit.service.js";

type ExitReason = "RESIGNATION" | "TERMINATION" | "RETIREMENT" | "CONTRACT_END" | "LAYOFF" | "OTHER";

// The default offboarding checklist seeded when an exit is initiated. Covers the
// standard spec clearances; HR can add or skip items after.
const DEFAULT_CHECKLIST: { title: string; category: string; assignee: string }[] = [
  { title: "Knowledge transfer & handover", category: "KNOWLEDGE_TRANSFER", assignee: "MANAGER" },
  { title: "Recover company assets (laptop, devices, badge)", category: "ASSET_RECOVERY", assignee: "IT" },
  { title: "Revoke system & application access", category: "ACCESS_REVOCATION", assignee: "IT" },
  { title: "Conduct exit interview", category: "EXIT_INTERVIEW", assignee: "HR" },
  { title: "Process final payroll & settlement", category: "FINAL_PAYROLL", assignee: "FINANCE" },
  { title: "Issue experience & relieving documents", category: "DOCUMENTS", assignee: "HR" },
];

/**
 * The structured exit process. Initiating an exit seeds an offboarding checklist
 * and puts the employee on notice — it does NOT immediately deactivate them.
 * Completing the exit (on the last working day) is the single point that flips the
 * employee to EXITED, writes the alumni record, revokes access (via a domain event
 * other services consume) and emits the exit event. Cancelling before completion
 * leaves the employee active. Reuses the ABAC gate and the transactional outbox.
 */
@Injectable()
export class ExitService {
  private readonly log = new Logger(ExitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
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

  // ---- initiate ------------------------------------------------------------

  async initiate(employeeId: string, input: { reason: ExitReason; reasonNote?: string; noticeStartDate?: string; lastWorkingDay?: string }) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId, permissions.employeeWrite);

    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId: ctx.orgId }, select: { id: true, lifecycleStage: true, status: true, firstName: true, lastName: true } });
    if (!emp) throw new NotFoundException("Employee not found.");
    if (emp.lifecycleStage === "EXITED") throw new ConflictException("This employee has already exited.");
    const open = await this.prisma.employeeExit.findFirst({ where: { orgId: ctx.orgId, employeeId, status: { in: ["INITIATED", "NOTICE_PERIOD", "CLEARANCE"] } }, select: { id: true } });
    if (open) throw new ConflictException("An exit is already in progress for this employee.");

    const exit = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeExit.create({
        data: {
          orgId: ctx.orgId, employeeId, reason: input.reason,
          reasonNote: input.reasonNote?.trim() || null,
          noticeStartDate: input.noticeStartDate ? new Date(input.noticeStartDate) : new Date(),
          lastWorkingDay: input.lastWorkingDay ? new Date(input.lastWorkingDay) : null,
          initiatedBy: ctx.userId,
          status: "NOTICE_PERIOD",
        },
      });
      await tx.offboardingTask.createMany({
        data: DEFAULT_CHECKLIST.map((t, i) => ({ orgId: ctx.orgId, exitId: created.id, title: t.title, category: t.category, assignee: t.assignee, order: i })),
      });
      // Put the employee on notice (not exited yet) so attendance/leave still work.
      if (emp.status !== "NOTICE_PERIOD") await tx.employee.update({ where: { id: employeeId }, data: { status: "NOTICE_PERIOD" } });
      await tx.employmentEvent.create({ data: { orgId: ctx.orgId, employeeId, type: "STATUS_CHANGE", title: `Exit initiated (${input.reason.toLowerCase().replace("_", " ")})`, detail: input.reasonNote ?? undefined, createdBy: ctx.userId } });
      await this.outbox.enqueue(tx, {
        eventType: "employee.exit_started",
        aggregateType: "employee", aggregateId: employeeId, orgId: ctx.orgId,
        payload: { exitId: created.id, employeeId, reason: input.reason, requesterUserId: ctx.userId },
      });
      return created;
    });

    await this.audit.record({ orgId: ctx.orgId, action: "employee.exit_started", resourceType: "employee", resourceId: employeeId, after: { exitId: exit.id, reason: input.reason } });
    return this.get(exit.id);
  }

  // ---- checklist -----------------------------------------------------------

  async addTask(exitId: string, input: { title: string; category?: string; assignee?: string }) {
    const ctx = requireTenantContext();
    const exit = await this.requireOpen(ctx.orgId, exitId);
    const count = await this.prisma.offboardingTask.count({ where: { exitId } });
    await this.prisma.offboardingTask.create({ data: { orgId: ctx.orgId, exitId, title: input.title.trim(), category: input.category?.trim() || "OTHER", assignee: input.assignee?.trim() || "HR", order: count } });
    return this.get(exit.id);
  }

  async setTaskStatus(taskId: string, status: "PENDING" | "DONE" | "SKIPPED", note?: string) {
    const ctx = requireTenantContext();
    const task = await this.prisma.offboardingTask.findFirst({ where: { id: taskId, orgId: ctx.orgId }, include: { exit: { select: { id: true, employeeId: true } } } });
    if (!task) throw new NotFoundException("Task not found.");
    await this.assertEmployee(ctx.orgId, task.exit.employeeId, permissions.employeeWrite);
    await this.prisma.offboardingTask.update({
      where: { id: task.id },
      data: { status, note: note?.trim() || task.note, completedAt: status === "DONE" ? new Date() : null, completedBy: status === "DONE" ? ctx.userId : null },
    });
    return this.get(task.exit.id);
  }

  // ---- complete / cancel ---------------------------------------------------

  /** The last working day: flip the employee to EXITED and create the alumni row. */
  async complete(exitId: string, input: { lastWorkingDay?: string; exitInterviewNote?: string; rehireEligible?: boolean; rehireRating?: number }) {
    const ctx = requireTenantContext();
    const exit = await this.prisma.employeeExit.findFirst({ where: { id: exitId, orgId: ctx.orgId }, include: { tasks: true } });
    if (!exit) throw new NotFoundException("Exit not found.");
    if (exit.status === "COMPLETED") throw new ConflictException("This exit is already completed.");
    if (exit.status === "CANCELLED") throw new ConflictException("This exit was cancelled.");
    await this.assertEmployee(ctx.orgId, exit.employeeId, permissions.employeeWrite);

    const lastDay = input.lastWorkingDay ? new Date(input.lastWorkingDay) : exit.lastWorkingDay ?? new Date();

    await this.prisma.$transaction(async (tx) => {
      // Flip employee to EXITED (terminal).
      await tx.employee.update({ where: { id: exit.employeeId }, data: { lifecycleStage: "EXITED", status: "EXITED", exitedAt: lastDay } });
      await tx.employeeExit.update({
        where: { id: exit.id },
        data: { status: "COMPLETED", completedAt: new Date(), lastWorkingDay: lastDay, exitInterviewNote: input.exitInterviewNote?.trim() || exit.exitInterviewNote, rehireEligible: input.rehireEligible ?? exit.rehireEligible, rehireRating: input.rehireRating ?? exit.rehireRating },
      });
      await this.upsertAlumni(tx, ctx.orgId, exit.employeeId, exit.reason, input.rehireEligible ?? exit.rehireEligible, input.rehireRating ?? exit.rehireRating ?? null, lastDay);
      await tx.employmentEvent.create({ data: { orgId: ctx.orgId, employeeId: exit.employeeId, type: "EXIT", title: "Exited the organization", effectiveDate: lastDay, createdBy: ctx.userId } });
      // Access revocation is a domain event other services (IT/identity) consume —
      // the employee module never reaches into IT directly.
      await this.outbox.enqueue(tx, { eventType: "employee.access_revoked", aggregateType: "employee", aggregateId: exit.employeeId, orgId: ctx.orgId, payload: { exitId: exit.id, employeeId: exit.employeeId } });
      await this.outbox.enqueue(tx, { eventType: "employee.exited", aggregateType: "employee", aggregateId: exit.employeeId, orgId: ctx.orgId, payload: { exitId: exit.id, employeeId: exit.employeeId, reason: exit.reason, requesterUserId: ctx.userId } });
      await this.outbox.enqueue(tx, { eventType: "employee.alumni_created", aggregateType: "employee", aggregateId: exit.employeeId, orgId: ctx.orgId, payload: { employeeId: exit.employeeId } });
    });

    await this.audit.record({ orgId: ctx.orgId, action: "employee.exited", resourceType: "employee", resourceId: exit.employeeId, after: { exitId: exit.id } });
    this.log.log(`Exit ${exit.id} completed for employee ${exit.employeeId}`);
    return this.get(exit.id);
  }

  async cancel(exitId: string) {
    const ctx = requireTenantContext();
    const exit = await this.prisma.employeeExit.findFirst({ where: { id: exitId, orgId: ctx.orgId } });
    if (!exit) throw new NotFoundException("Exit not found.");
    if (!["INITIATED", "NOTICE_PERIOD", "CLEARANCE"].includes(exit.status)) throw new ConflictException("This exit can no longer be cancelled.");
    await this.assertEmployee(ctx.orgId, exit.employeeId, permissions.employeeWrite);
    await this.prisma.$transaction(async (tx) => {
      await tx.employeeExit.update({ where: { id: exit.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      // Restore the employee off notice (best effort — back to ACTIVE).
      await tx.employee.update({ where: { id: exit.employeeId }, data: { status: "ACTIVE" } });
      await tx.employmentEvent.create({ data: { orgId: ctx.orgId, employeeId: exit.employeeId, type: "STATUS_CHANGE", title: "Exit cancelled", createdBy: ctx.userId } });
    });
    await this.audit.record({ orgId: ctx.orgId, action: "employee.exit_cancelled", resourceType: "employee", resourceId: exit.employeeId, after: { exitId: exit.id } });
    return this.get(exit.id);
  }

  /**
   * Create/refresh the alumni projection for a former employee. Shared by the
   * structured exit and the quick lifecycle exit, so both paths leave a searchable
   * alumni record. Snapshots the current designation/department labels.
   */
  async upsertAlumni(tx: Prisma.TransactionClient, orgId: string, employeeId: string, reason: ExitReason | null, rehireEligible: boolean, rehireRating: number | null, exitDate: Date) {
    const emp = await tx.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true, email: true, personalEmail: true, joinedAt: true, designationRef: { select: { title: true } }, departmentRef: { select: { name: true } } },
    });
    if (!emp) return;
    const fullName = `${emp.firstName} ${emp.lastName}`.trim();
    await tx.employeeAlumni.upsert({
      where: { employeeId },
      create: { orgId, employeeId, fullName, workEmail: emp.email, personalEmail: emp.personalEmail, joiningDate: emp.joinedAt, exitDate, lastDesignation: emp.designationRef?.title ?? null, lastDepartment: emp.departmentRef?.name ?? null, exitReason: reason ?? undefined, rehireEligible, rehireRating },
      update: { fullName, exitDate, lastDesignation: emp.designationRef?.title ?? null, lastDepartment: emp.departmentRef?.name ?? null, exitReason: reason ?? undefined, rehireEligible, rehireRating },
    });
  }

  // ---- reads ---------------------------------------------------------------

  private async requireOpen(orgId: string, exitId: string) {
    const exit = await this.prisma.employeeExit.findFirst({ where: { id: exitId, orgId } });
    if (!exit) throw new NotFoundException("Exit not found.");
    if (!["INITIATED", "NOTICE_PERIOD", "CLEARANCE"].includes(exit.status)) throw new ConflictException("This exit is closed.");
    await this.assertEmployee(orgId, exit.employeeId, permissions.employeeWrite);
    return exit;
  }

  async get(exitId: string) {
    const ctx = requireTenantContext();
    const exit = await this.prisma.employeeExit.findFirst({ where: { id: exitId, orgId: ctx.orgId }, include: { tasks: { orderBy: { order: "asc" } } } });
    if (!exit) throw new NotFoundException("Exit not found.");
    return this.serialize(exit);
  }

  async listForEmployee(employeeId: string) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId, permissions.employeeRead);
    const rows = await this.prisma.employeeExit.findMany({ where: { orgId: ctx.orgId, employeeId }, orderBy: { initiatedAt: "desc" }, include: { tasks: { orderBy: { order: "asc" } } } });
    return rows.map((e) => this.serialize(e));
  }

  private serialize(e: { id: string; employeeId: string; reason: string; status: string; reasonNote: string | null; noticeStartDate: Date | null; lastWorkingDay: Date | null; exitInterviewNote: string | null; rehireEligible: boolean; rehireRating: number | null; initiatedAt: Date; tasks: { id: string; title: string; category: string; assignee: string; status: string; note: string | null }[] }) {
    const done = e.tasks.filter((t) => t.status === "DONE" || t.status === "SKIPPED").length;
    return {
      id: e.id, employeeId: e.employeeId, reason: e.reason, status: e.status, reasonNote: e.reasonNote,
      noticeStartDate: e.noticeStartDate ? e.noticeStartDate.toISOString().slice(0, 10) : null,
      lastWorkingDay: e.lastWorkingDay ? e.lastWorkingDay.toISOString().slice(0, 10) : null,
      exitInterviewNote: e.exitInterviewNote, rehireEligible: e.rehireEligible, rehireRating: e.rehireRating,
      initiatedAt: e.initiatedAt.toISOString(), progress: { done, total: e.tasks.length },
      tasks: e.tasks.map((t) => ({ id: t.id, title: t.title, category: t.category, assignee: t.assignee, status: t.status, note: t.note })),
    };
  }
}
