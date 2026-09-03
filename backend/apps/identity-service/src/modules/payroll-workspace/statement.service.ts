import { createHash } from "node:crypto";
import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type PayrollRecordStatus } from "@retainiq/database/identity";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { StorageService } from "../storage/storage.service.js";
import { renderPayslipPdf, type PayslipData } from "./payslip-pdf.js";

// A payslip is produced ONLY from a PAID record (or a later CLOSED one) — never on
// approval. Generation before payment is refused (§18, per product rule).
const PAYABLE_STATEMENT_STATUSES: PayrollRecordStatus[] = ["PAID", "CLOSED"];
const PAYABLE_STATEMENT = new Set<string>(PAYABLE_STATEMENT_STATUSES);

/** Show only the last 4 of a bank/UTR reference; full value never leaves the row. */
function maskRef(ref: string | null): string | null {
  if (!ref) return null;
  const s = ref.trim();
  return s.length <= 4 ? "••••" : `••••${s.slice(-4)}`;
}

/** Deterministic JSON: keys sorted recursively so identical content hashes identically. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Payslip generation + delivery (§18). A payslip is generated only after PAYMENT
 * (PAID). It is rendered to a real PDF, stored in object storage (MinIO/S3), and
 * checksummed (SHA-256 over the canonical data) so tampering is detectable. Each
 * regeneration is a new immutable version. The document is DRAFT until an admin
 * publishes the batch's payslips, at which point employees can see + download them
 * (via a presigned URL) and are notified. Employees read only their own PUBLISHED
 * payslips; admins with payroll.statement.employee.read read others, scoped by
 * AccessScopeService. Tenant-isolated on orgId.
 */
@Injectable()
export class StatementService {
  private readonly log = new Logger(StatementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly storage: StorageService,
  ) {}

  // ---- generate (after payment) --------------------------------------------

  /** Generate payslips for every PAID/CLOSED record in a batch. */
  async generateForBatch(batchId: string) {
    const { orgId } = requireTenantContext();
    const batch = await this.prisma.payrollBatch.findFirst({ where: { id: batchId, orgId }, select: { id: true, status: true } });
    if (!batch) throw new NotFoundException("Payroll batch not found.");
    if (!PAYABLE_STATEMENT.has(batch.status)) {
      throw new ConflictException("Payslips are generated only after payment — pay the batch first.");
    }
    const records = await this.prisma.payrollRecord.findMany({
      where: { orgId, batchId, status: { in: PAYABLE_STATEMENT_STATUSES } },
      select: { id: true },
    });
    if (records.length === 0) throw new ConflictException("No paid records in this batch to generate payslips for.");

    const items = [];
    for (const r of records) items.push(await this.generateForRecord(r.id));
    return { batchId, generated: items.length, statements: items };
  }

