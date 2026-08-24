import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { OrgRolesService } from "../../common/org-roles/org-roles.service.js";
import { type Cell, type ReportTable, toCsv, exportMeta } from "../../common/reports/report-export.js";

const NIL = "00000000-0000-0000-0000-000000000000";
const num = (x: Prisma.Decimal | number | null | undefined): number => (x == null ? 0 : Number(x));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const ymd = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : "");

export const REPORT_KINDS = ["register", "payout-summary", "employee-history", "department-cost", "earnings-deductions", "on-hold", "failed"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface ReportOptions {
  periodId?: string;
  batchId?: string;
  employeeId?: string;
}

export interface BuiltReport extends ReportTable {
  kind: ReportKind;
  title: string;
}

interface ScopedEmployees {
  ids: string[];
  name: Map<string, string>;
  dept: Map<string, { id: string | null; name: string }>;
}

/**
 * Payroll reports (§31). Every report is scoped by the caller's ABAC reach and
 * excludes the Owner (not staff). Rows are returned as a { columns, rows } table
 * so the shared report-export helper can render CSV/XLSX identically to the rest
 * of the platform. Money is converted from Decimal to plain numbers at the edge.
 */
@Injectable()
export class PayrollReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly orgRoles: OrgRolesService,
  ) {}

  /** Scoped, owner-excluded employee directory the report may cover. */
  private async scopedEmployees(orgId: string, userId: string): Promise<ScopedEmployees> {
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollReportRead);
    const notOwner = await this.orgRoles.notOwnerIdFilter(orgId);
    const rows = await this.prisma.employee.findMany({
      where: { orgId, ...this.accessScope.employeeWhere(scope), ...notOwner },
      select: { id: true, firstName: true, lastName: true, departmentId: true, departmentRef: { select: { name: true } } },
    });
    const ids = rows.map((r) => r.id);
    const name = new Map(rows.map((r) => [r.id, `${r.firstName} ${r.lastName}`.trim()]));
    const dept = new Map(rows.map((r) => [r.id, { id: r.departmentId, name: r.departmentRef?.name ?? "Unassigned" }]));
    return { ids, name, dept };
  }

  private async currentPeriodId(orgId: string, opts: ReportOptions): Promise<string | null> {
    if (opts.periodId) return opts.periodId;
    const p =
      (await this.prisma.payrollPeriod.findFirst({ where: { orgId, status: { not: "CLOSED" } }, orderBy: { periodStart: "desc" } })) ??
      (await this.prisma.payrollPeriod.findFirst({ where: { orgId }, orderBy: { periodStart: "desc" } }));
    return p?.id ?? null;
  }

  async build(kind: ReportKind, opts: ReportOptions): Promise<BuiltReport> {
    if (!REPORT_KINDS.includes(kind)) throw new BadRequestException(`Unknown report: ${kind}`);
    const { orgId, userId } = requireTenantContext();
    const emp = await this.scopedEmployees(orgId, userId);
    const empFilter = { in: emp.ids.length ? emp.ids : [NIL] };

    switch (kind) {
      case "register":
        return this.register(orgId, opts, emp, empFilter);
      case "payout-summary":
        return this.payoutSummary(orgId, opts, empFilter);
      case "employee-history":
        return this.employeeHistory(orgId, opts, emp, empFilter);
      case "department-cost":
        return this.departmentCost(orgId, opts, emp, empFilter);
      case "earnings-deductions":
        return this.earningsDeductions(orgId, opts, empFilter);
      case "on-hold":
        return this.onHold(orgId, emp, empFilter);
      case "failed":
        return this.failed(orgId, emp, empFilter);
      default:
        throw new BadRequestException("Unknown report.");
    }
  }

  /** { filename, contentType, body } for a CSV download of a built report. */
  csv(report: BuiltReport) {
    const meta = exportMeta(`payroll-${report.kind}`, "csv");
    return { filename: meta.filename, contentType: meta.contentType, body: toCsv(report) };
  }

  private recordWhere(orgId: string, opts: ReportOptions, empFilter: { in: string[] }, periodId: string | null): Prisma.PayrollRecordWhereInput {
    const where: Prisma.PayrollRecordWhereInput = { orgId, employeeId: empFilter };
    if (opts.batchId) where.batchId = opts.batchId;
    else if (periodId) where.periodId = periodId;
    if (opts.employeeId) where.employeeId = opts.employeeId;
    return where;
  }

  // ---- register: one row per employee payout in a batch/period ----
  private async register(orgId: string, opts: ReportOptions, emp: ScopedEmployees, empFilter: { in: string[] }): Promise<BuiltReport> {
    const periodId = await this.currentPeriodId(orgId, opts);
    const records = await this.prisma.payrollRecord.findMany({ where: this.recordWhere(orgId, opts, empFilter, periodId), orderBy: { employeeId: "asc" } });
    const rows: Cell[][] = records.map((r) => {
      const deductions = num(r.preTaxDeductions) + num(r.postTaxDeductions) + num(r.taxDeduction) + num(r.employeeStatutory);
      return [
        emp.name.get(r.employeeId) ?? "—",
        emp.dept.get(r.employeeId)?.name ?? "Unassigned",
        r.currencyCode,
        round2(num(r.grossEarnings)),
        round2(deductions),
        round2(num(r.taxDeduction)),
        round2(num(r.netPayable)),
        round2(num(r.employerCost)),
        r.status,
      ];
    });
    return { kind: "register", title: "Payroll Register", columns: ["Employee", "Department", "Currency", "Gross", "Deductions", "Tax", "Net", "Employer Cost", "Status"], rows };
  }

  // ---- payout summary: totals per batch (from scoped records) ----
  private async payoutSummary(orgId: string, opts: ReportOptions, empFilter: { in: string[] }): Promise<BuiltReport> {
    const periodId = await this.currentPeriodId(orgId, opts);
    const records = await this.prisma.payrollRecord.findMany({ where: this.recordWhere(orgId, opts, empFilter, periodId), select: { batchId: true, grossEarnings: true, netPayable: true, employerCost: true, preTaxDeductions: true, postTaxDeductions: true, taxDeduction: true, employeeStatutory: true, employeeId: true } });
    const byBatch = new Map<string, { count: number; gross: number; deductions: number; net: number; employerCost: number }>();
    for (const r of records) {
      const b = byBatch.get(r.batchId) ?? { count: 0, gross: 0, deductions: 0, net: 0, employerCost: 0 };
      b.count += 1;
      b.gross += num(r.grossEarnings);
      b.deductions += num(r.preTaxDeductions) + num(r.postTaxDeductions) + num(r.taxDeduction) + num(r.employeeStatutory);
      b.net += num(r.netPayable);
      b.employerCost += num(r.employerCost);
      byBatch.set(r.batchId, b);
    }
    const batchIds = [...byBatch.keys()];
    const batches = await this.prisma.payrollBatch.findMany({ where: { orgId, id: { in: batchIds.length ? batchIds : [NIL] } }, select: { id: true, name: true, status: true, currencyCode: true } });
    const meta = new Map(batches.map((b) => [b.id, b]));
    const rows: Cell[][] = [...byBatch.entries()].map(([bid, v]) => {
      const m = meta.get(bid);
      return [m?.name ?? bid, m?.status ?? "—", m?.currencyCode ?? "USD", v.count, round2(v.gross), round2(v.deductions), round2(v.net), round2(v.employerCost)];
    });
    return { kind: "payout-summary", title: "Payout Summary", columns: ["Batch", "Status", "Currency", "Employees", "Gross", "Deductions", "Net", "Employer Cost"], rows };
  }

  // ---- employee payout history: records across periods ----
  private async employeeHistory(orgId: string, opts: ReportOptions, emp: ScopedEmployees, empFilter: { in: string[] }): Promise<BuiltReport> {
    const where: Prisma.PayrollRecordWhereInput = { orgId, employeeId: opts.employeeId ?? empFilter };
    const records = await this.prisma.payrollRecord.findMany({ where, orderBy: [{ employeeId: "asc" }, { createdAt: "desc" }], take: 2000, select: { employeeId: true, periodId: true, grossEarnings: true, netPayable: true, status: true, calculatedAt: true, currencyCode: true } });
    const periodIds = [...new Set(records.map((r) => r.periodId))];
    const periods = await this.prisma.payrollPeriod.findMany({ where: { orgId, id: { in: periodIds.length ? periodIds : [NIL] } }, select: { id: true, periodStart: true, periodEnd: true } });
    const pmap = new Map(periods.map((p) => [p.id, p]));
    const rows: Cell[][] = records.map((r) => {
      const p = pmap.get(r.periodId);
      return [
        emp.name.get(r.employeeId) ?? "—",
        p ? `${ymd(p.periodStart)} → ${ymd(p.periodEnd)}` : "—",
        r.currencyCode,
        round2(num(r.grossEarnings)),
        round2(num(r.netPayable)),
        r.status,
        ymd(r.calculatedAt),
      ];
    });
    return { kind: "employee-history", title: "Employee Payout History", columns: ["Employee", "Period", "Currency", "Gross", "Net", "Status", "Calculated"], rows };
  }

  // ---- department cost ----
  private async departmentCost(orgId: string, opts: ReportOptions, emp: ScopedEmployees, empFilter: { in: string[] }): Promise<BuiltReport> {
    const periodId = await this.currentPeriodId(orgId, opts);
    const records = await this.prisma.payrollRecord.findMany({ where: this.recordWhere(orgId, opts, empFilter, periodId), select: { employeeId: true, grossEarnings: true, netPayable: true, employerCost: true } });
    const agg = new Map<string, { department: string; headcount: Set<string>; gross: number; net: number; employerCost: number }>();
    for (const r of records) {
      const d = emp.dept.get(r.employeeId) ?? { id: null, name: "Unassigned" };
      const key = d.id ?? "unassigned";
      const b = agg.get(key) ?? { department: d.name, headcount: new Set<string>(), gross: 0, net: 0, employerCost: 0 };
      b.headcount.add(r.employeeId);
      b.gross += num(r.grossEarnings);
      b.net += num(r.netPayable);
      b.employerCost += num(r.employerCost);
      agg.set(key, b);
    }
    const rows: Cell[][] = [...agg.values()]
      .sort((a, b) => b.employerCost - a.employerCost)
      .map((b) => [b.department, b.headcount.size, round2(b.gross), round2(b.net), round2(b.employerCost)]);
    return { kind: "department-cost", title: "Department Cost", columns: ["Department", "Headcount", "Gross", "Net", "Employer Cost"], rows };
  }

  // ---- earnings & deduction summary (per component) ----
  private async earningsDeductions(orgId: string, opts: ReportOptions, empFilter: { in: string[] }): Promise<BuiltReport> {
    const periodId = await this.currentPeriodId(orgId, opts);
    const recs = await this.prisma.payrollRecord.findMany({ where: this.recordWhere(orgId, opts, empFilter, periodId), select: { id: true } });
    const recIds = recs.map((r) => r.id);
    const comps = await this.prisma.payrollRecordComponent.findMany({ where: { orgId, recordId: { in: recIds.length ? recIds : [NIL] } }, select: { code: true, name: true, direction: true, category: true, amount: true } });
    const agg = new Map<string, { name: string; direction: string; category: string; total: number; count: number }>();
    for (const c of comps) {
      const b = agg.get(c.code) ?? { name: c.name, direction: c.direction, category: c.category, total: 0, count: 0 };
      b.total += num(c.amount);
      b.count += 1;
      agg.set(c.code, b);
    }
    const rows: Cell[][] = [...agg.entries()]
      .sort((a, b) => (a[1].direction === b[1].direction ? b[1].total - a[1].total : a[1].direction < b[1].direction ? -1 : 1))
      .map(([code, v]) => [code, v.name, v.direction, v.category, round2(v.total), v.count]);
    return { kind: "earnings-deductions", title: "Earnings & Deduction Summary", columns: ["Code", "Component", "Direction", "Category", "Total", "Lines"], rows };
  }

  // ---- on-hold report ----
  private async onHold(orgId: string, emp: ScopedEmployees, empFilter: { in: string[] }): Promise<BuiltReport> {
    const holds = await this.prisma.payrollHold.findMany({ where: { orgId, active: true, employeeId: empFilter }, orderBy: { createdAt: "desc" }, take: 1000 });
    const rows: Cell[][] = holds.map((h) => [
      h.employeeId ? emp.name.get(h.employeeId) ?? "—" : "—",
      h.reason,
      h.expectedResolution ?? "",
      h.batchId ?? "",
      ymd(h.createdAt),
    ]);
    return { kind: "on-hold", title: "On-Hold Report", columns: ["Employee", "Reason", "Expected Resolution", "Batch", "Held On"], rows };
  }

  // ---- failed payments report ----
  private async failed(orgId: string, emp: ScopedEmployees, empFilter: { in: string[] }): Promise<BuiltReport> {
    const payments = await this.prisma.payrollPayment.findMany({ where: { orgId, status: "FAILED", employeeId: empFilter }, orderBy: { updatedAt: "desc" }, take: 1000 });
    const ids = payments.map((p) => p.id);
    const attempts = await this.prisma.payrollPaymentAttempt.findMany({ where: { orgId, paymentId: { in: ids.length ? ids : [NIL] } }, orderBy: { attemptNo: "desc" }, select: { paymentId: true, error: true } });
    const lastError = new Map<string, string>();
    for (const a of attempts) if (!lastError.has(a.paymentId) && a.error) lastError.set(a.paymentId, a.error);
    const rows: Cell[][] = payments.map((p) => [
      emp.name.get(p.employeeId) ?? "—",
      p.currencyCode,
      round2(num(p.amount)),
      p.method ?? "",
      p.reference ?? "",
      lastError.get(p.id) ?? "",
      ymd(p.updatedAt),
    ]);
    return { kind: "failed", title: "Failed Payments", columns: ["Employee", "Currency", "Amount", "Method", "Reference", "Last Error", "At"], rows };
  }
}
