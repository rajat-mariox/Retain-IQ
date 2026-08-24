import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { OrgRolesService } from "../../common/org-roles/org-roles.service.js";
import { PayrollInputService } from "./input-snapshot.service.js";
import { PayrollCalcService, type BatchCalcContext } from "./calc.service.js";

/** The full batch lifecycle (§9). */
export type BatchStatus =
  | "DRAFT"
  | "INPUT_COLLECTION"
  | "CALCULATION"
  | "VALIDATION"
  | "REVIEW"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "PAYMENT_PROCESSING"
  | "PAID"
  | "CLOSED"
  | "REJECTED"
  | "ON_HOLD"
  | "CANCELLED";

export interface CreateBatchInput {
  periodId: string;
  name: string;
  currencyCode?: string;
  countryCode?: string | null;
  legalEntityId?: string | null;
  payrollEntityId?: string | null;
  note?: string | null;
}

const NIL = "00000000-0000-0000-0000-000000000000";

/**
 * Owns the payroll batch lifecycle (§9): DRAFT → INPUT_COLLECTION → CALCULATION →
 * VALIDATION → REVIEW → PENDING_APPROVAL → APPROVED → PAYMENT_PROCESSING → PAID →
 * CLOSED (with REJECTED / ON_HOLD / CANCELLED off-ramps). A batch is scoped to one
 * org, one period, and a single country/currency/entity — mixing incompatible
 * country, currency or legal entity is refused (§9/§38). Each transition is
 * audited; domain events (payroll.batch.calculated / .submitted / .approved /
 * .closed) are emitted through the transactional outbox. Separation of duties
 * (§15/§38.9): the person who created a batch cannot approve it.
 *
 * Tenant-isolated: every query filters by the caller's orgId, never an id from the body.
 */