  /** Generate (or reuse) a payslip for a single PAID record. Called on payment and by admins. */
  async generateForRecord(recordId: string) {
    const { orgId, userId } = requireTenantContext();
    const record = await this.prisma.payrollRecord.findFirst({
      where: { id: recordId, orgId },
      select: {
        id: true, batchId: true, employeeId: true, periodId: true, currencyCode: true,
        grossEarnings: true, netPayable: true, preTaxDeductions: true, employeeStatutory: true,
        taxDeduction: true, postTaxDeductions: true, status: true, calcVersion: true,
      },
    });
    if (!record) throw new NotFoundException("Payroll record not found.");
    if (!PAYABLE_STATEMENT.has(record.status)) {
      throw new ConflictException(`A payslip is only generated after payment; this record is ${record.status}.`);
    }

    const [components, employee, org, period, payment] = await Promise.all([
      this.prisma.payrollRecordComponent.findMany({
        where: { orgId, recordId: record.id },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: { code: true, name: true, direction: true, category: true, amount: true, taxable: true, statutory: true, employerPaid: true, payslipVisible: true },
      }),
      this.prisma.employee.findFirst({ where: { orgId, id: record.employeeId }, select: { firstName: true, lastName: true, employeeCode: true, designationRef: { select: { title: true } } } }),
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
      this.prisma.payrollPeriod.findUnique({ where: { id: record.periodId }, select: { periodStart: true, periodEnd: true, payDate: true } }),
      this.prisma.payrollPayment.findFirst({ where: { orgId, recordId: record.id }, select: { reference: true, paymentDate: true }, orderBy: { createdAt: "desc" } }),
    ]);

    const visible = components.filter((c) => c.payslipVisible);
    const num = (d: Prisma.Decimal) => Number(d);
    const earnings = visible.filter((c) => c.direction === "EARNING" && !c.employerPaid).map((c) => ({ name: c.name, amount: num(c.amount) }));
    const deductions = visible.filter((c) => c.direction === "DEDUCTION" && !c.employerPaid).map((c) => ({ name: c.name, amount: num(c.amount) }));
    const employerContribs = visible.filter((c) => c.employerPaid).map((c) => ({ name: c.name, amount: num(c.amount) }));
    const totalDeductions = num(record.preTaxDeductions) + num(record.employeeStatutory) + num(record.taxDeduction) + num(record.postTaxDeductions);

    const ytd = await this.computeYtd(orgId, record.employeeId, period?.periodEnd ?? new Date());
    const employerName = org?.name ?? "Employer";
    const employeeName = employee ? `${employee.firstName} ${employee.lastName}`.trim() : record.employeeId.slice(0, 8);
    const periodLabel = period ? period.periodEnd.toISOString().slice(0, 7) : "—";

    // Canonical data → checksum. The PDF is a rendering of exactly this.
    const canonicalDoc = {
      kind: "PAYSLIP", orgId, employerName, batchId: record.batchId, periodId: record.periodId,
      employeeId: record.employeeId, employeeName, currencyCode: record.currencyCode, calcVersion: record.calcVersion,
      gross: num(record.grossEarnings).toFixed(2), net: num(record.netPayable).toFixed(2), totalDeductions: totalDeductions.toFixed(2),
      earnings, deductions, employerContribs, ytd,
    };
    const checksum = createHash("sha256").update(stableStringify(canonicalDoc)).digest("hex");

    // Idempotent: identical data + already stored → reuse the existing version.
    // Still (re)assert the record's statementStatus so the "payslips pending" signal
    // stays accurate even if it was reset.
    const latest = await this.prisma.payrollStatement.findFirst({ where: { orgId, recordId: record.id }, orderBy: { documentVersion: "desc" } });
    if (latest && latest.checksum === checksum) {
      await this.prisma.payrollRecord.updateMany({ where: { id: record.id, statementStatus: { not: "GENERATED" } }, data: { statementStatus: "GENERATED" } });
      return this.serialize(latest);
    }
    const documentVersion = (latest?.documentVersion ?? 0) + 1;

    const payslip: PayslipData = {
      employerName, employeeName, employeeCode: employee?.employeeCode ?? null,
      designation: employee?.designationRef?.title ?? null,
      period: { start: period?.periodStart.toISOString().slice(0, 10) ?? "—", end: period?.periodEnd.toISOString().slice(0, 10) ?? "—", label: periodLabel },
      currencyCode: record.currencyCode, payDate: period?.payDate?.toISOString().slice(0, 10) ?? null,
      paymentRef: maskRef(payment?.reference ?? null),
      earnings, deductions, employerContribs,
      gross: num(record.grossEarnings), totalDeductions, net: num(record.netPayable),
      ytd, documentVersion, checksum,
    };
    const pdf = await renderPayslipPdf(payslip);
    const storageKey = `statements/${orgId}/${record.batchId}/${record.employeeId}-v${documentVersion}.pdf`;
    await this.storage.putObject(storageKey, pdf, "application/pdf");

    const created = await this.prisma.$transaction(async (tx) => {
      const statement = await tx.payrollStatement.create({
        data: {
          orgId, recordId: record.id, employeeId: record.employeeId, kind: "PAYSLIP", documentVersion,
          storageKey, contentType: "application/pdf", checksum, currencyCode: record.currencyCode,
          grossAmount: record.grossEarnings, netAmount: record.netPayable, status: "DRAFT",
        },
      });
      await tx.payrollRecord.update({ where: { id: record.id }, data: { statementStatus: "GENERATED" } });
      await this.outbox.enqueue(tx, {
        eventType: "payroll.statement.generated", aggregateType: "payroll_statement", aggregateId: statement.id, orgId,
        payload: { statementId: statement.id, recordId: record.id, employeeId: record.employeeId, documentVersion, checksum },
      });
      return statement;
    });
    await this.audit.record({ orgId, actorUserId: userId, action: "payroll.statement.generated", resourceType: "payroll_statement", resourceId: created.id, after: { recordId: record.id, employeeId: record.employeeId, documentVersion } });
    this.log.log(`Generated payslip ${created.id} v${documentVersion} for record ${record.id}`);
    return this.serialize(created);
  }

