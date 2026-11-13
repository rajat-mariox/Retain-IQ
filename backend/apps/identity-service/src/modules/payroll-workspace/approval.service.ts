import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";

/**
 * Default maker-checker chain for a payroll batch (§15). Config-driven: the roles
 * are data, so an org can override the sequence later without a code change. Each
 * entry becomes one PayrollApproval step that must APPROVE in order before the
 * batch reaches APPROVED.
 */
const DEFAULT_APPROVAL_CHAIN = ["PAYROLL_EXECUTIVE", "PAYROLL_MANAGER", "FINANCE", "OWNER"] as const;

// Batch states from which a calculated batch may enter the approval workflow.
const SUBMITTABLE = new Set(["CALCULATION", "VALIDATION", "REVIEW"]);

export interface ApproveInput {
  stepIndex?: number;
  comment?: string;
}
export interface HoldInput {
  reason: string;
  expectedResolution?: string;
}

/**
 * The payroll-batch approval engine (§15, §16). Builds a configurable maker-checker
 * chain of PayrollApproval steps, walks it one approver at a time, and only moves
 * the batch to APPROVED once every step approves. Separation of duties (§15/§38.9)
 * is enforced in code: whoever created the batch can never approve it. Any
 * recalculation after approval must call invalidateApprovals() to reset the chain,
 * so a changed batch can never keep stale sign-offs. Holds/releases are recorded as
 * PayrollHold rows. Tenant-isolated: every query filters on orgId (§38.21).
 */
