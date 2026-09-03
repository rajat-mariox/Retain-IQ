import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type PayrollRecordStatus } from "@retainiq/database/identity";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { StatementService } from "./statement.service.js";

const PAYMENT_METHODS = ["BANK_TRANSFER", "UPI", "CHEQUE", "CASH", "PROVIDER"] as const;
const PROOF_KINDS = ["RECEIPT", "BANK_RESPONSE", "ATTACHMENT"] as const;
// A record can accept a payment only from one of these states.
const PAYABLE_RECORD = new Set(["APPROVED", "PAYMENT_PROCESSING", "PAYMENT_FAILED"]);
// Record states that need no further payout — a batch is fully PAID once none remain.
const SETTLED_RECORD: PayrollRecordStatus[] = ["PAID", "CANCELLED", "REJECTED"];

export interface MarkPaidInput {
  paymentDate?: string;
  amount?: number | string;
  method: (typeof PAYMENT_METHODS)[number];
  reference?: string;
}
export interface ProofInput {
  kind: (typeof PROOF_KINDS)[number];
  storageKey: string;
  checksum?: string;
}

/** Keep only the last 4 characters of a bank/UTR reference in any read model (§17,
 *  §28). Full references live only in the row; they are never returned in a list. */
function maskReference(ref: string | null): string | null {
  if (!ref) return ref;
  const s = ref.trim();
  if (s.length <= 4) return "••••";
  return `••••${s.slice(-4)}`;
}

/**
 * Payout execution for an APPROVED payroll batch (§16, §17). One PayrollPayment per
 * record, keyed by an idempotency key (batchId:employeeId, unique) so the same
 * employee can never be paid twice for one batch (§38.8/§23). markPaid records the
 * settlement plus a PayrollPaymentAttempt; a FAILED payment can be retried; proof
 * documents attach as PayrollPaymentProof. When every record is settled the batch
 * flips to PAID. Reads are scoped by AccessScopeService and bank references are
 * masked. Tenant-isolated on orgId (§38.21).
 */
