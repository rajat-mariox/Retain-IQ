import { createHash } from "node:crypto";
import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { PayrollRecordStatus } from "@retainiq/database/identity";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";

// A statement can only be produced from a finalized (approved/paid/closed) record.
const FINALIZED_RECORD_STATUSES: PayrollRecordStatus[] = ["APPROVED", "PAYMENT_PROCESSING", "PAID", "CLOSED"];
const FINALIZED_RECORD = new Set<string>(FINALIZED_RECORD_STATUSES);

/** Deterministic JSON: keys sorted recursively so the same content always hashes to
 *  the same checksum, regardless of property insertion order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Payout-statement generation (§18). Builds a canonical, deterministic payslip
 * document from a finalized PayrollRecord and its components, checksums it with
 * SHA-256 so tampering is detectable, and stores a PayrollStatement pointing at a
 * deterministic storageKey. kind is PAYOUT_STATEMENT — a statutory PAYSLIP is Phase
 * 2. Employees read only their own statements (payroll.statement.own.read); admins
 * with payroll.statement.employee.read read others, scoped by AccessScopeService.
 * Tenant-isolated on orgId (§38.21).
 */
@Injectable()
export class StatementService {
  private readonly log = new Logger(StatementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ---- generate ------------------------------------------------------------

  /** Generate statements for every finalized record in a batch. */
  async generateForBatch(batchId: string) {
    const { orgId } = requireTenantContext();
    const batch = await this.prisma.payrollBatch.findFirst({ where: { id: batchId, orgId }, select: { id: true, status: true } });
    if (!batch) throw new NotFoundException("Payroll batch not found.");
    if (!FINALIZED_RECORD.has(batch.status)) {
      throw new ConflictException("Statements can only be generated for an approved or paid batch.");
    }
    const records = await this.prisma.payrollRecord.findMany({
      where: { orgId, batchId, status: { in: FINALIZED_RECORD_STATUSES } },
      select: { id: true },
    });
    if (records.length === 0) throw new ConflictException("No finalized records in this batch to generate statements for.");

    const items = [];
    for (const r of records) items.push(await this.generateForRecord(r.id));
    return { batchId, generated: items.length, statements: items };
  }

  /** Generate (or reuse) a statement for a single finalized record. */
  async generateForRecord(recordId: string) {
    const { orgId, userId } = requireTenantContext();
    const record = await this.prisma.payrollRecord.findFirst({
      where: { id: recordId, orgId },
      select: {
        id: true, batchId: true, employeeId: true, periodId: true, currencyCode: true,
        grossEarnings: true, netPayable: true, status: true, calcVersion: true,
      },
    });
    if (!record) throw new NotFoundException("Payroll record not found.");
    if (!FINALIZED_RECORD.has(record.status)) {
      throw new ConflictException(`A record in ${record.status} is not finalized — it cannot produce a statement.`);
    }

    const components = await this.prisma.payrollRecordComponent.findMany({
      where: { orgId, recordId: record.id },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      select: { code: true, name: true, direction: true, category: true, amount: true, taxable: true, statutory: true, payslipVisible: true },
    });

    // Canonical payslip document — only payslip-visible lines, decimals as strings
    // so the checksum is exact and locale-independent.
    const document = {
      kind: "PAYOUT_STATEMENT",
      orgId,
      batchId: record.batchId,
      periodId: record.periodId,
      employeeId: record.employeeId,
      currencyCode: record.currencyCode,
      calcVersion: record.calcVersion,
      gross: record.grossEarnings.toString(),
      net: record.netPayable.toString(),
      lines: components
        .filter((c) => c.payslipVisible)
        .map((c) => ({
          code: c.code,
          name: c.name,
          direction: c.direction,
          category: c.category,
          amount: c.amount.toString(),
          taxable: c.taxable,
          statutory: c.statutory,
        })),
    };
    const canonical = stableStringify(document);
    const checksum = createHash("sha256").update(canonical).digest("hex");
    const storageKey = `statements/${orgId}/${record.batchId}/${record.employeeId}.json`;

    // Idempotent: if the latest statement already matches this checksum, reuse it.
    const latest = await this.prisma.payrollStatement.findFirst({
      where: { orgId, recordId: record.id },
      orderBy: { documentVersion: "desc" },
    });
    if (latest && latest.checksum === checksum) {
      return this.serialize(latest, { reused: true, document });
    }
    const documentVersion = (latest?.documentVersion ?? 0) + 1;

    const created = await this.prisma.$transaction(async (tx) => {
      const statement = await tx.payrollStatement.create({
        data: {
          orgId,
          recordId: record.id,
          employeeId: record.employeeId,
          kind: "PAYOUT_STATEMENT",
          documentVersion,
          storageKey,
          checksum,
          currencyCode: record.currencyCode,
          grossAmount: record.grossEarnings,
          netAmount: record.netPayable,
        },
      });
      await tx.payrollRecord.update({ where: { id: record.id }, data: { statementStatus: "GENERATED" } });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.statement.generated",
        aggregateType: "payroll_statement",
        aggregateId: statement.id,
        orgId,
        payload: { statementId: statement.id, recordId: record.id, employeeId: record.employeeId, documentVersion, checksum },
      });
      return statement;
    });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      action: "payroll.statement.generated",
      resourceType: "payroll_statement",
      resourceId: created.id,
      after: { recordId: record.id, employeeId: record.employeeId, documentVersion, checksum },
    });
    this.log.log(`Generated statement ${created.id} v${documentVersion} for record ${record.id}`);
    return this.serialize(created, { reused: false, document });
  }

  // ---- reads ---------------------------------------------------------------

  /** The caller's own statements — hard-scoped to their own employee record. */
  async myStatements() {
    const { orgId, userId } = requireTenantContext();
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollStatementOwnRead);
    if (!scope.employeeId) return { items: [] };
    const rows = await this.prisma.payrollStatement.findMany({
      where: { orgId, employeeId: scope.employeeId },
      orderBy: { generatedAt: "desc" },
    });
    return { items: rows.map((r) => this.serialize(r)) };
  }

  /** Another employee's statements — requires payroll.statement.employee.read and
   *  the employee must be within the caller's access scope. */
  async employeeStatements(employeeId: string) {
    const { orgId, userId } = requireTenantContext();
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true } });
    if (!employee) throw new NotFoundException("Employee not found.");
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollStatementEmployeeRead);
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    if (visible !== null && !visible.includes(employeeId)) throw new NotFoundException("Employee not found.");

    const rows = await this.prisma.payrollStatement.findMany({
      where: { orgId, employeeId },
      orderBy: { generatedAt: "desc" },
    });
    return { items: rows.map((r) => this.serialize(r)) };
  }

  private serialize(
    r: {
      id: string; recordId: string; employeeId: string; kind: string; documentVersion: number;
      storageKey: string; checksum: string; currencyCode: string; grossAmount: unknown; netAmount: unknown; generatedAt: Date;
    },
    extra?: { reused: boolean; document: unknown },
  ) {
    return {
      id: r.id,
      recordId: r.recordId,
      employeeId: r.employeeId,
      kind: r.kind,
      documentVersion: r.documentVersion,
      storageKey: r.storageKey,
      checksum: r.checksum,
      currencyCode: r.currencyCode,
      grossAmount: Number(r.grossAmount),
      netAmount: Number(r.netAmount),
      generatedAt: r.generatedAt.toISOString(),
      ...(extra ? { reused: extra.reused, document: extra.document } : {}),
    };
  }
}
