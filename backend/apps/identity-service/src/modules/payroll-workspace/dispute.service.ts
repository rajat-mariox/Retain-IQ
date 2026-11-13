import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@retainiq/database/identity";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { ObservationService } from "../observation/observation.service.js";

const NIL = "00000000-0000-0000-0000-000000000000";

/** Dispute lifecycle (§19). Employee raises → HR/Finance assigns → reviews → resolves. */
type DisputeStatus = "SUBMITTED" | "ASSIGNED" | "UNDER_REVIEW" | "EMPLOYEE_INPUT_REQUIRED" | "RESOLVED" | "CLOSED";

// Admin-driven transitions. The employee's only write is the initial SUBMITTED
// (create) and supplying requested input (EMPLOYEE_INPUT_REQUIRED → UNDER_REVIEW).
const ADMIN_TRANSITIONS: Record<DisputeStatus, DisputeStatus[]> = {
  SUBMITTED: ["ASSIGNED", "UNDER_REVIEW", "CLOSED"],
  ASSIGNED: ["UNDER_REVIEW", "EMPLOYEE_INPUT_REQUIRED", "RESOLVED", "CLOSED"],
  UNDER_REVIEW: ["EMPLOYEE_INPUT_REQUIRED", "RESOLVED", "CLOSED"],
  EMPLOYEE_INPUT_REQUIRED: ["UNDER_REVIEW", "RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export interface CreateDisputeInput {
  recordId?: string | null;
  category: string; // INCORRECT_BASE | MISSING_INCENTIVE | WRONG_DEDUCTION | TAX | NOT_RECEIVED | OTHER
  description: string;
}

/**
 * Payroll Dispute workspace (§19). An employee who believes their payout is wrong
 * raises a dispute against a specific payroll record (or generally). Each dispute
 * is linked to an HR case — created through ObservationService so we reuse the
 * existing case timeline/routing rather than duplicating case logic — with the
 * case id stored on hrCaseRef. Employees see only their own; HR/Finance (with the
 * assign/resolve permissions) work the queue, scoped to their reach via ABAC.
 */
@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly accessScope: AccessScopeService,
    private readonly observations: ObservationService,
  ) {}

  // ---- helpers ----

  /** The caller's own employee id (staff record). Owners have none — not staff. */
  private async selfEmployeeId(orgId: string, userId: string): Promise<string | null> {
    const m = await this.prisma.organizationMembership.findFirst({ where: { orgId, userId, status: "ACTIVE" }, select: { employeeId: true } });
    return m?.employeeId ?? null;
  }

  /** Employee ids the caller may see disputes for (null = whole org). */
  private async reach(orgId: string, userId: string): Promise<string[] | null> {
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollDisputeRead);
    if (scope.tier === "org") return null;
    const rows = await this.prisma.employee.findMany({ where: { orgId, ...this.accessScope.employeeWhere(scope) }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  private async emit(tx: Prisma.TransactionClient, orgId: string, disputeId: string, payload: Record<string, unknown>) {
    await this.outbox.enqueue(tx, { eventType: "payroll.dispute.updated", aggregateType: "payroll_dispute", aggregateId: disputeId, orgId, payload });
  }

  private view(d: {
    id: string; orgId: string; employeeId: string; recordId: string | null; category: string; description: string;
    status: string; assignedTo: string | null; hrCaseRef: string | null; resolution: string | null; createdAt: Date; updatedAt: Date;
  }, employeeName?: string) {
    return {
      id: d.id,
      employeeId: d.employeeId,
      employeeName: employeeName ?? null,
      recordId: d.recordId,
      category: d.category,
      description: d.description,
      status: d.status,
      assignedTo: d.assignedTo,
      hrCaseRef: d.hrCaseRef,
      resolution: d.resolution,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  }

  // ---- employee side ----

  /** An employee raises a dispute about their own payout, and we open a linked HR case. */
  async create(input: CreateDisputeInput) {
    const { orgId, userId } = requireTenantContext();
    const employeeId = await this.selfEmployeeId(orgId, userId);
    if (!employeeId) throw new ForbiddenException("Only staff with a payroll profile can raise a payout dispute.");

    // A referenced record must be this employee's own — never someone else's payout.
    if (input.recordId) {
      const rec = await this.prisma.payrollRecord.findFirst({ where: { id: input.recordId, orgId, employeeId }, select: { id: true } });
      if (!rec) throw new NotFoundException("Referenced payroll record not found for you.");
    }

    const dispute = await this.prisma.payrollDispute.create({
      data: {
        orgId,
        employeeId,
        recordId: input.recordId ?? null,
        category: input.category,
        description: input.description,
        status: "SUBMITTED",
      },
    });

    // Link an HR case via the Observation workflow (no duplicated case logic, §19).
    const hrCaseRef = await this.openLinkedCase(orgId, employeeId, input.category, input.description);
    if (hrCaseRef) await this.prisma.payrollDispute.update({ where: { id: dispute.id }, data: { hrCaseRef } });

    await this.audit.record({ orgId, actorUserId: userId, resourceType: "payroll_dispute", resourceId: dispute.id, action: "payroll.dispute.created", after: { category: input.category, recordId: input.recordId ?? null, hrCaseRef } });
    await this.prisma.$transaction(async (tx) => {
      await this.emit(tx, orgId, dispute.id, { disputeId: dispute.id, employeeId, category: input.category, status: "SUBMITTED", action: "created" });
    });

    return this.view({ ...dispute, hrCaseRef: hrCaseRef ?? dispute.hrCaseRef });
  }

  /** Best-effort: open an Observation case for the dispute; returns its id (or null). */
  private async openLinkedCase(orgId: string, employeeId: string, category: string, description: string): Promise<string | null> {
    try {
      const obs = await this.observations.createManual({
        employeeId,
        type: "OTHER",
        severity: "MEDIUM",
        title: `Payroll dispute: ${category}`,
        detail: description,
      });
      return obs.id;
    } catch (err) {
      // The dispute must still stand even if case creation fails; it can be linked at assign time.
      this.logger.warn(`Could not open linked HR case for a payroll dispute (org ${orgId}, employee ${employeeId}): ${String(err)}`);
      return null;
    }
  }

  /** The caller's own disputes. */
  async mine() {
    const { orgId, userId } = requireTenantContext();
    const employeeId = await this.selfEmployeeId(orgId, userId);
    if (!employeeId) return { items: [] };
    const rows = await this.prisma.payrollDispute.findMany({ where: { orgId, employeeId }, orderBy: { createdAt: "desc" }, take: 200 });
    return { items: rows.map((r) => this.view(r)) };
  }

  /** Employee supplies the requested input, moving an EMPLOYEE_INPUT_REQUIRED dispute back to review. */
  async respond(id: string, note: string) {
    const { orgId, userId } = requireTenantContext();
    const employeeId = await this.selfEmployeeId(orgId, userId);
    const d = await this.prisma.payrollDispute.findFirst({ where: { id, orgId } });
    if (!d || d.employeeId !== employeeId) throw new NotFoundException("Dispute not found.");
    if (d.status !== "EMPLOYEE_INPUT_REQUIRED") throw new BadRequestException("This dispute is not awaiting your input.");
    const updated = await this.prisma.payrollDispute.update({ where: { id }, data: { status: "UNDER_REVIEW", description: `${d.description}\n\n[Employee response] ${note}` } });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "payroll_dispute", resourceId: id, action: "payroll.dispute.employee_responded", before: { status: d.status }, after: { status: "UNDER_REVIEW" } });
    await this.prisma.$transaction(async (tx) => this.emit(tx, orgId, id, { disputeId: id, status: "UNDER_REVIEW", action: "employee_responded" }));
    return this.view(updated);
  }

  // ---- admin side ----

  private async loadInReach(id: string) {
    const { orgId, userId } = requireTenantContext();
    const d = await this.prisma.payrollDispute.findFirst({ where: { id, orgId } });
    if (!d) throw new NotFoundException("Dispute not found.");
    const reach = await this.reach(orgId, userId);
    if (reach !== null && !reach.includes(d.employeeId)) throw new NotFoundException("Dispute not found.");
    return d;
  }

  /** Admin queue, scoped to the caller's reach. */
  async list(filters: { status?: string; employeeId?: string }) {
    const { orgId, userId } = requireTenantContext();
    const reach = await this.reach(orgId, userId);
    const where: Record<string, unknown> = { orgId };
    if (reach !== null) where.employeeId = { in: reach.length > 0 ? reach : [NIL] };
    if (filters.status) where.status = filters.status;
    if (filters.employeeId) where.employeeId = filters.employeeId;

    const rows = await this.prisma.payrollDispute.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 });
    const empIds = [...new Set(rows.map((r) => r.employeeId))];
    const emps = await this.prisma.employee.findMany({ where: { orgId, id: { in: empIds.length ? empIds : [NIL] } }, select: { id: true, firstName: true, lastName: true } });
    const byEmp = new Map(emps.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));

    const openStates = new Set(["SUBMITTED", "ASSIGNED", "UNDER_REVIEW", "EMPLOYEE_INPUT_REQUIRED"]);
    const summary = {
      total: rows.length,
      open: rows.filter((r) => openStates.has(r.status)).length,
      unassigned: rows.filter((r) => r.status === "SUBMITTED").length,
      resolved: rows.filter((r) => r.status === "RESOLVED" || r.status === "CLOSED").length,
    };
    return { summary, items: rows.map((r) => this.view(r, byEmp.get(r.employeeId))) };
  }

  async get(id: string) {
    const d = await this.loadInReach(id);
    const emp = await this.prisma.employee.findFirst({ where: { id: d.employeeId, orgId: d.orgId }, select: { firstName: true, lastName: true } });
    return this.view(d, emp ? `${emp.firstName} ${emp.lastName}`.trim() : undefined);
  }

  /** Assign a dispute to an owner and move it into the queue. */
  async assign(id: string, assignedTo?: string) {
    const { orgId, userId } = requireTenantContext();
    const d = await this.loadInReach(id);
    if (d.status === "RESOLVED" || d.status === "CLOSED") throw new BadRequestException("This dispute is already closed.");
    const assignee = assignedTo ?? userId;

    // If no HR case was linked at creation (e.g. transient failure), open one now.
    let hrCaseRef = d.hrCaseRef;
    if (!hrCaseRef) hrCaseRef = await this.openLinkedCase(orgId, d.employeeId, d.category, d.description);

    const updated = await this.prisma.payrollDispute.update({ where: { id }, data: { status: "ASSIGNED", assignedTo: assignee, hrCaseRef: hrCaseRef ?? undefined } });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "payroll_dispute", resourceId: id, action: "payroll.dispute.assigned", before: { status: d.status, assignedTo: d.assignedTo }, after: { status: "ASSIGNED", assignedTo: assignee } });
    await this.prisma.$transaction(async (tx) => this.emit(tx, orgId, id, { disputeId: id, status: "ASSIGNED", assignedTo: assignee, action: "assigned" }));
    return this.view(updated);
  }

  /**
   * Move a dispute forward (review / request input / resolve / close). A RESOLVED
   * or CLOSED transition carries the resolution text and closes the linked HR case.
   */
  async transition(id: string, to: DisputeStatus, resolution?: string) {
    const { orgId, userId } = requireTenantContext();
    const d = await this.loadInReach(id);
    const from = d.status as DisputeStatus;
    const allowed = ADMIN_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`Cannot move a dispute from ${from} to ${to}.`);
    if ((to === "RESOLVED" || to === "CLOSED") && !resolution && !d.resolution) throw new BadRequestException("A resolution note is required to resolve or close a dispute.");

    const updated = await this.prisma.payrollDispute.update({
      where: { id },
      data: { status: to, resolution: resolution ?? d.resolution ?? undefined },
    });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "payroll_dispute", resourceId: id, action: `payroll.dispute.${to.toLowerCase()}`, before: { status: from }, after: { status: to, resolution: resolution ?? d.resolution ?? null } });
    await this.prisma.$transaction(async (tx) => this.emit(tx, orgId, id, { disputeId: id, status: to, action: to.toLowerCase() }));

    // Close the linked HR case when the dispute is resolved (best-effort).
    if ((to === "RESOLVED" || to === "CLOSED") && d.hrCaseRef) {
      try {
        await this.observations.resolve(d.hrCaseRef, resolution ?? d.resolution ?? "Payroll dispute resolved.");
      } catch (err) {
        this.logger.warn(`Could not close linked HR case ${d.hrCaseRef} for dispute ${id}: ${String(err)}`);
      }
    }
    return this.view(updated);
  }
}