@Injectable()
export class PaymentService {
  private readonly log = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly statements: StatementService,
  ) {}

  private idempotencyKey(batchId: string, employeeId: string): string {
    return `${batchId}:${employeeId}`;
  }

  // ---- process: open a payment per approved record -------------------------

  /**
   * Create one PENDING PayrollPayment per approved record in a batch and move the
   * batch to PAYMENT_PROCESSING. Idempotent: createMany skipDuplicates leans on the
   * unique idempotencyKey, so re-running never double-pays.
   */
  async processBatch(batchId: string) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.prisma.payrollBatch.findFirst({
      where: { id: batchId, orgId },
      select: { id: true, status: true, currencyCode: true },
    });
    if (!batch) throw new NotFoundException("Payroll batch not found.");
    if (batch.status !== "APPROVED") {
      throw new ConflictException("Only an APPROVED batch can be sent for payment.");
    }

    const payable = await this.prisma.payrollRecord.findMany({
      where: { orgId, batchId, status: "APPROVED" },
      select: { id: true, employeeId: true, netPayable: true, currencyCode: true },
    });
    if (payable.length === 0) throw new ConflictException("The batch has no approved records to pay.");

    const created = await this.prisma.$transaction(async (tx) => {
      const res = await tx.payrollPayment.createMany({
        data: payable.map((r) => ({
          orgId,
          recordId: r.id,
          employeeId: r.employeeId,
          amount: r.netPayable,
          currencyCode: r.currencyCode,
          status: "PENDING",
          processedBy: userId,
          idempotencyKey: this.idempotencyKey(batchId, r.employeeId),
        })),
        skipDuplicates: true,
      });
      await tx.payrollRecord.updateMany({
        where: { orgId, batchId, status: "APPROVED" },
        data: { status: "PAYMENT_PROCESSING" },
      });
      await tx.payrollBatch.update({ where: { id: batchId }, data: { status: "PAYMENT_PROCESSING" } });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.batch.payment_processing",
        aggregateType: "payroll_batch",
        aggregateId: batchId,
        orgId,
        payload: { batchId, payments: res.count, records: payable.length, processedBy: userId },
      });
      return res.count;
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "payroll.batch.payment_processing",
      resourceType: "payroll_batch",
      resourceId: batchId,
      after: { paymentsCreated: created, records: payable.length },
    });
    this.log.log(`Batch ${batchId}: opened ${created} payment(s)`);
    return { batchId, paymentsCreated: created, records: payable.length };
  }

  // ---- mark a record paid --------------------------------------------------

  async markPaid(recordId: string, input: MarkPaidInput) {
    const { orgId, userId } = requireTenantContext();
    const record = await this.prisma.payrollRecord.findFirst({
      where: { id: recordId, orgId },
      select: { id: true, batchId: true, employeeId: true, netPayable: true, currencyCode: true, status: true },
    });
    if (!record) throw new NotFoundException("Payroll record not found.");
    if (record.status === "PAID") throw new ConflictException("This record is already paid.");
    if (!PAYABLE_RECORD.has(record.status)) {
      throw new ConflictException(`A record in ${record.status} cannot be marked paid.`);
    }

    const idem = this.idempotencyKey(record.batchId, record.employeeId);
    const amount = input.amount !== undefined ? new Prisma.Decimal(input.amount) : record.netPayable;
    const paymentDate = input.paymentDate ? new Date(input.paymentDate) : new Date();
    const reference = input.reference?.trim() || null;

    const outcome = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payrollPayment.upsert({
        where: { idempotencyKey: idem },
        create: {
          orgId,
          recordId: record.id,
          employeeId: record.employeeId,
          amount,
          currencyCode: record.currencyCode,
          method: input.method,
          reference,
          status: "PAID",
          paymentDate,
          processedBy: userId,
          idempotencyKey: idem,
        },
        update: { status: "PAID", method: input.method, reference, amount, paymentDate, processedBy: userId },
        select: { id: true },
      });
      const attemptNo = (await tx.payrollPaymentAttempt.count({ where: { orgId, paymentId: payment.id } })) + 1;
      await tx.payrollPaymentAttempt.create({
        data: { orgId, paymentId: payment.id, attemptNo, status: "SUCCESS", providerRef: reference },
      });
      await tx.payrollRecord.update({ where: { id: record.id }, data: { status: "PAID" } });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.record.paid",
        aggregateType: "payroll_record",
        aggregateId: record.id,
        orgId,
        payload: { recordId: record.id, batchId: record.batchId, employeeId: record.employeeId, paymentId: payment.id },
      });
      // Batch is PAID once no record is left unsettled.
      const remaining = await tx.payrollRecord.count({
        where: { orgId, batchId: record.batchId, status: { notIn: SETTLED_RECORD } },
      });
      if (remaining === 0) {
        await tx.payrollBatch.update({ where: { id: record.batchId }, data: { status: "PAID", paidAt: new Date() } });
        await this.outbox.enqueue(tx, {
          eventType: "payroll.batch.paid",
          aggregateType: "payroll_batch",
          aggregateId: record.batchId,
          orgId,
          payload: { batchId: record.batchId, closedBy: userId },
        });
      }
      return { paymentId: payment.id, batchPaid: remaining === 0 };
    });

    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "payroll.record.paid",
      resourceType: "payroll_record",
      resourceId: record.id,
      after: { paymentId: outcome.paymentId, method: input.method, amount: Number(amount), batchPaid: outcome.batchPaid },
    });

    // A payslip is generated ON PAYMENT (never on approval). Best-effort: a payslip
    // hiccup must never fail a settled payment — it can be re-generated by an admin.
    try {
      await this.statements.generateForRecord(record.id);
    } catch (err) {
      this.log.warn(`Payslip generation deferred for record ${record.id}: ${String(err)}`);
    }

    return {
      recordId: record.id,
      paymentId: outcome.paymentId,
      status: "PAID",
      amount: Number(amount),
      currencyCode: record.currencyCode,
      method: input.method,
      reference: maskReference(reference),
      paymentDate: paymentDate.toISOString(),
      batchPaid: outcome.batchPaid,
    };
  }

  // ---- fail / retry --------------------------------------------------------

  /** Record a failed settlement attempt on a payment (e.g. a bank rejection),
   *  moving both the payment and its record into a FAILED state that retry() clears. */
  async markFailed(paymentId: string, input: { error?: string } = {}) {
    const { orgId, userId } = requireTenantContext();
    const payment = await this.prisma.payrollPayment.findFirst({
      where: { id: paymentId, orgId },
      select: { id: true, recordId: true, status: true },
    });
    if (!payment) throw new NotFoundException("Payment not found.");
    if (payment.status === "PAID") throw new ConflictException("A paid payment cannot be marked failed.");

    await this.prisma.$transaction(async (tx) => {
      const attemptNo = (await tx.payrollPaymentAttempt.count({ where: { orgId, paymentId } })) + 1;
      await tx.payrollPaymentAttempt.create({
        data: { orgId, paymentId, attemptNo, status: "FAILED", error: input.error?.slice(0, 500) ?? null },
      });
      await tx.payrollPayment.update({ where: { id: paymentId }, data: { status: "FAILED" } });
      await tx.payrollRecord.update({ where: { id: payment.recordId }, data: { status: "PAYMENT_FAILED" } });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.payment.failed",
        aggregateType: "payroll_payment",
        aggregateId: paymentId,
        orgId,
        payload: { paymentId, recordId: payment.recordId, error: input.error ?? null },
      });
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "payroll.payment.failed",
      resourceType: "payroll_payment",
      resourceId: paymentId,
      metadata: input.error ? { error: input.error } : undefined,
    });
    return this.getPayment(paymentId);
  }

  /** Retry a FAILED payment: open a fresh PROCESSING attempt and re-arm the record. */
  async retry(paymentId: string) {
    const { orgId, userId } = requireTenantContext();
    const payment = await this.prisma.payrollPayment.findFirst({
      where: { id: paymentId, orgId },
      select: { id: true, recordId: true, status: true },
    });
    if (!payment) throw new NotFoundException("Payment not found.");
    if (payment.status !== "FAILED") throw new ConflictException("Only a FAILED payment can be retried.");

    await this.prisma.$transaction(async (tx) => {
      const attemptNo = (await tx.payrollPaymentAttempt.count({ where: { orgId, paymentId } })) + 1;
      await tx.payrollPaymentAttempt.create({ data: { orgId, paymentId, attemptNo, status: "PROCESSING" } });
      await tx.payrollPayment.update({ where: { id: paymentId }, data: { status: "PROCESSING" } });
      await tx.payrollRecord.update({ where: { id: payment.recordId }, data: { status: "PAYMENT_PROCESSING" } });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.payment.retried",
        aggregateType: "payroll_payment",
        aggregateId: paymentId,
        orgId,
        payload: { paymentId, recordId: payment.recordId, retriedBy: userId },
      });
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "payroll.payment.retried",
      resourceType: "payroll_payment",
      resourceId: paymentId,
    });
    return this.getPayment(paymentId);
  }

  // ---- proof ---------------------------------------------------------------

  async uploadProof(paymentId: string, input: ProofInput) {
    const { orgId, userId } = requireTenantContext();
    const payment = await this.prisma.payrollPayment.findFirst({ where: { id: paymentId, orgId }, select: { id: true } });
    if (!payment) throw new NotFoundException("Payment not found.");
    const storageKey = input.storageKey.trim();
    if (!storageKey) throw new ConflictException("A storage key is required for the proof.");

    const proof = await this.prisma.payrollPaymentProof.create({
      data: { orgId, paymentId, kind: input.kind, storageKey, checksum: input.checksum ?? null, uploadedBy: userId },
      select: { id: true, kind: true, storageKey: true, checksum: true, createdAt: true },
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "payroll.payment.proof_uploaded",
      resourceType: "payroll_payment",
      resourceId: paymentId,
      after: { proofId: proof.id, kind: proof.kind },
    });
    return { id: proof.id, kind: proof.kind, storageKey: proof.storageKey, checksum: proof.checksum, createdAt: proof.createdAt.toISOString() };
  }

  // ---- reads (scoped, masked) ----------------------------------------------

  async listPayments(filter: { batchId?: string; status?: string }) {
    const { orgId, userId } = requireTenantContext();
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollPaymentRead);
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);

    const where: Prisma.PayrollPaymentWhereInput = { orgId };
    if (filter.status) where.status = filter.status;
    if (visible !== null) where.employeeId = { in: visible };

    // PayrollPayment has no direct batchId; resolve the batch → its record ids first.
    if (filter.batchId) {
      const recs = await this.prisma.payrollRecord.findMany({ where: { orgId, batchId: filter.batchId }, select: { id: true } });
      where.recordId = { in: recs.map((r) => r.id) };
    }

    const rows = await this.prisma.payrollPayment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true, recordId: true, employeeId: true, amount: true, currencyCode: true,
        method: true, reference: true, status: true, paymentDate: true, createdAt: true,
      },
    });
    const ids = [...new Set(rows.map((r) => r.employeeId))];
    const emps = await this.prisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
    const nameById = new Map(emps.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));

    return {
      items: rows.map((r) => ({
        id: r.id,
        recordId: r.recordId,
        employeeId: r.employeeId,
        employeeName: nameById.get(r.employeeId) ?? "Unknown",
        amount: Number(r.amount),
        currencyCode: r.currencyCode,
        method: r.method,
        reference: maskReference(r.reference),
        status: r.status,
        paymentDate: r.paymentDate?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async getPayment(paymentId: string) {
    const { orgId, userId } = requireTenantContext();
    const payment = await this.prisma.payrollPayment.findFirst({
      where: { id: paymentId, orgId },
      include: { attempts: { orderBy: { attemptNo: "asc" } }, proofs: { orderBy: { createdAt: "asc" } } },
    });
    if (!payment) throw new NotFoundException("Payment not found.");

    // Scope check: a scoped/self caller may only read a payment in their reach.
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollPaymentRead);
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    if (visible !== null && !visible.includes(payment.employeeId)) {
      throw new NotFoundException("Payment not found.");
    }

    return {
      id: payment.id,
      recordId: payment.recordId,
      employeeId: payment.employeeId,
      amount: Number(payment.amount),
      currencyCode: payment.currencyCode,
      method: payment.method,
      reference: maskReference(payment.reference),
      status: payment.status,
      paymentDate: payment.paymentDate?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
      attempts: payment.attempts.map((a) => ({
        attemptNo: a.attemptNo,
        status: a.status,
        providerRef: maskReference(a.providerRef),
        error: a.error,
        createdAt: a.createdAt.toISOString(),
      })),
      proofs: payment.proofs.map((p) => ({
        id: p.id,
        kind: p.kind,
        storageKey: p.storageKey,
        checksum: p.checksum,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }
}
