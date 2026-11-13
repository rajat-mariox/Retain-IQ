import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";

const NIL = "00000000-0000-0000-0000-000000000000";
const num = (x: Prisma.Decimal | number | null | undefined): number => (x == null ? 0 : Number(x));

export interface CreateAdjustmentInput {
  employeeId: string;
  originalRecordId?: string | null;
  componentCode?: string | null;
  adjustmentType: string; // POSITIVE | NEGATIVE | ARREAR | RECOVERY | TAX_CORRECTION | REVERSAL
  previousValue?: number | null;
  correctedValue?: number | null;
  difference?: number | null; // required when previous/corrected aren't both supplied
  currencyCode?: string;
  reason: string;
  evidenceKey?: string | null;
}

/**
 * Payroll Adjustments / corrections (§20). A locked payroll record (paid or
 * closed) is never mutated in place — instead a correction is raised that
 * references the original record + component, captures previous/corrected/
 * difference with a reason and optional evidence, and is settled through a future
 * batch. Workflow: CORRECTION_REQUESTED → REVIEWED → APPROVED → SETTLED. Approval
 * enforces separation of duties (the requester may not approve their own, §15).
 */
@Injectable()
export class AdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly accessScope: AccessScopeService,
  ) {}

  private async reach(orgId: string, userId: string): Promise<string[] | null> {
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollAdjustmentReview);
    if (scope.tier === "org") return null;
    const rows = await this.prisma.employee.findMany({ where: { orgId, ...this.accessScope.employeeWhere(scope) }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  private async loadInReach(id: string) {
    const { orgId, userId } = requireTenantContext();
    const a = await this.prisma.payrollAdjustment.findFirst({ where: { id, orgId } });
    if (!a) throw new NotFoundException("Adjustment not found.");
    const reach = await this.reach(orgId, userId);
    if (reach !== null && !reach.includes(a.employeeId)) throw new NotFoundException("Adjustment not found.");
    return a;
  }

  private async emit(tx: Prisma.TransactionClient, orgId: string, id: string, payload: Record<string, unknown>) {
    await this.outbox.enqueue(tx, { eventType: "payroll.adjustment.updated", aggregateType: "payroll_adjustment", aggregateId: id, orgId, payload });
  }

  private view(a: {
    id: string; employeeId: string; originalRecordId: string | null; componentCode: string | null; adjustmentType: string;
    previousValue: Prisma.Decimal | null; correctedValue: Prisma.Decimal | null; difference: Prisma.Decimal; currencyCode: string;
    reason: string; evidenceKey: string | null; status: string; settlementBatchId: string | null; createdBy: string | null;
    approvedBy: string | null; createdAt: Date; updatedAt: Date;
  }, employeeName?: string) {
    return {
      id: a.id,
      employeeId: a.employeeId,
      employeeName: employeeName ?? null,
      originalRecordId: a.originalRecordId,
      componentCode: a.componentCode,
      adjustmentType: a.adjustmentType,
      previousValue: a.previousValue == null ? null : num(a.previousValue),
      correctedValue: a.correctedValue == null ? null : num(a.correctedValue),
      difference: num(a.difference),
      currencyCode: a.currencyCode,
      reason: a.reason,
      evidenceKey: a.evidenceKey,
      status: a.status,
      settlementBatchId: a.settlementBatchId,
      createdBy: a.createdBy,
      approvedBy: a.approvedBy,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };
  }

  /** Raise a correction. Never mutates the original record — only records the delta. */
  async create(input: CreateAdjustmentInput) {
    const { orgId, userId } = requireTenantContext();

    const emp = await this.prisma.employee.findFirst({ where: { id: input.employeeId, orgId }, select: { id: true } });
    if (!emp) throw new NotFoundException("Employee not found.");

    let currencyCode = input.currencyCode ?? "USD";
    if (input.originalRecordId) {
      const rec = await this.prisma.payrollRecord.findFirst({ where: { id: input.originalRecordId, orgId, employeeId: input.employeeId }, select: { currencyCode: true } });
      if (!rec) throw new NotFoundException("Original payroll record not found for this employee.");
      currencyCode = input.currencyCode ?? rec.currencyCode;
    }

    // Difference: explicit, else corrected − previous. One of the two must be derivable.
    const hasPrev = input.previousValue != null;
    const hasCorr = input.correctedValue != null;
    let difference = input.difference;
    if (difference == null) {
      if (!hasPrev && !hasCorr) throw new BadRequestException("Provide a difference, or previous and corrected values.");
      difference = (input.correctedValue ?? 0) - (input.previousValue ?? 0);
    }
    if (!Number.isFinite(difference) || difference === 0) throw new BadRequestException("A correction must have a non-zero difference.");

    const created = await this.prisma.payrollAdjustment.create({
      data: {
        orgId,
        employeeId: input.employeeId,
        originalRecordId: input.originalRecordId ?? null,
        componentCode: input.componentCode ?? null,
        adjustmentType: input.adjustmentType,
        previousValue: hasPrev ? new Prisma.Decimal(input.previousValue as number) : null,
        correctedValue: hasCorr ? new Prisma.Decimal(input.correctedValue as number) : null,
        difference: new Prisma.Decimal(difference),
        currencyCode,
        reason: input.reason,
        evidenceKey: input.evidenceKey ?? null,
        status: "CORRECTION_REQUESTED",
        createdBy: userId,
      },
    });

    await this.audit.record({ orgId, actorUserId: userId, resourceType: "payroll_adjustment", resourceId: created.id, action: "payroll.adjustment.created", after: { employeeId: input.employeeId, adjustmentType: input.adjustmentType, difference } });
    await this.prisma.$transaction(async (tx) => this.emit(tx, orgId, created.id, { adjustmentId: created.id, employeeId: input.employeeId, status: "CORRECTION_REQUESTED", action: "created" }));
    return this.view(created);
  }

  async list(filters: { status?: string; employeeId?: string }) {
    const { orgId, userId } = requireTenantContext();
    const reach = await this.reach(orgId, userId);
    const where: Record<string, unknown> = { orgId };
    if (reach !== null) where.employeeId = { in: reach.length > 0 ? reach : [NIL] };
    if (filters.status) where.status = filters.status;
    if (filters.employeeId) where.employeeId = filters.employeeId;

    const rows = await this.prisma.payrollAdjustment.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 });
    const empIds = [...new Set(rows.map((r) => r.employeeId))];
    const emps = await this.prisma.employee.findMany({ where: { orgId, id: { in: empIds.length ? empIds : [NIL] } }, select: { id: true, firstName: true, lastName: true } });
    const byEmp = new Map(emps.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));

    const summary = {
      total: rows.length,
      pendingReview: rows.filter((r) => r.status === "CORRECTION_REQUESTED").length,
      pendingApproval: rows.filter((r) => r.status === "REVIEWED").length,
      approved: rows.filter((r) => r.status === "APPROVED").length,
      settled: rows.filter((r) => r.status === "SETTLED").length,
    };
    return { summary, items: rows.map((r) => this.view(r, byEmp.get(r.employeeId))) };
  }

  async get(id: string) {
    const a = await this.loadInReach(id);
    const emp = await this.prisma.employee.findFirst({ where: { id: a.employeeId, orgId: a.orgId }, select: { firstName: true, lastName: true } });
    return this.view(a, emp ? `${emp.firstName} ${emp.lastName}`.trim() : undefined);
  }

  /** CORRECTION_REQUESTED → REVIEWED (payrollAdjustmentReview). */
  async review(id: string, note?: string) {
    const { orgId, userId } = requireTenantContext();
    const a = await this.loadInReach(id);
    if (a.status !== "CORRECTION_REQUESTED") throw new BadRequestException("Only a requested correction can be reviewed.");
    const updated = await this.prisma.payrollAdjustment.update({ where: { id }, data: { status: "REVIEWED" } });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "payroll_adjustment", resourceId: id, action: "payroll.adjustment.reviewed", before: { status: a.status }, after: { status: "REVIEWED" }, metadata: note ? { note } : undefined });
    await this.prisma.$transaction(async (tx) => this.emit(tx, orgId, id, { adjustmentId: id, status: "REVIEWED", action: "reviewed" }));
    return this.view(updated);
  }

  /**
   * REVIEWED → APPROVED (payrollAdjustmentApprove). Separation of duties: the
   * requester (createdBy) can never approve their own correction (§15/§38.9).
   */
  async approve(id: string, note?: string) {
    const { orgId, userId } = requireTenantContext();
    const a = await this.loadInReach(id);
    if (a.status !== "REVIEWED") throw new BadRequestException("Only a reviewed correction can be approved.");
    if (a.createdBy && a.createdBy === userId) throw new ForbiddenException("You cannot approve a correction you requested (separation of duties).");
    const updated = await this.prisma.payrollAdjustment.update({ where: { id }, data: { status: "APPROVED", approvedBy: userId } });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "payroll_adjustment", resourceId: id, action: "payroll.adjustment.approved", before: { status: a.status }, after: { status: "APPROVED", approvedBy: userId }, metadata: note ? { note } : undefined });
    await this.prisma.$transaction(async (tx) => this.emit(tx, orgId, id, { adjustmentId: id, status: "APPROVED", approvedBy: userId, action: "approved" }));
    return this.view(updated);
  }

  async reject(id: string, note?: string) {
    const { orgId, userId } = requireTenantContext();
    const a = await this.loadInReach(id);
    if (a.status === "SETTLED" || a.status === "REJECTED") throw new BadRequestException("This correction is already closed.");
    const updated = await this.prisma.payrollAdjustment.update({ where: { id }, data: { status: "REJECTED" } });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "payroll_adjustment", resourceId: id, action: "payroll.adjustment.rejected", before: { status: a.status }, after: { status: "REJECTED" }, metadata: note ? { note } : undefined });
    await this.prisma.$transaction(async (tx) => this.emit(tx, orgId, id, { adjustmentId: id, status: "REJECTED", action: "rejected" }));
    return this.view(updated);
  }

  /** APPROVED → SETTLED, linking the batch that carries the correction. */
  async settle(id: string, settlementBatchId: string) {
    const { orgId, userId } = requireTenantContext();
    const a = await this.loadInReach(id);
    if (a.status !== "APPROVED") throw new BadRequestException("Only an approved correction can be settled.");
    const batch = await this.prisma.payrollBatch.findFirst({ where: { id: settlementBatchId, orgId }, select: { id: true } });
    if (!batch) throw new NotFoundException("Settlement batch not found.");
    const updated = await this.prisma.payrollAdjustment.update({ where: { id }, data: { status: "SETTLED", settlementBatchId } });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "payroll_adjustment", resourceId: id, action: "payroll.adjustment.settled", before: { status: a.status }, after: { status: "SETTLED", settlementBatchId } });
    await this.prisma.$transaction(async (tx) => this.emit(tx, orgId, id, { adjustmentId: id, status: "SETTLED", settlementBatchId, action: "settled" }));
    return this.view(updated);
  }
}