@Injectable()
export class PayrollBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly orgRoles: OrgRolesService,
    private readonly input: PayrollInputService,
    private readonly calc: PayrollCalcService,
  ) {}

  // ---- Reads ----

  async list(opts?: { status?: string; periodId?: string }) {
    const { orgId } = requireTenantContext();
    const rows = await this.prisma.payrollBatch.findMany({
      where: {
        orgId,
        ...(opts?.status ? { status: opts.status as never } : {}),
        ...(opts?.periodId ? { periodId: opts.periodId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { period: { select: { periodStart: true, periodEnd: true } } },
    });
    return rows.map((b) => this.serializeBatch(b));
  }

  async get(id: string) {
    const { orgId } = requireTenantContext();
    const batch = await this.prisma.payrollBatch.findFirst({
      where: { orgId, id },
      include: {
        period: { select: { periodStart: true, periodEnd: true, status: true } },
        members: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!batch) throw new NotFoundException("Payroll batch not found.");
    return {
      ...this.serializeBatch(batch),
      members: batch.members.map((m) => ({
        employeeId: m.employeeId,
        included: m.included,
        excludeReason: m.excludeReason,
      })),
    };
  }

  /** Records for a batch, scoped to the caller's employee reach (a manager sees only their people; an employee sees their own). */
  async getRecords(id: string) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.prisma.payrollBatch.findFirst({ where: { orgId, id }, select: { id: true } });
    if (!batch) throw new NotFoundException("Payroll batch not found.");

    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollRecordRead);
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);

    const records = await this.prisma.payrollRecord.findMany({
      where: { orgId, batchId: batch.id, ...(visible === null ? {} : { employeeId: { in: visible.length > 0 ? visible : [NIL] } }) },
      orderBy: { createdAt: "asc" },
    });
    return records.map((r) => this.serializeRecord(r));
  }

  /** One payroll record with its explainable component breakdown, scoped to the caller's reach. */
  async getRecord(recordId: string) {
    const { orgId, userId } = requireTenantContext();
    const record = await this.prisma.payrollRecord.findFirst({
      where: { orgId, id: recordId },
      include: { components: { orderBy: { sortOrder: "asc" } } },
    });
    if (!record) throw new NotFoundException("Payroll record not found.");

    // A record exposes salary, so a scoped caller may only read one for an employee
    // within their reach (an employee sees their own).
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollRecordRead);
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    if (visible !== null && !visible.includes(record.employeeId)) {
      throw new ForbiddenException("You cannot view this payroll record.");
    }

    return {
      ...this.serializeRecord(record),
      components: record.components.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        direction: c.direction,
        category: c.category,
        amount: Number(c.amount),
        taxable: c.taxable,
        statutory: c.statutory,
        employerPaid: c.employerPaid,
        payslipVisible: c.payslipVisible,
        calcType: c.calcType,
        formula: c.formula,
        inputs: c.inputs,
        componentVersionId: c.componentVersionId,
        sortOrder: c.sortOrder,
      })),
    };
  }

  // ---- Create + membership ----

  async create(input: CreateBatchInput) {
    const { orgId, userId } = requireTenantContext();
    const period = await this.prisma.payrollPeriod.findFirst({
      where: { orgId, id: input.periodId },
      include: { calendar: { select: { currencyCode: true, countryCode: true, legalEntityId: true } } },
    });
    if (!period) throw new NotFoundException("Pay period not found.");
    if (period.status === "CLOSED") throw new BadRequestException("This pay period is closed; reopen it before creating a batch.");

    // The batch runs in exactly one currency/country/entity. Default from the
    // calendar; if the caller supplies a currency it must match (no mixing, §9).
    const currencyCode = (input.currencyCode ?? period.calendar.currencyCode).trim().toUpperCase();
    if (input.currencyCode && currencyCode !== period.calendar.currencyCode.toUpperCase()) {
      throw new BadRequestException(`Batch currency ${currencyCode} does not match the calendar currency ${period.calendar.currencyCode}.`);
    }
    const countryCode = (input.countryCode ?? period.calendar.countryCode) || null;
    const legalEntityId = input.legalEntityId ?? period.calendar.legalEntityId ?? null;

    const created = await this.prisma.payrollBatch.create({
      data: {
        orgId,
        periodId: period.id,
        legalEntityId,
        payrollEntityId: input.payrollEntityId ?? null,
        countryCode,
        currencyCode,
        name: input.name.trim(),
        status: "DRAFT",
        createdBy: userId,
        note: input.note?.trim() || null,
      },
      include: { period: { select: { periodStart: true, periodEnd: true } } },
    });
    await this.audit.record({
      orgId, actorUserId: userId, resourceType: "PayrollBatch", resourceId: created.id,
      action: "payroll.batch.create", after: { name: created.name, periodId: created.periodId, currencyCode, countryCode },
    });
    return this.serializeBatch(created);
  }

  /**
   * Add employees to a batch. Only employees within the caller's reach (ABAC) can
   * be added, and each employee's current pay profile must share the batch's
   * currency and legal entity — mixing incompatible profiles is refused (§9). An
   * employee with no profile is allowed in and flagged at validation.
   */
  async addEmployees(id: string, employeeIds: string[]) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.loadForMutation(orgId, id, ["DRAFT", "INPUT_COLLECTION"]);

    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollBatchCreate);
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    const employees = await this.prisma.employee.findMany({ where: { orgId, id: { in: employeeIds } }, select: { id: true } });
    const inOrg = new Set(employees.map((e) => e.id));
    const visibleSet = visible === null ? null : new Set(visible);
    // Reachable = exists in this org AND within the caller's ABAC reach (org tier = null = all).
    const unreachable = employeeIds.filter((e) => !inOrg.has(e) || (visibleSet !== null && !visibleSet.has(e)));
    if (unreachable.length > 0) throw new ForbiddenException(`Some employees are outside your reach: ${unreachable.join(", ")}`);

    // The Owner is not payroll staff ([[Owner role principle]]) — refuse to add
    // them to a run even if their employee id is passed directly.
    const ownerIds = await this.orgRoles.ownerEmployeeIds(orgId);
    const owners = employeeIds.filter((e) => ownerIds.includes(e));
    if (owners.length > 0) throw new BadRequestException("The Owner is not payroll staff and cannot be added to a payroll batch.");

    // Currency / legal-entity compatibility against each employee's current profile.
    const today = new Date();
    const incompatible: string[] = [];
    for (const empId of employeeIds) {
      const profile = await this.prisma.payrollProfile.findUnique({ where: { orgId_employeeId: { orgId, employeeId: empId } }, select: { id: true } });
      if (!profile) continue; // no profile → allowed, flagged at validate
      const version = await this.prisma.payrollProfileVersion.findFirst({
        where: { orgId, profileId: profile.id, effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
        orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
        select: { currencyCode: true, legalEntityId: true },
      });
      if (!version) continue;
      if (version.currencyCode.toUpperCase() !== batch.currencyCode.toUpperCase()) {
        incompatible.push(`${empId} (currency ${version.currencyCode})`);
      } else if (batch.legalEntityId && version.legalEntityId && version.legalEntityId !== batch.legalEntityId) {
        incompatible.push(`${empId} (different legal entity)`);
      }
    }
    if (incompatible.length > 0) {
      throw new BadRequestException(`Cannot mix incompatible pay profiles into this batch: ${incompatible.join("; ")}`);
    }

    let added = 0;
    for (const empId of employeeIds) {
      await this.prisma.payrollBatchEmployee.upsert({
        where: { batchId_employeeId: { batchId: batch.id, employeeId: empId } },
        create: { orgId, batchId: batch.id, employeeId: empId, included: true },
        update: { included: true, excludeReason: null },
      });
      added += 1;
    }
    await this.refreshMemberCount(batch.id);
    const status = batch.status === "DRAFT" ? "INPUT_COLLECTION" : (batch.status as BatchStatus);
    await this.prisma.payrollBatch.update({ where: { id: batch.id }, data: { status } });
    await this.audit.record({
      orgId, actorUserId: userId, resourceType: "PayrollBatch", resourceId: batch.id,
      action: "payroll.batch.add_employees", after: { employeeIds, added },
    });
    return this.get(batch.id);
  }

  /** Exclude an employee from the batch, recording why (§9). */
  async removeEmployee(id: string, employeeId: string, reason: string) {
    const { orgId, userId } = requireTenantContext();
    const trimmed = reason?.trim();
    if (!trimmed) throw new BadRequestException("A reason is required to remove an employee from a batch.");
    const batch = await this.loadForMutation(orgId, id, ["DRAFT", "INPUT_COLLECTION", "CALCULATION", "VALIDATION", "REVIEW"]);

    const member = await this.prisma.payrollBatchEmployee.findUnique({ where: { batchId_employeeId: { batchId: batch.id, employeeId } } });
    if (!member || member.orgId !== orgId) throw new NotFoundException("Employee is not a member of this batch.");

    await this.prisma.payrollBatchEmployee.update({ where: { batchId_employeeId: { batchId: batch.id, employeeId } }, data: { included: false, excludeReason: trimmed } });
    // Drop any record already computed for the excluded employee so totals stay honest.
    await this.prisma.payrollRecord.deleteMany({ where: { orgId, batchId: batch.id, employeeId } });
    await this.refreshMemberCount(batch.id);
    await this.audit.record({
      orgId, actorUserId: userId, resourceType: "PayrollBatch", resourceId: batch.id,
      action: "payroll.batch.remove_employee", after: { employeeId, reason: trimmed },
    });
    return this.get(batch.id);
  }

  // ---- Lifecycle actions ----

  /** Freeze approved inputs for every included member (§12), moving the batch into INPUT_COLLECTION. */
  async freeze(id: string) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.loadForMutation(orgId, id, ["DRAFT", "INPUT_COLLECTION"]);
    const result = await this.input.freezeForBatch(batch.id);
    await this.prisma.payrollBatch.update({ where: { id: batch.id }, data: { status: "INPUT_COLLECTION" } });
    await this.audit.record({
      orgId, actorUserId: userId, resourceType: "PayrollBatch", resourceId: batch.id,
      action: "payroll.batch.freeze", after: result,
    });
    return { ...(await this.get(batch.id)), freeze: result };
  }

  /**
   * Run the deterministic calculation for every included member (§26), aggregate the
   * batch totals, and emit payroll.batch.calculated. Requires inputs to be frozen.
   */
  async calculate(id: string) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.loadForMutation(orgId, id, ["INPUT_COLLECTION", "CALCULATION", "VALIDATION", "REVIEW"]);
    const ctx = await this.calcContext(orgId, batch.id);

    await this.prisma.payrollBatch.update({ where: { id: batch.id }, data: { status: "CALCULATION" } });

    const members = await this.prisma.payrollBatchEmployee.findMany({ where: { orgId, batchId: batch.id, included: true }, select: { employeeId: true } });
    let calculated = 0;
    let failed = 0;
    for (const m of members) {
      const res = await this.calc.calculateEmployee(orgId, ctx, m.employeeId);
      if (res.status === "VALIDATION_FAILED") failed += 1;
      else calculated += 1;
    }

    const totals = await this.aggregateTotals(orgId, batch.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.payrollBatch.update({
        where: { id: batch.id },
        data: {
          grossTotal: totals.grossTotal, deductionTotal: totals.deductionTotal, netTotal: totals.netTotal,
          employerCost: totals.employerCost, employeeCount: totals.employeeCount, calculatedAt: new Date(),
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.batch.calculated", aggregateType: "payroll_batch", aggregateId: batch.id, orgId, actorUserId: userId,
        payload: {
          batchId: batch.id, periodId: batch.periodId, currencyCode: batch.currencyCode,
          employeeCount: totals.employeeCount, calculated, failed,
          grossTotal: Number(totals.grossTotal), netTotal: Number(totals.netTotal),
        },
      });
    });

    await this.audit.record({
      orgId, actorUserId: userId, resourceType: "PayrollBatch", resourceId: batch.id,
      action: "payroll.batch.calculate", after: { calculated, failed, employeeCount: totals.employeeCount },
    });
    return { ...(await this.get(batch.id)), calculation: { calculated, failed } };
  }

  /**
   * Validate every record (§26): flag missing profiles (already failed at calc),
   * negative net, and zero gross. Clean records become VALIDATED and the batch moves
   * to REVIEW; if any record has a blocking error the batch stays in VALIDATION.
   */
  async validate(id: string) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.loadForMutation(orgId, id, ["CALCULATION", "VALIDATION", "REVIEW"]);

    const records = await this.prisma.payrollRecord.findMany({ where: { orgId, batchId: batch.id } });
    let failed = 0;
    for (const r of records) {
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!r.profileVersionId) errors.push("No payroll profile version resolved for this employee.");
      if (Number(r.netPayable) < 0) errors.push("Net payable is negative.");
      if (Number(r.grossEarnings) === 0 && r.status !== "VALIDATION_FAILED") warnings.push("Gross earnings are zero.");
      // Carry forward any error the calculation itself recorded.
      const existingErrors = Array.isArray(r.errors) ? (r.errors as unknown[]).map(String) : [];
      const allErrors = [...new Set([...existingErrors, ...errors])];
      const status = allErrors.length > 0 ? "VALIDATION_FAILED" : "VALIDATED";
      if (allErrors.length > 0) failed += 1;
      await this.prisma.payrollRecord.update({
        where: { id: r.id },
        data: { status, errors: allErrors as Prisma.InputJsonValue, warnings: warnings as Prisma.InputJsonValue },
      });
    }

    const status: BatchStatus = failed > 0 ? "VALIDATION" : "REVIEW";
    await this.prisma.payrollBatch.update({ where: { id: batch.id }, data: { status } });
    await this.audit.record({
      orgId, actorUserId: userId, resourceType: "PayrollBatch", resourceId: batch.id,
      action: "payroll.batch.validate", after: { failed, total: records.length, status },
    });
    return { ...(await this.get(batch.id)), validation: { failed, total: records.length } };
  }

  /** Submit the reviewed batch for approval (REVIEW → PENDING_APPROVAL). Opens the first approval step. */
  async submit(id: string) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.loadForMutation(orgId, id, ["REVIEW"]);

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollBatch.update({ where: { id: batch.id }, data: { status: "PENDING_APPROVAL" } });
      await tx.payrollApproval.upsert({
        where: { batchId_stepIndex: { batchId: batch.id, stepIndex: 0 } },
        create: { orgId, batchId: batch.id, stepIndex: 0, role: "PAYROLL_APPROVER", status: "PENDING" },
        update: { status: "PENDING", decidedBy: null, decidedAt: null },
      });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.batch.submitted", aggregateType: "payroll_batch", aggregateId: batch.id, orgId, actorUserId: userId,
        payload: { batchId: batch.id, periodId: batch.periodId, submittedBy: userId },
      });
    });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "PayrollBatch", resourceId: batch.id, action: "payroll.batch.submit" });
    return this.get(batch.id);
  }

  /**
   * Approve a submitted batch (PENDING_APPROVAL → APPROVED). Separation of duties
   * (§15/§38.9): the approver must not be the batch creator. Marks clean records
   * APPROVED and emits payroll.batch.approved.
   */
  async approve(id: string, comment?: string) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.loadForMutation(orgId, id, ["PENDING_APPROVAL"]);
    if (batch.createdBy && batch.createdBy === userId) {
      throw new ForbiddenException("Separation of duties: the batch creator cannot approve it.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollBatch.update({ where: { id: batch.id }, data: { status: "APPROVED", approvedAt: new Date() } });
      await tx.payrollRecord.updateMany({ where: { orgId, batchId: batch.id, status: "VALIDATED" }, data: { status: "APPROVED" } });
      await tx.payrollApproval.updateMany({ where: { orgId, batchId: batch.id, status: "PENDING" }, data: { status: "APPROVED", decidedBy: userId, decidedAt: new Date(), comment: comment?.trim() || null } });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.batch.approved", aggregateType: "payroll_batch", aggregateId: batch.id, orgId, actorUserId: userId,
        payload: { batchId: batch.id, periodId: batch.periodId, approvedBy: userId, netTotal: Number(batch.netTotal) },
      });
    });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "PayrollBatch", resourceId: batch.id, action: "payroll.batch.approve", after: { comment: comment?.trim() || null } });
    return this.get(batch.id);
  }

  /** Reject a submitted batch (PENDING_APPROVAL → REJECTED), recording the reason. */
  async reject(id: string, reason: string) {
    const { orgId, userId } = requireTenantContext();
    const trimmed = reason?.trim();
    if (!trimmed) throw new BadRequestException("A reason is required to reject a batch.");
    const batch = await this.loadForMutation(orgId, id, ["PENDING_APPROVAL"]);
    if (batch.createdBy && batch.createdBy === userId) {
      throw new ForbiddenException("Separation of duties: the batch creator cannot decide its approval.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.payrollBatch.update({ where: { id: batch.id }, data: { status: "REJECTED" } });
      await tx.payrollApproval.updateMany({ where: { orgId, batchId: batch.id, status: "PENDING" }, data: { status: "REJECTED", decidedBy: userId, decidedAt: new Date(), comment: trimmed } });
    });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "PayrollBatch", resourceId: batch.id, action: "payroll.batch.reject", after: { reason: trimmed } });
    return this.get(batch.id);
  }

  /** Close a batch once it has been paid (PAID → CLOSED, or APPROVED → CLOSED when no payout run is required). */
  async close(id: string) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.loadForMutation(orgId, id, ["APPROVED", "PAID"]);
    await this.prisma.$transaction(async (tx) => {
      await tx.payrollBatch.update({ where: { id: batch.id }, data: { status: "CLOSED", closedAt: new Date() } });
      await tx.payrollRecord.updateMany({ where: { orgId, batchId: batch.id, status: { in: ["APPROVED", "PAID"] } }, data: { status: "CLOSED" } });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.batch.closed", aggregateType: "payroll_batch", aggregateId: batch.id, orgId, actorUserId: userId,
        payload: { batchId: batch.id, periodId: batch.periodId, closedBy: userId },
      });
    });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "PayrollBatch", resourceId: batch.id, action: "payroll.batch.close" });
    return this.get(batch.id);
  }

  // ---- Internals ----

  /** Load a batch for a state-changing action, asserting it is in one of the allowed statuses. */
  private async loadForMutation(orgId: string, id: string, allowed: BatchStatus[]) {
    const batch = await this.prisma.payrollBatch.findFirst({ where: { orgId, id } });
    if (!batch) throw new NotFoundException("Payroll batch not found.");
    if (!allowed.includes(batch.status as BatchStatus)) {
      throw new ConflictException(`Batch is ${batch.status}; this action requires it to be one of: ${allowed.join(", ")}.`);
    }
    return batch;
  }

  /** Build the calculation context (period window + currency/country) for a batch. */
  private async calcContext(orgId: string, batchId: string): Promise<BatchCalcContext> {
    const batch = await this.prisma.payrollBatch.findFirst({
      where: { orgId, id: batchId },
      include: { period: { select: { periodStart: true, periodEnd: true } } },
    });
    if (!batch) throw new NotFoundException("Payroll batch not found.");
    return {
      id: batch.id, periodId: batch.periodId, currencyCode: batch.currencyCode, countryCode: batch.countryCode,
      periodStart: batch.period.periodStart, periodEnd: batch.period.periodEnd,
    };
  }

  private async refreshMemberCount(batchId: string) {
    const { orgId } = requireTenantContext();
    const count = await this.prisma.payrollBatchEmployee.count({ where: { orgId, batchId, included: true } });
    await this.prisma.payrollBatch.update({ where: { id: batchId }, data: { employeeCount: count } });
  }

  /** Sum the batch's record totals for the header figures. */
  private async aggregateTotals(orgId: string, batchId: string) {
    const records = await this.prisma.payrollRecord.findMany({
      where: { orgId, batchId },
      select: { grossEarnings: true, netPayable: true, employerCost: true, preTaxDeductions: true, employeeStatutory: true, taxDeduction: true, postTaxDeductions: true, status: true },
    });
    let grossTotal = new Prisma.Decimal(0);
    let netTotal = new Prisma.Decimal(0);
    let deductionTotal = new Prisma.Decimal(0);
    let employerCost = new Prisma.Decimal(0);
    let employeeCount = 0;
    for (const r of records) {
      if (r.status === "VALIDATION_FAILED") continue; // failed rows don't contribute money
      grossTotal = grossTotal.plus(r.grossEarnings);
      netTotal = netTotal.plus(r.netPayable);
      deductionTotal = deductionTotal.plus(r.preTaxDeductions).plus(r.employeeStatutory).plus(r.taxDeduction).plus(r.postTaxDeductions);
      employerCost = employerCost.plus(r.employerCost);
      employeeCount += 1;
    }
    return { grossTotal, netTotal, deductionTotal, employerCost, employeeCount };
  }

  // ---- Serializers ----

  private serializeBatch(b: {
    id: string;
    periodId: string;
    legalEntityId: string | null;
    payrollEntityId: string | null;
    countryCode: string | null;
    currencyCode: string;
    name: string;
    status: string;
    grossTotal: Prisma.Decimal;
    deductionTotal: Prisma.Decimal;
    netTotal: Prisma.Decimal;
    employerCost: Prisma.Decimal;
    employeeCount: number;
    calculatedAt: Date | null;
    approvedAt: Date | null;
    paidAt: Date | null;
    closedAt: Date | null;
    createdBy: string | null;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    period?: { periodStart: Date; periodEnd: Date } | null;
  }) {
    return {
      id: b.id,
      periodId: b.periodId,
      period: b.period ? { periodStart: b.period.periodStart.toISOString().slice(0, 10), periodEnd: b.period.periodEnd.toISOString().slice(0, 10) } : undefined,
      legalEntityId: b.legalEntityId,
      payrollEntityId: b.payrollEntityId,
      countryCode: b.countryCode,
      currencyCode: b.currencyCode,
      name: b.name,
      status: b.status,
      grossTotal: Number(b.grossTotal),
      deductionTotal: Number(b.deductionTotal),
      netTotal: Number(b.netTotal),
      employerCost: Number(b.employerCost),
      employeeCount: b.employeeCount,
      calculatedAt: b.calculatedAt ? b.calculatedAt.toISOString() : null,
      approvedAt: b.approvedAt ? b.approvedAt.toISOString() : null,
      paidAt: b.paidAt ? b.paidAt.toISOString() : null,
      closedAt: b.closedAt ? b.closedAt.toISOString() : null,
      createdBy: b.createdBy,
      note: b.note,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    };
  }

  private serializeRecord(r: {
    id: string;
    batchId: string;
    employeeId: string;
    periodId: string;
    currencyCode: string;
    profileVersionId: string | null;
    regularEarnings: Prisma.Decimal;
    variableEarnings: Prisma.Decimal;
    overtimeAmount: Prisma.Decimal;
    reimbursements: Prisma.Decimal;
    grossEarnings: Prisma.Decimal;
    preTaxDeductions: Prisma.Decimal;
    taxableIncome: Prisma.Decimal;
    taxDeduction: Prisma.Decimal;
    employeeStatutory: Prisma.Decimal;
    postTaxDeductions: Prisma.Decimal;
    adjustments: Prisma.Decimal;
    netPayable: Prisma.Decimal;
    employerContrib: Prisma.Decimal;
    employerCost: Prisma.Decimal;
    prorationFactor: Prisma.Decimal;
    status: string;
    warnings: Prisma.JsonValue;
    errors: Prisma.JsonValue;
    calcVersion: number;
    calculatedAt: Date | null;
    statementStatus: string;
  }) {
    return {
      id: r.id,
      batchId: r.batchId,
      employeeId: r.employeeId,
      periodId: r.periodId,
      currencyCode: r.currencyCode,
      profileVersionId: r.profileVersionId,
      regularEarnings: Number(r.regularEarnings),
      variableEarnings: Number(r.variableEarnings),
      overtimeAmount: Number(r.overtimeAmount),
      reimbursements: Number(r.reimbursements),
      grossEarnings: Number(r.grossEarnings),
      preTaxDeductions: Number(r.preTaxDeductions),
      taxableIncome: Number(r.taxableIncome),
      taxDeduction: Number(r.taxDeduction),
      employeeStatutory: Number(r.employeeStatutory),
      postTaxDeductions: Number(r.postTaxDeductions),
      adjustments: Number(r.adjustments),
      netPayable: Number(r.netPayable),
      employerContrib: Number(r.employerContrib),
      employerCost: Number(r.employerCost),
      prorationFactor: Number(r.prorationFactor),
      status: r.status,
      warnings: r.warnings,
      errors: r.errors,
      calcVersion: r.calcVersion,
      calculatedAt: r.calculatedAt ? r.calculatedAt.toISOString() : null,
      statementStatus: r.statementStatus,
    };
  }
}
