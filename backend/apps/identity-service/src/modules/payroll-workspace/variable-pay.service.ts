import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, VariablePayStatus } from "@retainiq/database/identity";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";

/**
 * Variable pay — bonuses, incentives, reimbursements (§13).
 *
 * All three share one approval chain (VariablePayStatus):
 *   DRAFT → MANAGER_APPROVAL → REVIEW → APPROVED → INCLUDED_IN_PAYROLL
 * with REJECTED / CANCELLED as terminal off-ramps. `approve()` advances the chain
 * by exactly one step.
 *
 * Two invariants the workspace depends on:
 *  - Separation of duties (§15/§38.9): the person who raised a request may submit
 *    their own draft, but may NOT perform any approval step on it. Enforced with an
 *    actor != requestedBy check on every non-DRAFT transition.
 *  - No double-include (§13/§38.8): a row is "consumed" once it carries a batchId.
 *    The final APPROVED → INCLUDED_IN_PAYROLL step is the only writer of batchId and
 *    refuses to run if one is already set.
 *
 * Money is Decimal end-to-end; JSON responses convert to Number at the edge only.
 * Every row is tenant-scoped: reads are filtered to the caller's ABAC reach, and no
 * orgId is ever read from the request body.
 */
@Injectable()
export class VariablePayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly accessScope: AccessScopeService,
  ) {}

  // ---- workflow helpers ----

  private static readonly NEXT: Record<VariablePayStatus, VariablePayStatus | null> = {
    [VariablePayStatus.DRAFT]: VariablePayStatus.MANAGER_APPROVAL,
    [VariablePayStatus.MANAGER_APPROVAL]: VariablePayStatus.REVIEW,
    [VariablePayStatus.REVIEW]: VariablePayStatus.APPROVED,
    [VariablePayStatus.APPROVED]: VariablePayStatus.INCLUDED_IN_PAYROLL,
    [VariablePayStatus.INCLUDED_IN_PAYROLL]: null,
    [VariablePayStatus.REJECTED]: null,
    [VariablePayStatus.CANCELLED]: null,
  };

  /** The next state in the chain, or a 400 if the request is already terminal. */
  private nextStatus(current: VariablePayStatus): VariablePayStatus {
    const next = VariablePayService.NEXT[current];
    if (!next) throw new BadRequestException(`This request is ${current.toLowerCase()} and can no longer be advanced.`);
    return next;
  }

  /**
   * Separation of duties: submitting one's own draft (DRAFT → MANAGER_APPROVAL) is
   * allowed, but the requester can never perform an approval step on their own
   * request. Any later transition by the requester is refused.
   */
  private assertSeparationOfDuties(from: VariablePayStatus, requestedBy: string | null, actorId: string): void {
    if (from !== VariablePayStatus.DRAFT && requestedBy && requestedBy === actorId) {
      throw new ForbiddenException("You cannot approve a variable-pay request you raised — it must be approved by someone else.");
    }
  }

  /** Validate a target batch can still accept a consumed variable-pay item. */
  private async loadIncludableBatch(orgId: string, batchId: string | undefined) {
    if (!batchId) throw new BadRequestException("A payroll batch id is required to include this item in payroll.");
    const batch = await this.prisma.payrollBatch.findFirst({
      where: { id: batchId, orgId },
      select: { id: true, status: true, periodId: true, currencyCode: true },
    });
    if (!batch) throw new NotFoundException("Payroll batch not found.");
    const closed: string[] = ["PAID", "CLOSED", "CANCELLED", "REJECTED"];
    if (closed.includes(batch.status)) {
      throw new BadRequestException("That payroll batch can no longer accept new items.");
    }
    return batch;
  }

  /** Resolve the caller's ABAC reach for reads; null = org-wide (no filter). */
  private async visibleFilter(orgId: string, userId: string, employeeId?: string): Promise<{ in: string[] } | string | undefined> {
    const scope = await this.accessScope.resolveScope(orgId, userId, "payroll.record.read");
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    if (visible === null) return employeeId ?? undefined; // org-wide
    const allowed = employeeId ? visible.filter((id) => id === employeeId) : visible;
    return { in: allowed };
  }

  private async assertEmployeeInOrg(orgId: string, employeeId: string): Promise<void> {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true } });
    if (!emp) throw new NotFoundException("Employee not found in this organization.");
  }

  // ===========================================================================
  // Bonuses
  // ===========================================================================

  async listBonuses(filter: { status?: VariablePayStatus; employeeId?: string }) {
    const ctx = requireTenantContext();
    const where: Prisma.PayrollBonusWhereInput = { orgId: ctx.orgId };
    const emp = await this.visibleFilter(ctx.orgId, ctx.userId, filter.employeeId);
    if (emp !== undefined) where.employeeId = emp;
    if (filter.status) where.status = filter.status;
    const rows = await this.prisma.payrollBonus.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map((r) => this.serializeBonus(r));
  }

  async createBonus(input: {
    employeeId: string;
    bonusType: string;
    amount: number;
    currencyCode?: string;
    reason?: string;
    sourceType?: string;
    sourceRef?: string;
    periodId?: string;
  }) {
    const ctx = requireTenantContext();
    await this.assertEmployeeInOrg(ctx.orgId, input.employeeId);
    const created = await this.prisma.payrollBonus.create({
      data: {
        orgId: ctx.orgId,
        employeeId: input.employeeId,
        bonusType: input.bonusType,
        amount: new Prisma.Decimal(input.amount),
        currencyCode: input.currencyCode ?? "USD",
        reason: input.reason?.trim() || null,
        sourceType: input.sourceType ?? null,
        sourceRef: input.sourceRef ?? null,
        periodId: input.periodId ?? null,
        status: VariablePayStatus.DRAFT,
        requestedBy: ctx.userId,
      },
    });
    await this.audit.record({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      resourceType: "payroll_bonus",
      resourceId: created.id,
      action: "payroll.bonus.created",
      after: { employeeId: created.employeeId, amount: Number(created.amount), status: created.status },
    });
    return this.serializeBonus(created);
  }

  async approveBonus(id: string, opts: { batchId?: string; note?: string }) {
    const ctx = requireTenantContext();
    const row = await this.prisma.payrollBonus.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!row) throw new NotFoundException("Bonus request not found.");
    const from = row.status;
    const to = this.nextStatus(from);
    this.assertSeparationOfDuties(from, row.requestedBy, ctx.userId);

    const data: Prisma.PayrollBonusUpdateInput = { status: to };
    if (to === VariablePayStatus.APPROVED) data.approvedBy = ctx.userId;
    if (to === VariablePayStatus.INCLUDED_IN_PAYROLL) {
      if (row.batchId) throw new BadRequestException("This bonus is already included in a payroll batch.");
      const batch = await this.loadIncludableBatch(ctx.orgId, opts.batchId);
      data.batchId = batch.id;
      if (!row.periodId) data.periodId = batch.periodId;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.payrollBonus.update({ where: { id }, data });
      await this.outbox.enqueue(tx, {
        eventType: to === VariablePayStatus.INCLUDED_IN_PAYROLL ? "payroll.variable_pay.included" : "payroll.variable_pay.advanced",
        aggregateType: "payroll_bonus",
        aggregateId: id,
        orgId: ctx.orgId,
        payload: { kind: "bonus", employeeId: row.employeeId, fromStatus: from, toStatus: to, amount: Number(row.amount), batchId: u.batchId },
      });
      return u;
    });
    await this.audit.record({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      resourceType: "payroll_bonus",
      resourceId: id,
      action: "payroll.bonus.advanced",
      before: { status: from },
      after: { status: to, batchId: updated.batchId },
      metadata: opts.note ? { note: opts.note } : undefined,
    });
    return this.serializeBonus(updated);
  }

  async rejectBonus(id: string, note?: string) {
    const ctx = requireTenantContext();
    const row = await this.prisma.payrollBonus.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!row) throw new NotFoundException("Bonus request not found.");
    this.assertTerminable(row.status);
    this.assertSeparationOfDuties(VariablePayStatus.MANAGER_APPROVAL, row.requestedBy, ctx.userId);
    const updated = await this.prisma.payrollBonus.update({ where: { id }, data: { status: VariablePayStatus.REJECTED } });
    await this.audit.record({ orgId: ctx.orgId, actorUserId: ctx.userId, resourceType: "payroll_bonus", resourceId: id, action: "payroll.bonus.rejected", before: { status: row.status }, metadata: note ? { note } : undefined });
    return this.serializeBonus(updated);
  }

  async cancelBonus(id: string) {
    const ctx = requireTenantContext();
    const row = await this.prisma.payrollBonus.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!row) throw new NotFoundException("Bonus request not found.");
    if (row.requestedBy && row.requestedBy !== ctx.userId) {
      throw new ForbiddenException("Only the person who raised this request can withdraw it.");
    }
    this.assertTerminable(row.status);
    const updated = await this.prisma.payrollBonus.update({ where: { id }, data: { status: VariablePayStatus.CANCELLED } });
    await this.audit.record({ orgId: ctx.orgId, actorUserId: ctx.userId, resourceType: "payroll_bonus", resourceId: id, action: "payroll.bonus.cancelled", before: { status: row.status } });
    return this.serializeBonus(updated);
  }

  // ===========================================================================
  // Incentives
  // ===========================================================================

  async listIncentives(filter: { status?: VariablePayStatus; employeeId?: string }) {
    const ctx = requireTenantContext();
    const where: Prisma.PayrollIncentiveWhereInput = { orgId: ctx.orgId };
    const emp = await this.visibleFilter(ctx.orgId, ctx.userId, filter.employeeId);
    if (emp !== undefined) where.employeeId = emp;
    if (filter.status) where.status = filter.status;
    const rows = await this.prisma.payrollIncentive.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map((r) => this.serializeIncentive(r));
  }

  async createIncentive(input: {
    employeeId: string;
    incentiveType: string;
    amount: number;
    currencyCode?: string;
    sourceType?: string;
    sourceRef?: string;
    periodId?: string;
  }) {
    const ctx = requireTenantContext();
    await this.assertEmployeeInOrg(ctx.orgId, input.employeeId);
    const created = await this.prisma.payrollIncentive.create({
      data: {
        orgId: ctx.orgId,
        employeeId: input.employeeId,
        incentiveType: input.incentiveType,
        amount: new Prisma.Decimal(input.amount),
        currencyCode: input.currencyCode ?? "USD",
        sourceType: input.sourceType ?? null,
        sourceRef: input.sourceRef ?? null,
        periodId: input.periodId ?? null,
        status: VariablePayStatus.DRAFT,
        requestedBy: ctx.userId,
      },
    });
    await this.audit.record({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      resourceType: "payroll_incentive",
      resourceId: created.id,
      action: "payroll.incentive.created",
      after: { employeeId: created.employeeId, amount: Number(created.amount), status: created.status },
    });
    return this.serializeIncentive(created);
  }

  async approveIncentive(id: string, opts: { batchId?: string; note?: string }) {
    const ctx = requireTenantContext();
    const row = await this.prisma.payrollIncentive.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!row) throw new NotFoundException("Incentive request not found.");
    const from = row.status;
    const to = this.nextStatus(from);
    this.assertSeparationOfDuties(from, row.requestedBy, ctx.userId);

    const data: Prisma.PayrollIncentiveUpdateInput = { status: to };
    if (to === VariablePayStatus.APPROVED) data.approvedBy = ctx.userId;
    if (to === VariablePayStatus.INCLUDED_IN_PAYROLL) {
      if (row.batchId) throw new BadRequestException("This incentive is already included in a payroll batch.");
      const batch = await this.loadIncludableBatch(ctx.orgId, opts.batchId);
      data.batchId = batch.id;
      if (!row.periodId) data.periodId = batch.periodId;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.payrollIncentive.update({ where: { id }, data });
      await this.outbox.enqueue(tx, {
        eventType: to === VariablePayStatus.INCLUDED_IN_PAYROLL ? "payroll.variable_pay.included" : "payroll.variable_pay.advanced",
        aggregateType: "payroll_incentive",
        aggregateId: id,
        orgId: ctx.orgId,
        payload: { kind: "incentive", employeeId: row.employeeId, fromStatus: from, toStatus: to, amount: Number(row.amount), batchId: u.batchId },
      });
      return u;
    });
    await this.audit.record({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      resourceType: "payroll_incentive",
      resourceId: id,
      action: "payroll.incentive.advanced",
      before: { status: from },
      after: { status: to, batchId: updated.batchId },
      metadata: opts.note ? { note: opts.note } : undefined,
    });
    return this.serializeIncentive(updated);
  }

  async rejectIncentive(id: string, note?: string) {
    const ctx = requireTenantContext();
    const row = await this.prisma.payrollIncentive.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!row) throw new NotFoundException("Incentive request not found.");
    this.assertTerminable(row.status);
    this.assertSeparationOfDuties(VariablePayStatus.MANAGER_APPROVAL, row.requestedBy, ctx.userId);
    const updated = await this.prisma.payrollIncentive.update({ where: { id }, data: { status: VariablePayStatus.REJECTED } });
    await this.audit.record({ orgId: ctx.orgId, actorUserId: ctx.userId, resourceType: "payroll_incentive", resourceId: id, action: "payroll.incentive.rejected", before: { status: row.status }, metadata: note ? { note } : undefined });
    return this.serializeIncentive(updated);
  }

  async cancelIncentive(id: string) {
    const ctx = requireTenantContext();
    const row = await this.prisma.payrollIncentive.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!row) throw new NotFoundException("Incentive request not found.");
    if (row.requestedBy && row.requestedBy !== ctx.userId) {
      throw new ForbiddenException("Only the person who raised this request can withdraw it.");
    }
    this.assertTerminable(row.status);
    const updated = await this.prisma.payrollIncentive.update({ where: { id }, data: { status: VariablePayStatus.CANCELLED } });
    await this.audit.record({ orgId: ctx.orgId, actorUserId: ctx.userId, resourceType: "payroll_incentive", resourceId: id, action: "payroll.incentive.cancelled", before: { status: row.status } });
    return this.serializeIncentive(updated);
  }

  // ===========================================================================
  // Reimbursements (two-tier approval: manager then finance; approvedAmount capped)
  // ===========================================================================

  async listReimbursements(filter: { status?: VariablePayStatus; employeeId?: string }) {
    const ctx = requireTenantContext();
    const where: Prisma.PayrollReimbursementWhereInput = { orgId: ctx.orgId };
    const emp = await this.visibleFilter(ctx.orgId, ctx.userId, filter.employeeId);
    if (emp !== undefined) where.employeeId = emp;
    if (filter.status) where.status = filter.status;
    const rows = await this.prisma.payrollReimbursement.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map((r) => this.serializeReimbursement(r));
  }

  async createReimbursement(input: {
    employeeId: string;
    category: string;
    claimedAmount: number;
    currencyCode?: string;
    taxable?: boolean;
    sourceType?: string;
    sourceRef?: string;
    receiptKey?: string;
    periodId?: string;
  }) {
    const ctx = requireTenantContext();
    await this.assertEmployeeInOrg(ctx.orgId, input.employeeId);
    const created = await this.prisma.payrollReimbursement.create({
      data: {
        orgId: ctx.orgId,
        employeeId: input.employeeId,
        category: input.category,
        claimedAmount: new Prisma.Decimal(input.claimedAmount),
        currencyCode: input.currencyCode ?? "USD",
        taxable: input.taxable ?? false,
        sourceType: input.sourceType ?? null,
        sourceRef: input.sourceRef ?? null,
        receiptKey: input.receiptKey ?? null,
        periodId: input.periodId ?? null,
        status: VariablePayStatus.DRAFT,
        requestedBy: ctx.userId,
      },
    });
    await this.audit.record({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      resourceType: "payroll_reimbursement",
      resourceId: created.id,
      action: "payroll.reimbursement.created",
      after: { employeeId: created.employeeId, claimedAmount: Number(created.claimedAmount), status: created.status },
    });
    return this.serializeReimbursement(created);
  }

  /**
   * Advance a reimbursement. The approved amount is capped at the claimed amount —
   * an approver may pay less than claimed but never more (§13). Manager and finance
   * approvers are stamped separately as the chain moves through REVIEW and APPROVED.
   */
  async approveReimbursement(id: string, opts: { batchId?: string; approvedAmount?: number; note?: string }) {
    const ctx = requireTenantContext();
    const row = await this.prisma.payrollReimbursement.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!row) throw new NotFoundException("Reimbursement claim not found.");
    const from = row.status;
    const to = this.nextStatus(from);
    this.assertSeparationOfDuties(from, row.requestedBy, ctx.userId);

    const data: Prisma.PayrollReimbursementUpdateInput = { status: to };

    // Cap the approved amount at the claimed amount. Once set it can be trimmed
    // further on later steps but never raised above the claim.
    let approved = opts.approvedAmount !== undefined ? new Prisma.Decimal(opts.approvedAmount) : (row.approvedAmount ?? row.claimedAmount);
    if (approved.greaterThan(row.claimedAmount)) approved = row.claimedAmount;
    if (approved.isNegative()) throw new BadRequestException("Approved amount cannot be negative.");
    data.approvedAmount = approved;

    if (to === VariablePayStatus.REVIEW) data.managerApprovedBy = ctx.userId;
    if (to === VariablePayStatus.APPROVED) data.financeApprovedBy = ctx.userId;
    if (to === VariablePayStatus.INCLUDED_IN_PAYROLL) {
      if (row.batchId) throw new BadRequestException("This reimbursement is already included in a payroll batch.");
      const batch = await this.loadIncludableBatch(ctx.orgId, opts.batchId);
      data.batchId = batch.id;
      if (!row.periodId) data.periodId = batch.periodId;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.payrollReimbursement.update({ where: { id }, data });
      await this.outbox.enqueue(tx, {
        eventType: to === VariablePayStatus.INCLUDED_IN_PAYROLL ? "payroll.variable_pay.included" : "payroll.variable_pay.advanced",
        aggregateType: "payroll_reimbursement",
        aggregateId: id,
        orgId: ctx.orgId,
        payload: { kind: "reimbursement", employeeId: row.employeeId, fromStatus: from, toStatus: to, approvedAmount: Number(approved), batchId: u.batchId },
      });
      return u;
    });
    await this.audit.record({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      resourceType: "payroll_reimbursement",
      resourceId: id,
      action: "payroll.reimbursement.advanced",
      before: { status: from, approvedAmount: row.approvedAmount ? Number(row.approvedAmount) : null },
      after: { status: to, approvedAmount: Number(approved), batchId: updated.batchId },
      metadata: opts.note ? { note: opts.note } : undefined,
    });
    return this.serializeReimbursement(updated);
  }

  async rejectReimbursement(id: string, note?: string) {
    const ctx = requireTenantContext();
    const row = await this.prisma.payrollReimbursement.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!row) throw new NotFoundException("Reimbursement claim not found.");
    this.assertTerminable(row.status);
    this.assertSeparationOfDuties(VariablePayStatus.MANAGER_APPROVAL, row.requestedBy, ctx.userId);
    const updated = await this.prisma.payrollReimbursement.update({ where: { id }, data: { status: VariablePayStatus.REJECTED } });
    await this.audit.record({ orgId: ctx.orgId, actorUserId: ctx.userId, resourceType: "payroll_reimbursement", resourceId: id, action: "payroll.reimbursement.rejected", before: { status: row.status }, metadata: note ? { note } : undefined });
    return this.serializeReimbursement(updated);
  }

  async cancelReimbursement(id: string) {
    const ctx = requireTenantContext();
    const row = await this.prisma.payrollReimbursement.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!row) throw new NotFoundException("Reimbursement claim not found.");
    if (row.requestedBy && row.requestedBy !== ctx.userId) {
      throw new ForbiddenException("Only the person who raised this claim can withdraw it.");
    }
    this.assertTerminable(row.status);
    const updated = await this.prisma.payrollReimbursement.update({ where: { id }, data: { status: VariablePayStatus.CANCELLED } });
    await this.audit.record({ orgId: ctx.orgId, actorUserId: ctx.userId, resourceType: "payroll_reimbursement", resourceId: id, action: "payroll.reimbursement.cancelled", before: { status: row.status } });
    return this.serializeReimbursement(updated);
  }

  // ---- shared guards & serialization ----

  private assertTerminable(status: VariablePayStatus): void {
    if (status === VariablePayStatus.INCLUDED_IN_PAYROLL || status === VariablePayStatus.REJECTED || status === VariablePayStatus.CANCELLED) {
      throw new BadRequestException(`This request is already ${status.toLowerCase()}.`);
    }
  }

  private serializeBonus(r: {
    id: string; employeeId: string; bonusType: string; amount: Prisma.Decimal; currencyCode: string;
    status: VariablePayStatus; sourceType: string | null; sourceRef: string | null; reason: string | null;
    periodId: string | null; batchId: string | null; requestedBy: string | null; approvedBy: string | null;
    createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: r.id,
      employeeId: r.employeeId,
      bonusType: r.bonusType,
      amount: Number(r.amount),
      currencyCode: r.currencyCode,
      status: r.status,
      sourceType: r.sourceType,
      sourceRef: r.sourceRef,
      reason: r.reason,
      periodId: r.periodId,
      batchId: r.batchId,
      requestedBy: r.requestedBy,
      approvedBy: r.approvedBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private serializeIncentive(r: {
    id: string; employeeId: string; incentiveType: string; amount: Prisma.Decimal; currencyCode: string;
    status: VariablePayStatus; sourceType: string | null; sourceRef: string | null;
    periodId: string | null; batchId: string | null; requestedBy: string | null; approvedBy: string | null;
    createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: r.id,
      employeeId: r.employeeId,
      incentiveType: r.incentiveType,
      amount: Number(r.amount),
      currencyCode: r.currencyCode,
      status: r.status,
      sourceType: r.sourceType,
      sourceRef: r.sourceRef,
      periodId: r.periodId,
      batchId: r.batchId,
      requestedBy: r.requestedBy,
      approvedBy: r.approvedBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private serializeReimbursement(r: {
    id: string; employeeId: string; category: string; claimedAmount: Prisma.Decimal; approvedAmount: Prisma.Decimal | null;
    currencyCode: string; taxable: boolean; status: VariablePayStatus; sourceType: string | null; sourceRef: string | null;
    receiptKey: string | null; periodId: string | null; batchId: string | null; requestedBy: string | null;
    managerApprovedBy: string | null; financeApprovedBy: string | null; createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: r.id,
      employeeId: r.employeeId,
      category: r.category,
      claimedAmount: Number(r.claimedAmount),
      approvedAmount: r.approvedAmount === null ? null : Number(r.approvedAmount),
      currencyCode: r.currencyCode,
      taxable: r.taxable,
      status: r.status,
      sourceType: r.sourceType,
      sourceRef: r.sourceRef,
      receiptKey: r.receiptKey,
      periodId: r.periodId,
      batchId: r.batchId,
      requestedBy: r.requestedBy,
      managerApprovedBy: r.managerApprovedBy,
      financeApprovedBy: r.financeApprovedBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