@Injectable()
export class PayrollApprovalService {
  private readonly log = new Logger(PayrollApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** The approver-role chain for this org. Constant default today; sourced from
   *  org config once a payroll-settings store lands, without touching callers. */
  private chainFor(_orgId: string): readonly string[] {
    return DEFAULT_APPROVAL_CHAIN;
  }

  private async loadBatch(orgId: string, batchId: string) {
    const batch = await this.prisma.payrollBatch.findFirst({
      where: { id: batchId, orgId },
      select: { id: true, status: true, name: true, createdBy: true, approvedAt: true, currencyCode: true },
    });
    if (!batch) throw new NotFoundException("Payroll batch not found.");
    return batch;
  }

  // ---- submit: build the chain & open the workflow -------------------------

  /**
   * Move a calculated batch into PENDING_APPROVAL and (re)build its approval chain.
   * Rebuilding wipes any prior steps so a resubmitted batch starts clean. The
   * creator may submit — submitting is not a maker-checker approval.
   */
  async submitForApproval(batchId: string) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.loadBatch(orgId, batchId);
    if (!SUBMITTABLE.has(batch.status)) {
      throw new ConflictException(`A batch in ${batch.status} cannot be submitted for approval.`);
    }
    const recordCount = await this.prisma.payrollRecord.count({ where: { orgId, batchId } });
    if (recordCount === 0) throw new ConflictException("The batch has no calculated records to approve.");

    const roles = this.chainFor(orgId);
    await this.prisma.$transaction(async (tx) => {
      await tx.payrollApproval.deleteMany({ where: { orgId, batchId } });
      await tx.payrollApproval.createMany({
        data: roles.map((role, stepIndex) => ({ orgId, batchId, stepIndex, role })),
      });
      await tx.payrollBatch.update({ where: { id: batchId }, data: { status: "PENDING_APPROVAL" } });
      await tx.payrollRecord.updateMany({
        where: { orgId, batchId, status: { in: ["CALCULATED", "VALIDATED"] } },
        data: { status: "PENDING_APPROVAL" },
      });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.batch.submitted",
        aggregateType: "payroll_batch",
        aggregateId: batchId,
        orgId,
        payload: { batchId, steps: roles.length, submittedBy: userId },
      });
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "payroll.batch.submitted",
      resourceType: "payroll_batch",
      resourceId: batchId,
      after: { steps: roles },
    });
    return this.getApprovalChain(batchId);
  }

  // ---- approve one step ----------------------------------------------------

  async approve(batchId: string, input: ApproveInput = {}) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.loadBatch(orgId, batchId);
    if (batch.status === "ON_HOLD") throw new ConflictException("The batch is on hold — release it before approving.");
    if (batch.status !== "PENDING_APPROVAL") throw new ConflictException("This batch is not awaiting approval.");
    // Separation of duties (§15/§38.9): the maker can never be the checker.
    if (batch.createdBy && batch.createdBy === userId) {
      throw new ForbiddenException("The person who created a batch cannot approve it.");
    }

    const steps = await this.prisma.payrollApproval.findMany({ where: { orgId, batchId }, orderBy: { stepIndex: "asc" } });
    const current = steps.find((s) => s.status === "PENDING");
    if (!current) throw new ConflictException("There is no pending approval step on this batch.");
    if (input.stepIndex !== undefined && input.stepIndex !== current.stepIndex) {
      throw new ConflictException("This approval step has already been decided; refresh and try again.");
    }
    const isFinal = !steps.some((s) => s.stepIndex > current.stepIndex && s.status === "PENDING");

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollApproval.update({
        where: { id: current.id },
        data: { status: "APPROVED", decidedBy: userId, decidedAt: new Date(), comment: input.comment ?? null },
      });
      if (isFinal) {
        await tx.payrollBatch.update({ where: { id: batchId }, data: { status: "APPROVED", approvedAt: new Date() } });
        await tx.payrollRecord.updateMany({
          where: { orgId, batchId, status: { in: ["CALCULATED", "VALIDATED", "PENDING_APPROVAL"] } },
          data: { status: "APPROVED" },
        });
        await this.outbox.enqueue(tx, {
          eventType: "payroll.batch.approved",
          aggregateType: "payroll_batch",
          aggregateId: batchId,
          orgId,
          payload: { batchId, approvedBy: userId, finalStep: current.stepIndex },
        });
      } else {
        await this.outbox.enqueue(tx, {
          eventType: "payroll.batch.step_approved",
          aggregateType: "payroll_batch",
          aggregateId: batchId,
          orgId,
          payload: { batchId, stepIndex: current.stepIndex, role: current.role, approvedBy: userId },
        });
      }
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: isFinal ? "payroll.batch.approved" : "payroll.batch.step_approved",
      resourceType: "payroll_batch",
      resourceId: batchId,
      after: { stepIndex: current.stepIndex, role: current.role, final: isFinal },
      metadata: input.comment ? { reason: input.comment } : undefined,
    });
    if (isFinal) this.log.log(`Batch ${batchId} fully approved by ${userId}`);
    return this.getApprovalChain(batchId);
  }

  // ---- reject --------------------------------------------------------------

  async reject(batchId: string, input: { comment?: string } = {}) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.loadBatch(orgId, batchId);
    if (batch.status !== "PENDING_APPROVAL") throw new ConflictException("This batch is not awaiting approval.");
    const steps = await this.prisma.payrollApproval.findMany({ where: { orgId, batchId }, orderBy: { stepIndex: "asc" } });
    const current = steps.find((s) => s.status === "PENDING");
    if (!current) throw new ConflictException("There is no pending approval step on this batch.");

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollApproval.update({
        where: { id: current.id },
        data: { status: "REJECTED", decidedBy: userId, decidedAt: new Date(), comment: input.comment ?? null },
      });
      await tx.payrollBatch.update({ where: { id: batchId }, data: { status: "REJECTED" } });
      await tx.payrollRecord.updateMany({
        where: { orgId, batchId, status: { in: ["CALCULATED", "VALIDATED", "PENDING_APPROVAL"] } },
        data: { status: "REJECTED" },
      });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.batch.rejected",
        aggregateType: "payroll_batch",
        aggregateId: batchId,
        orgId,
        payload: { batchId, rejectedBy: userId, stepIndex: current.stepIndex, role: current.role },
      });
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "payroll.batch.rejected",
      resourceType: "payroll_batch",
      resourceId: batchId,
      after: { stepIndex: current.stepIndex, role: current.role },
      metadata: input.comment ? { reason: input.comment } : undefined,
    });
    return this.getApprovalChain(batchId);
  }

  // ---- hold / release ------------------------------------------------------

  async hold(batchId: string, input: HoldInput) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.loadBatch(orgId, batchId);
    if (["PAID", "CLOSED", "CANCELLED"].includes(batch.status)) {
      throw new ConflictException(`A ${batch.status} batch cannot be put on hold.`);
    }
    const reason = input.reason.trim();
    if (!reason) throw new ConflictException("A hold requires a reason.");

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollHold.create({
        data: {
          orgId,
          batchId,
          reason,
          expectedResolution: input.expectedResolution?.trim() || null,
          heldBy: userId,
          active: true,
        },
      });
      await tx.payrollBatch.update({ where: { id: batchId }, data: { status: "ON_HOLD" } });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.batch.held",
        aggregateType: "payroll_batch",
        aggregateId: batchId,
        orgId,
        payload: { batchId, heldBy: userId, reason },
      });
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "payroll.batch.held",
      resourceType: "payroll_batch",
      resourceId: batchId,
      after: { previousStatus: batch.status },
      metadata: { reason },
    });
    return this.getApprovalChain(batchId);
  }

  async release(batchId: string, input: { comment?: string } = {}) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.loadBatch(orgId, batchId);
    const active = await this.prisma.payrollHold.findMany({ where: { orgId, batchId, active: true } });
    if (active.length === 0) throw new ConflictException("There is no active hold on this batch.");

    const restored = await this.statusFromChain(orgId, batchId);
    await this.prisma.$transaction(async (tx) => {
      await tx.payrollHold.updateMany({
        where: { orgId, batchId, active: true },
        data: { active: false, releasedBy: userId, releasedAt: new Date() },
      });
      await tx.payrollBatch.update({ where: { id: batchId }, data: { status: restored } });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.batch.released",
        aggregateType: "payroll_batch",
        aggregateId: batchId,
        orgId,
        payload: { batchId, releasedBy: userId, restoredStatus: restored, holds: active.length },
      });
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "payroll.batch.released",
      resourceType: "payroll_batch",
      resourceId: batchId,
      after: { restoredStatus: restored },
      metadata: input.comment ? { reason: input.comment } : undefined,
    });
    return this.getApprovalChain(batchId);
  }

  // ---- recalculation invalidates approvals (§15) ---------------------------

  /**
   * Reset the approval chain after a batch is recalculated. Every decided step
   * returns to PENDING and the batch drops back to PENDING_APPROVAL, so stale
   * sign-offs can never carry over onto changed numbers. Intended to be called by
   * the calculation flow whenever an already-submitted/approved batch is recomputed.
   */
  async invalidateApprovals(batchId: string, reason = "batch recalculated") {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.loadBatch(orgId, batchId);
    if (["PAID", "CLOSED", "CANCELLED"].includes(batch.status)) {
      throw new ConflictException(`Approvals for a ${batch.status} batch can no longer be invalidated.`);
    }
    const steps = await this.prisma.payrollApproval.count({ where: { orgId, batchId } });
    if (steps === 0) return this.getApprovalChain(batchId); // nothing submitted yet

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollApproval.updateMany({
        where: { orgId, batchId },
        data: { status: "PENDING", decidedBy: null, decidedAt: null, comment: null },
      });
      if (["APPROVED", "PENDING_APPROVAL", "ON_HOLD"].includes(batch.status)) {
        await tx.payrollBatch.update({ where: { id: batchId }, data: { status: "PENDING_APPROVAL", approvedAt: null } });
      }
      await this.outbox.enqueue(tx, {
        eventType: "payroll.batch.approvals_reset",
        aggregateType: "payroll_batch",
        aggregateId: batchId,
        orgId,
        payload: { batchId, reason, resetBy: userId },
      });
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "payroll.batch.approvals_reset",
      resourceType: "payroll_batch",
      resourceId: batchId,
      metadata: { reason },
    });
    return this.getApprovalChain(batchId);
  }

  // ---- read ----------------------------------------------------------------

  async getApprovalChain(batchId: string) {
    const { orgId } = requireTenantContext();
    const batch = await this.loadBatch(orgId, batchId);
    const [steps, holds] = await Promise.all([
      this.prisma.payrollApproval.findMany({ where: { orgId, batchId }, orderBy: { stepIndex: "asc" } }),
      this.prisma.payrollHold.findMany({ where: { orgId, batchId }, orderBy: { createdAt: "desc" } }),
    ]);
    const current = steps.find((s) => s.status === "PENDING") ?? null;
    return {
      batchId: batch.id,
      name: batch.name,
      status: batch.status,
      createdBy: batch.createdBy,
      approvedAt: batch.approvedAt?.toISOString() ?? null,
      currentStepIndex: current?.stepIndex ?? null,
      steps: steps.map((s) => ({
        stepIndex: s.stepIndex,
        role: s.role,
        status: s.status,
        decidedBy: s.decidedBy,
        decidedAt: s.decidedAt?.toISOString() ?? null,
        comment: s.comment,
      })),
      holds: holds.map((h) => ({
        id: h.id,
        reason: h.reason,
        expectedResolution: h.expectedResolution,
        heldBy: h.heldBy,
        releasedBy: h.releasedBy,
        releasedAt: h.releasedAt?.toISOString() ?? null,
        active: h.active,
        createdAt: h.createdAt.toISOString(),
      })),
    };
  }

  /** Resolve the status a batch should carry when a hold is released: APPROVED if
   *  the whole chain is signed off, else back to PENDING_APPROVAL (REVIEW if no
   *  chain was ever built). */
  private async statusFromChain(orgId: string, batchId: string): Promise<"APPROVED" | "PENDING_APPROVAL" | "REVIEW"> {
    const steps = await this.prisma.payrollApproval.findMany({ where: { orgId, batchId }, select: { status: true } });
    if (steps.length === 0) return "REVIEW";
    return steps.every((s) => s.status === "APPROVED") ? "APPROVED" : "PENDING_APPROVAL";
  }
}
