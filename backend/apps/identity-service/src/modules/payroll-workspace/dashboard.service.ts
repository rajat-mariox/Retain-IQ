import { Injectable } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { OrgRolesService } from "../../common/org-roles/org-roles.service.js";

const NIL = "00000000-0000-0000-0000-000000000000";
const num = (x: Prisma.Decimal | number | null | undefined): number => (x == null ? 0 : Number(x));
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Payout dashboard aggregates (§6). Everything is scoped two ways: the Owner is
 * excluded (they are not staff, so never payroll-eligible), and the caller's ABAC
 * reach clamps which employees' payroll they can total (a department manager sees
 * only their department's cost; an org-wide finance role sees everything). All
 * money is returned as plain numbers converted from Decimal at the edge.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly orgRoles: OrgRolesService,
  ) {}

  async summary() {
    const { orgId, userId } = requireTenantContext();

    // Payroll-eligible, scoped, owner-excluded employees (with department for cost split).
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.payrollDashboardRead);
    const notOwner = await this.orgRoles.notOwnerIdFilter(orgId);
    const employees = await this.prisma.employee.findMany({
      where: { orgId, status: "ACTIVE", ...this.accessScope.employeeWhere(scope), ...notOwner },
      select: { id: true, firstName: true, lastName: true, departmentId: true, departmentRef: { select: { name: true } } },
    });
    const empIds = employees.map((e) => e.id);
    const empDept = new Map(employees.map((e) => [e.id, { id: e.departmentId, name: e.departmentRef?.name ?? "Unassigned" }]));
    const empName = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));

    // Current period: newest not-yet-closed, else the newest overall.
    const currentPeriod =
      (await this.prisma.payrollPeriod.findFirst({ where: { orgId, status: { not: "CLOSED" } }, orderBy: { periodStart: "desc" } })) ??
      (await this.prisma.payrollPeriod.findFirst({ where: { orgId }, orderBy: { periodStart: "desc" } }));

    const empFilter = { in: empIds.length ? empIds : [NIL] };

    // Empty scope / no period → zeroed shell (still a valid dashboard).
    if (empIds.length === 0 || !currentPeriod) {
      return {
        period: currentPeriod
          ? { id: currentPeriod.id, start: currentPeriod.periodStart.toISOString().slice(0, 10), end: currentPeriod.periodEnd.toISOString().slice(0, 10), status: currentPeriod.status }
          : null,
        eligibleEmployees: empIds.length,
        totals: { gross: 0, deductions: 0, tax: 0, net: 0, employerCost: 0, employeeCount: 0 },
        pendingApprovals: 0,
        onHold: 0,
        failedPayments: 0,
        recordStatusDistribution: {},
        batchStatusDistribution: {},
        paymentStatusDistribution: {},
        departmentCost: [],
        recentActivity: [],
      };
    }

    const recordWhere: Prisma.PayrollRecordWhereInput = { orgId, periodId: currentPeriod.id, employeeId: empFilter };

    const [agg, records, pendingApprovals, onHold, failedPayments, paymentGroups, recent] = await Promise.all([
      this.prisma.payrollRecord.aggregate({
        where: recordWhere,
        _sum: { grossEarnings: true, preTaxDeductions: true, postTaxDeductions: true, taxDeduction: true, employeeStatutory: true, netPayable: true, employerCost: true },
        _count: { _all: true },
      }),
      this.prisma.payrollRecord.findMany({ where: recordWhere, select: { employeeId: true, status: true, netPayable: true, employerCost: true } }),
      this.prisma.payrollRecord.count({ where: { ...recordWhere, status: "PENDING_APPROVAL" } }),
      this.prisma.payrollRecord.count({ where: { ...recordWhere, status: "ON_HOLD" } }),
      this.prisma.payrollPayment.count({ where: { orgId, status: "FAILED", employeeId: empFilter } }),
      this.prisma.payrollPayment.groupBy({ by: ["status"], where: { orgId, employeeId: empFilter }, _count: { _all: true } }),
      this.prisma.payrollRecord.findMany({ where: recordWhere, orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, employeeId: true, status: true, netPayable: true, updatedAt: true } }),
    ]);

    const deductions = num(agg._sum.preTaxDeductions) + num(agg._sum.postTaxDeductions) + num(agg._sum.taxDeduction) + num(agg._sum.employeeStatutory);

    // Record-status distribution (inherently scoped — derived from the scoped set).
    const recordStatusDistribution: Record<string, number> = {};
    for (const r of records) recordStatusDistribution[r.status] = (recordStatusDistribution[r.status] ?? 0) + 1;

    // Batch-status distribution is org-level; only surfaced to an org-wide viewer.
    let batchStatusDistribution: Record<string, number> = {};
    if (scope.tier === "org") {
      const bg = await this.prisma.payrollBatch.groupBy({ by: ["status"], where: { orgId, periodId: currentPeriod.id }, _count: { _all: true } });
      batchStatusDistribution = Object.fromEntries(bg.map((g) => [g.status, g._count._all]));
    }

    const paymentStatusDistribution = Object.fromEntries(paymentGroups.map((g) => [g.status, g._count._all]));

    // Department-wise cost (net + employer cost), from the scoped records.
    const deptAgg = new Map<string, { departmentId: string | null; department: string; net: number; employerCost: number; headcount: Set<string> }>();
    for (const r of records) {
      const d = empDept.get(r.employeeId) ?? { id: null, name: "Unassigned" };
      const key = d.id ?? "unassigned";
      const bucket = deptAgg.get(key) ?? { departmentId: d.id, department: d.name, net: 0, employerCost: 0, headcount: new Set<string>() };
      bucket.net += num(r.netPayable);
      bucket.employerCost += num(r.employerCost);
      bucket.headcount.add(r.employeeId);
      deptAgg.set(key, bucket);
    }
    const departmentCost = [...deptAgg.values()]
      .map((b) => ({ departmentId: b.departmentId, department: b.department, headcount: b.headcount.size, net: round2(b.net), employerCost: round2(b.employerCost) }))
      .sort((a, b) => b.employerCost - a.employerCost);

    const recentActivity = recent.map((r) => ({
      recordId: r.id,
      employeeId: r.employeeId,
      employeeName: empName.get(r.employeeId) ?? "—",
      status: r.status,
      net: num(r.netPayable),
      at: r.updatedAt.toISOString(),
    }));

    return {
      period: { id: currentPeriod.id, start: currentPeriod.periodStart.toISOString().slice(0, 10), end: currentPeriod.periodEnd.toISOString().slice(0, 10), status: currentPeriod.status },
      eligibleEmployees: empIds.length,
      totals: {
        gross: round2(num(agg._sum.grossEarnings)),
        deductions: round2(deductions),
        tax: round2(num(agg._sum.taxDeduction)),
        net: round2(num(agg._sum.netPayable)),
        employerCost: round2(num(agg._sum.employerCost)),
        employeeCount: agg._count._all,
      },
      pendingApprovals,
      onHold,
      failedPayments,
      recordStatusDistribution,
      batchStatusDistribution,
      paymentStatusDistribution,
      departmentCost,
      recentActivity,
    };
  }
}