  /** Fiscal-year-to-date (April start) totals for an employee, up to a period end. */
  private async computeYtd(orgId: string, employeeId: string, periodEnd: Date) {
    const y = periodEnd.getUTCFullYear();
    const fyStart = new Date(Date.UTC(periodEnd.getUTCMonth() + 1 >= 4 ? y : y - 1, 3, 1)); // 1 April
    const periods = await this.prisma.payrollPeriod.findMany({ where: { orgId, periodEnd: { gte: fyStart, lte: periodEnd } }, select: { id: true } });
    if (periods.length === 0) return { gross: 0, deductions: 0, net: 0 };
    const recs = await this.prisma.payrollRecord.findMany({
      where: { orgId, employeeId, status: { in: PAYABLE_STATEMENT_STATUSES }, periodId: { in: periods.map((p) => p.id) } },
      select: { grossEarnings: true, netPayable: true, preTaxDeductions: true, employeeStatutory: true, taxDeduction: true, postTaxDeductions: true },
    });
    let gross = 0, deductions = 0, net = 0;
    for (const r of recs) {
      gross += Number(r.grossEarnings);
      net += Number(r.netPayable);
      deductions += Number(r.preTaxDeductions) + Number(r.employeeStatutory) + Number(r.taxDeduction) + Number(r.postTaxDeductions);
    }
    return { gross, deductions, net };
  }

  // ---- publish (release to employees) --------------------------------------

  /**
   * Publish every DRAFT payslip in a batch — the release step. Flips them to
   * PUBLISHED (so employees can see + download them) and emits one
   * payroll.statement.published event per employee so the notifications service
   * tells each employee their payslip is ready.
   */
  async publishForBatch(batchId: string) {
    const { orgId, userId } = requireTenantContext();
    const batch = await this.prisma.payrollBatch.findFirst({ where: { id: batchId, orgId }, select: { id: true, status: true } });
    if (!batch) throw new NotFoundException("Payroll batch not found.");
    const records = await this.prisma.payrollRecord.findMany({ where: { orgId, batchId }, select: { id: true } });
    const recIds = records.map((r) => r.id);
    const drafts = await this.prisma.payrollStatement.findMany({ where: { orgId, recordId: { in: recIds }, status: "DRAFT" } });
    if (drafts.length === 0) return { batchId, published: 0 };

    // Map each statement's employee → their login userId for the notification.
    const employeeIds = [...new Set(drafts.map((s) => s.employeeId))];
    const userByEmployee = await this.employeeUserIds(orgId, employeeIds);
    const period = await this.periodLabelForBatch(orgId, batchId);

    let published = 0;
    for (const s of drafts) {
      await this.prisma.$transaction(async (tx) => {
        await tx.payrollStatement.update({ where: { id: s.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
        await this.outbox.enqueue(tx, {
          eventType: "payroll.statement.published", aggregateType: "payroll_statement", aggregateId: s.id, orgId,
          payload: { statementId: s.id, employeeId: s.employeeId, requesterUserId: userByEmployee.get(s.employeeId) ?? null, period, netAmount: Number(s.netAmount), currencyCode: s.currencyCode },
        });
      });
      published += 1;
    }
    await this.audit.record({ orgId, actorUserId: userId, action: "payroll.statement.published", resourceType: "payroll_batch", resourceId: batchId, after: { published } });
    this.log.log(`Published ${published} payslip(s) for batch ${batchId}`);
    return { batchId, published };
  }

  /** Resolve employeeId → login userId via the membership read model (employeeId link). */
  private async employeeUserIds(orgId: string, employeeIds: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.organizationMembership.findMany({
      where: { orgId, employeeId: { in: employeeIds } },
      select: { employeeId: true, userId: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) if (r.employeeId) map.set(r.employeeId, r.userId);
    return map;
  }

  private async periodLabelForBatch(orgId: string, batchId: string): Promise<string> {
    const batch = await this.prisma.payrollBatch.findFirst({ where: { id: batchId, orgId }, select: { period: { select: { periodEnd: true } } } });
    return batch?.period?.periodEnd.toISOString().slice(0, 7) ?? "";
  }

  // ---- reads (scoped, with presigned download) -----------------------------

  /** The caller's own PUBLISHED payslips, each with a short-lived download URL. */
  async myStatements() {
    const { orgId, userId } = requireTenantContext();
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollStatementOwnRead);
    if (!scope.employeeId) return { items: [] };
    const rows = await this.prisma.payrollStatement.findMany({
      where: { orgId, employeeId: scope.employeeId, status: "PUBLISHED" },
      orderBy: { generatedAt: "desc" },
    });
    return { items: await this.decorate(orgId, rows) };
  }

  /** Another employee's payslips (admin), including drafts. Scoped to the caller's reach. */
  async employeeStatements(employeeId: string) {
    const { orgId, userId } = requireTenantContext();
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true } });
    if (!employee) throw new NotFoundException("Employee not found.");
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollStatementEmployeeRead);
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    if (visible !== null && !visible.includes(employeeId)) throw new NotFoundException("Employee not found.");
    const rows = await this.prisma.payrollStatement.findMany({ where: { orgId, employeeId }, orderBy: { generatedAt: "desc" } });
    return { items: await this.decorate(orgId, rows) };
  }

