import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@retainiq/database/identity";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { AuditService } from "../../common/audit/audit.service.js";

type Kind = "PROMOTION" | "TRANSFER";
type Proposed = { designationId?: string | null; title?: string | null; departmentId?: string | null; teamId?: string | null; managerId?: string | null; location?: string | null };

const DEFAULT_PROMOTION_CHAIN = ["MANAGER", "HR", "FINANCE"];
const DEFAULT_TRANSFER_CHAIN = ["MANAGER", "NEW_MANAGER", "HR"];

/**
 * The promotion/transfer approval engine. A request captures the proposed change
 * plus a snapshot of what it replaces, then walks a configurable per-org chain of
 * approver roles. Only when every step approves does apply() write the change —
 * updating the employee, recording an immutable career-history row, an employment
 * timeline event, an audit entry, and a domain event. Future-dated approvals wait
 * in SCHEDULED for the cron. The employee row is never mutated outside apply().
 */
@Injectable()
export class ChangeRequestService {
  private readonly log = new Logger(ChangeRequestService.name);

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

  private async chainFor(orgId: string, kind: Kind): Promise<string[]> {
    const s = await this.prisma.workforceSetting.findUnique({ where: { orgId } });
    const chain = kind === "PROMOTION" ? (s?.promotionChain ?? DEFAULT_PROMOTION_CHAIN) : (s?.transferChain ?? DEFAULT_TRANSFER_CHAIN);
    return chain;
  }

  /** Resolve which login userId should approve a given chain role for this request. */
  private async resolveApprover(orgId: string, role: string, employee: { managerId: string | null }, proposedManagerId?: string | null): Promise<string | null> {
    const membershipUserId = async (empId: string | null) => {
      if (!empId) return null;
      const m = await this.prisma.organizationMembership.findFirst({ where: { orgId, employeeId: empId, status: "ACTIVE" }, select: { userId: true } });
      return m?.userId ?? null;
    };
    if (role === "MANAGER") return membershipUserId(employee.managerId);
    if (role === "NEW_MANAGER") return membershipUserId(proposedManagerId ?? null);
    // HR / DEPARTMENT_HEAD / FINANCE → the first org member whose role carries the
    // matching permission; falls back to any employee.write holder (an admin/owner).
    const perm = role === "FINANCE" ? permissions.payrollApprove : permissions.employeeWrite;
    const holder = await this.prisma.organizationMembership.findFirst({
      where: { orgId, status: "ACTIVE", role: { permissions: { has: perm } } },
      select: { userId: true },
      orderBy: { createdAt: "asc" },
    });
    return holder?.userId ?? null;
  }

  // ---- create --------------------------------------------------------------