  /** Attach each payslip's pay period (via its record) and a presigned download URL. */
  private async decorate(orgId: string, rows: StatementRow[]) {
    const recIds = [...new Set(rows.map((r) => r.recordId))];
    const records = recIds.length ? await this.prisma.payrollRecord.findMany({ where: { orgId, id: { in: recIds } }, select: { id: true, periodId: true } }) : [];
    const periodIds = [...new Set(records.map((r) => r.periodId))];
    const periods = periodIds.length ? await this.prisma.payrollPeriod.findMany({ where: { id: { in: periodIds } }, select: { id: true, periodStart: true, periodEnd: true } }) : [];
    const periodById = new Map(periods.map((p) => [p.id, p]));
    const periodByRecord = new Map(records.map((r) => [r.id, periodById.get(r.periodId)]));
    return Promise.all(rows.map(async (r) => {
      const per = periodByRecord.get(r.recordId);
      let downloadUrl: string | null = null;
      try {
        downloadUrl = await this.storage.presignGet(r.storageKey);
      } catch (err) {
        this.log.warn(`Could not presign payslip ${r.id}: ${String(err)}`);
      }
      return {
        ...this.serialize(r),
        downloadUrl,
        periodStart: per?.periodStart.toISOString().slice(0, 10) ?? null,
        periodEnd: per?.periodEnd.toISOString().slice(0, 10) ?? null,
        periodLabel: per ? per.periodEnd.toISOString().slice(0, 7) : null,
      };
    }));
  }

  private serialize(r: StatementRow) {
    return {
      id: r.id, recordId: r.recordId, employeeId: r.employeeId, kind: r.kind, documentVersion: r.documentVersion,
      storageKey: r.storageKey, checksum: r.checksum, currencyCode: r.currencyCode,
      grossAmount: Number(r.grossAmount), netAmount: Number(r.netAmount),
      status: r.status, publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      generatedAt: r.generatedAt.toISOString(),
    };
  }
}

interface StatementRow {
  id: string; recordId: string; employeeId: string; kind: string; documentVersion: number;
  storageKey: string; checksum: string; currencyCode: string; grossAmount: unknown; netAmount: unknown;
  status: string; publishedAt: Date | null; generatedAt: Date;
}