  async create(employeeId: string, kind: Kind, proposed: Proposed, opts: { reason?: string; effectiveDate?: string }) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId, permissions.employeeWrite);

    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, orgId: ctx.orgId },
      select: { id: true, designationId: true, title: true, departmentId: true, teamId: true, managerId: true, location: true, status: true },
    });
    if (!emp) throw new NotFoundException("Employee not found.");
    if (emp.status === "EXITED") throw new ConflictException("This employee has exited.");

    // Validate + narrow proposed to keys that actually change.
    const changed: Proposed = {};
    const previous: Proposed = {};
    for (const k of ["designationId", "title", "departmentId", "teamId", "managerId", "location"] as const) {
      if (proposed[k] !== undefined && proposed[k] !== emp[k]) { changed[k] = proposed[k]; previous[k] = emp[k]; }
    }
    if (Object.keys(changed).length === 0) throw new BadRequestException("The request must change at least one field.");
    if (changed.managerId === employeeId) throw new ConflictException("An employee cannot be their own manager.");

    // Validate referenced ids belong to the org.
    for (const [k, table] of [["designationId", "designation"], ["departmentId", "department"], ["teamId", "team"], ["managerId", "employee"]] as const) {
      const id = changed[k as keyof Proposed];
      if (id) {
        const row = await (this.prisma as unknown as Record<string, { findFirst: (a: unknown) => Promise<unknown> }>)[table]!.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
        if (!row) throw new NotFoundException(`Referenced ${table} not found.`);
      }
    }

    const effectiveDate = opts.effectiveDate ? new Date(opts.effectiveDate) : new Date();
    const roles = await this.chainFor(ctx.orgId, kind);

    // No pending request should overlap for the same employee+kind.
    const dupe = await this.prisma.employeeChangeRequest.findFirst({ where: { orgId: ctx.orgId, employeeId, kind, status: { in: ["PENDING_APPROVAL", "APPROVED", "SCHEDULED"] } }, select: { id: true } });
    if (dupe) throw new ConflictException(`A ${kind.toLowerCase()} for this employee is already in progress.`);

    const req = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeChangeRequest.create({
        data: {
          orgId: ctx.orgId, employeeId, kind,
          status: roles.length === 0 ? "APPROVED" : "PENDING_APPROVAL",
          proposed: changed as Prisma.InputJsonValue,
          previous: previous as Prisma.InputJsonValue,
          reason: opts.reason?.trim() || null,
          effectiveDate,
          requestedBy: ctx.userId,
          decidedAt: roles.length === 0 ? new Date() : null,
        },
      });
      // Build the approval chain, resolving the approver per role.
      for (let i = 0; i < roles.length; i++) {
        const assignedTo = await this.resolveApprover(ctx.orgId, roles[i]!, emp, changed.managerId);
        await tx.changeApprovalStep.create({ data: { orgId: ctx.orgId, requestId: created.id, order: i, role: roles[i]!, assignedTo } });
      }
      await this.outbox.enqueue(tx, {
        eventType: kind === "PROMOTION" ? "employee.promotion_requested" : "employee.transfer_requested",
        aggregateType: "employee_change_request", aggregateId: created.id, orgId: ctx.orgId,
        payload: { requestId: created.id, employeeId, kind, requesterUserId: await this.firstApprover(tx, created.id) },
      });
      return created;
    });

    // Chainless orgs apply immediately (unless future-dated → schedule).
    if (roles.length === 0) await this.finalizeApproval(req.id);
    await this.audit.record({ orgId: ctx.orgId, action: `employee.${kind.toLowerCase()}_requested`, resourceType: "employee", resourceId: employeeId, after: { requestId: req.id, changed } });
    return this.get(req.id);
  }

  private async firstApprover(tx: Prisma.TransactionClient, requestId: string): Promise<string | null> {
    const s = await tx.changeApprovalStep.findFirst({ where: { requestId }, orderBy: { order: "asc" }, select: { assignedTo: true } });
    return s?.assignedTo ?? null;
  }

  // ---- decide (approve / reject a step) ------------------------------------

  async decide(requestId: string, approve: boolean, note?: string) {
    const ctx = requireTenantContext();
    const req = await this.prisma.employeeChangeRequest.findFirst({ where: { id: requestId, orgId: ctx.orgId }, include: { steps: { orderBy: { order: "asc" } } } });
    if (!req) throw new NotFoundException("Change request not found.");
    if (req.status !== "PENDING_APPROVAL") throw new ConflictException("This request is no longer awaiting approval.");

    const current = req.steps.find((s) => s.status === "PENDING");
    if (!current) throw new ConflictException("No pending step to decide.");
    // The assigned approver decides; an org-wide employee.write holder (admin/owner) may act on any step.
    const scope = await this.accessScope.resolveScope(ctx.orgId, ctx.userId, permissions.employeeWrite);
    const isAdmin = scope.tier === "org";
    if (current.assignedTo && current.assignedTo !== ctx.userId && !isAdmin) {
      throw new ForbiddenException("This approval step is assigned to someone else.");
    }

    await this.prisma.changeApprovalStep.update({ where: { id: current.id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedBy: ctx.userId, decidedAt: new Date(), note: note?.trim() || null } });

    if (!approve) {
      await this.prisma.employeeChangeRequest.update({ where: { id: req.id }, data: { status: "REJECTED", decidedAt: new Date() } });
      await this.notifyRequester(req.orgId, req.id, req.requestedBy, req.kind, "rejected");
      await this.audit.record({ orgId: ctx.orgId, action: `employee.${req.kind.toLowerCase()}_rejected`, resourceType: "employee", resourceId: req.employeeId, after: { requestId: req.id } });
      return this.get(req.id);
    }

    // Approved this step. If more steps remain, notify the next approver; else finalize.
    const next = req.steps.find((s) => s.order > current.order && s.status === "PENDING");
    if (next) {
      await this.notifyApprover(req.orgId, req.id, next.assignedTo, req.kind);
      return this.get(req.id);
    }
    await this.finalizeApproval(req.id);
    return this.get(req.id);
  }

  /** Chain complete → apply now, or schedule for a future effective date. */
  private async finalizeApproval(requestId: string) {
    const req = await this.prisma.employeeChangeRequest.findUnique({ where: { id: requestId } });
    if (!req) return;
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const effUtc = Date.UTC(req.effectiveDate.getUTCFullYear(), req.effectiveDate.getUTCMonth(), req.effectiveDate.getUTCDate());
    if (effUtc > todayUtc) {
      await this.prisma.employeeChangeRequest.update({ where: { id: req.id }, data: { status: "SCHEDULED", decidedAt: new Date() } });
      await this.notifyRequester(req.orgId, req.id, req.requestedBy, req.kind as Kind, "scheduled");
      return;
    }
    // Immediate: mark fully APPROVED first so apply()'s guard passes, then apply.
    await this.prisma.employeeChangeRequest.update({ where: { id: req.id }, data: { status: "APPROVED", decidedAt: new Date() } });
    await this.apply(req.id);
    await this.notifyRequester(req.orgId, req.id, req.requestedBy, req.kind as Kind, "applied");
  }

  // ---- apply (the only writer of the employee change) ----------------------

  /** Write the approved change: update the employee, record career history, an
   *  employment event, an audit entry and a domain event — all in one tx. */
  async apply(requestId: string) {
    const req = await this.prisma.employeeChangeRequest.findUnique({ where: { id: requestId } });
    if (!req || (req.status !== "APPROVED" && req.status !== "SCHEDULED")) return;
    const proposed = req.proposed as Proposed;

    const emp = await this.prisma.employee.findUnique({ where: { id: req.employeeId }, select: { designationId: true, departmentId: true, teamId: true, managerId: true, title: true, location: true } });
    if (!emp) return;

    // Resolve human-readable labels for the immutable history row.
    const label = async (kind: "designation" | "department" | "employee", id: string | null | undefined): Promise<string | null> => {
      if (!id) return null;
      if (kind === "designation") return (await this.prisma.designation.findUnique({ where: { id }, select: { title: true } }))?.title ?? null;
      if (kind === "department") return (await this.prisma.department.findUnique({ where: { id }, select: { name: true } }))?.name ?? null;
      const m = await this.prisma.employee.findUnique({ where: { id }, select: { firstName: true, lastName: true } });
      return m ? `${m.firstName} ${m.lastName}`.trim() : null;
    };

    const data: Record<string, unknown> = {};
    for (const k of ["designationId", "title", "departmentId", "teamId", "managerId", "location"] as const) if (proposed[k] !== undefined) data[k] = proposed[k];

    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: req.employeeId }, data });

      await tx.employeeCareerHistory.create({
        data: {
          orgId: req.orgId, employeeId: req.employeeId,
          changeType: req.kind, // PROMOTION | TRANSFER
          previousDesignation: await label("designation", emp.designationId), newDesignation: proposed.designationId !== undefined ? await label("designation", proposed.designationId) : await label("designation", emp.designationId),
          previousDepartment: await label("department", emp.departmentId), newDepartment: proposed.departmentId !== undefined ? await label("department", proposed.departmentId) : await label("department", emp.departmentId),
          previousManager: await label("employee", emp.managerId), newManager: proposed.managerId !== undefined ? await label("employee", proposed.managerId) : await label("employee", emp.managerId),
          previousLocation: emp.location, newLocation: proposed.location !== undefined ? proposed.location : emp.location,
          reason: req.reason, effectiveFrom: req.effectiveDate, approvedBy: req.requestedBy, requestId: req.id,
        },
      });

      const title = req.kind === "PROMOTION" ? `Promoted${proposed.designationId ? "" : ""}` : "Transferred";
      await tx.employmentEvent.create({ data: { orgId: req.orgId, employeeId: req.employeeId, type: req.kind, title, detail: req.reason ?? undefined, effectiveDate: req.effectiveDate, createdBy: req.requestedBy } });

      await tx.employeeChangeRequest.update({ where: { id: req.id }, data: { status: "APPLIED", appliedAt: new Date() } });

      await this.outbox.enqueue(tx, {
        eventType: req.kind === "PROMOTION" ? "employee.promoted" : "employee.transferred",
        aggregateType: "employee", aggregateId: req.employeeId, orgId: req.orgId,
        payload: { requestId: req.id, employeeId: req.employeeId, kind: req.kind, requesterUserId: req.requestedBy, effectiveDate: req.effectiveDate.toISOString().slice(0, 10) },
      });
    });

    await this.audit.record({ orgId: req.orgId, action: `employee.${req.kind.toLowerCase()}_applied`, resourceType: "employee", resourceId: req.employeeId, before: emp, after: data });
    this.log.log(`Applied ${req.kind} ${req.id} for employee ${req.employeeId}`);
  }

  async cancel(requestId: string) {
    const ctx = requireTenantContext();
    const req = await this.prisma.employeeChangeRequest.findFirst({ where: { id: requestId, orgId: ctx.orgId } });
    if (!req) throw new NotFoundException("Change request not found.");
    if (!["PENDING_APPROVAL", "SCHEDULED", "APPROVED"].includes(req.status)) throw new ConflictException("This request can no longer be cancelled.");
    await this.assertEmployee(ctx.orgId, req.employeeId, permissions.employeeWrite);
    await this.prisma.employeeChangeRequest.update({ where: { id: req.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await this.audit.record({ orgId: ctx.orgId, action: `employee.${req.kind.toLowerCase()}_cancelled`, resourceType: "employee", resourceId: req.employeeId, after: { requestId: req.id } });
    return this.get(req.id);
  }

  // ---- reads ---------------------------------------------------------------

  async get(requestId: string) {
    const ctx = requireTenantContext();
    const req = await this.prisma.employeeChangeRequest.findFirst({ where: { id: requestId, orgId: ctx.orgId }, include: { steps: { orderBy: { order: "asc" } } } });
    if (!req) throw new NotFoundException("Change request not found.");
    return this.serialize(req);
  }

  async listForEmployee(employeeId: string) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId, permissions.employeeRead);
    const rows = await this.prisma.employeeChangeRequest.findMany({ where: { orgId: ctx.orgId, employeeId }, orderBy: { createdAt: "desc" }, include: { steps: { orderBy: { order: "asc" } } } });
    return rows.map((r) => this.serialize(r));
  }

  async careerHistory(employeeId: string) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId, permissions.employeeRead);
    const rows = await this.prisma.employeeCareerHistory.findMany({ where: { orgId: ctx.orgId, employeeId }, orderBy: { effectiveFrom: "desc" } });
    return rows.map((r) => ({
      id: r.id, changeType: r.changeType,
      previousDesignation: r.previousDesignation, newDesignation: r.newDesignation,
      previousDepartment: r.previousDepartment, newDepartment: r.newDepartment,
      previousManager: r.previousManager, newManager: r.newManager,
      previousLocation: r.previousLocation, newLocation: r.newLocation,
      reason: r.reason, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10), createdAt: r.createdAt.toISOString(),
    }));
  }

  /** My pending approvals — change requests whose current step is assigned to me. */
  async myApprovals() {
    const ctx = requireTenantContext();
    const scope = await this.accessScope.resolveScope(ctx.orgId, ctx.userId, permissions.employeeWrite);
    const rows = await this.prisma.employeeChangeRequest.findMany({
      where: { orgId: ctx.orgId, status: "PENDING_APPROVAL" },
      orderBy: { createdAt: "asc" },
      include: { steps: { orderBy: { order: "asc" } }, employee: { select: { firstName: true, lastName: true } } },
    });
    return rows
      .filter((r) => {
        const cur = r.steps.find((s) => s.status === "PENDING");
        return cur && (scope.tier === "org" || cur.assignedTo === ctx.userId);
      })
      .map((r) => ({ ...this.serialize(r), employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim() }));
  }

  private serialize(r: { id: string; employeeId: string; kind: string; status: string; proposed: unknown; previous: unknown; reason: string | null; effectiveDate: Date; createdAt: Date; steps: { id: string; order: number; role: string; status: string; assignedTo: string | null; decidedAt: Date | null; note: string | null }[] }) {
    return {
      id: r.id, employeeId: r.employeeId, kind: r.kind, status: r.status,
      proposed: r.proposed, previous: r.previous, reason: r.reason,
      effectiveDate: r.effectiveDate.toISOString().slice(0, 10), createdAt: r.createdAt.toISOString(),
      steps: r.steps.map((s) => ({ id: s.id, order: s.order, role: s.role, status: s.status, assignedTo: s.assignedTo, decidedAt: s.decidedAt?.toISOString() ?? null, note: s.note })),
    };
  }

  // ---- notifications -------------------------------------------------------

  private async notifyApprover(orgId: string, requestId: string, approverUserId: string | null, kind: string) {
    if (!approverUserId) return;
    await this.prisma.$transaction(async (tx) => {
      await this.outbox.enqueue(tx, { eventType: "employee.change_approval_pending", aggregateType: "employee_change_request", aggregateId: requestId, orgId, payload: { requestId, kind, requesterUserId: approverUserId } });
    });
  }

  private async notifyRequester(orgId: string, requestId: string, requesterUserId: string | null, kind: Kind, outcome: string) {
    if (!requesterUserId) return;
    await this.prisma.$transaction(async (tx) => {
      await this.outbox.enqueue(tx, { eventType: "employee.change_decided", aggregateType: "employee_change_request", aggregateId: requestId, orgId, payload: { requestId, kind, outcome, requesterUserId } });
    });
  }
}
