import { BadRequestException, Injectable } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OrgRolesService } from "../../common/org-roles/org-roles.service.js";
import { RatesService } from "./rates.service.js";

function parseDate(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid date.");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
const today = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

/** RFC-4180-ish CSV: quote every field, double inner quotes. */
function csv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
}
const hours = (m: number) => (m / 60).toFixed(2);
const dollars = (c: number) => (c / 100).toFixed(2);

/**
 * Payroll dashboard, reports and exports — all read-only aggregation over
 * timesheets, payroll cycles and invoices. Nothing here computes money it
 * doesn't already find persisted, so a report can never disagree with the run
 * it reports on.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RatesService,
    private readonly orgRoles: OrgRolesService,
  ) {}

  /** Spec §1 — the Payroll & Timesheets dashboard. */
  async dashboard() {
    const ctx = requireTenantContext();
    const settings = await this.rates.getSettings();
    const now = today();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

    // The Owner isn't staff: keep them out of headcount, hours and the
    // "missing a pay rate" gap, or they read as someone payroll forgot.
    const excluded = await this.orgRoles.ownerEmployeeIds(ctx.orgId);
    const notOwner = excluded.length > 0 ? { employeeId: { notIn: excluded } } : {};

    const [employeeCount, pendingSheets, approvedSheets, monthEntries, cycles, invoices, ratedEmployees] = await Promise.all([
      this.prisma.employee.count({ where: { orgId: ctx.orgId, status: "ACTIVE", ...(excluded.length > 0 ? { id: { notIn: excluded } } : {}) } }),
      this.prisma.timesheet.count({ where: { orgId: ctx.orgId, status: "SUBMITTED", ...notOwner } }),
      this.prisma.timesheet.count({ where: { orgId: ctx.orgId, status: "APPROVED", ...notOwner } }),
      this.prisma.timeEntry.findMany({
        where: { orgId: ctx.orgId, date: { gte: monthStart, lte: monthEnd }, ...notOwner },
        select: { minutes: true, billable: true },
      }),
      this.prisma.payrollCycle.findMany({
        where: { orgId: ctx.orgId },
        orderBy: { periodStart: "desc" },
        take: 6,
        include: { lines: { select: { grossPayCents: true } } },
      }),
      this.prisma.clientInvoice.findMany({ where: { orgId: ctx.orgId }, select: { status: true, totalCents: true } }),
      this.prisma.employeeRate.findMany({ where: { orgId: ctx.orgId, effectiveTo: null }, select: { employeeId: true }, distinct: ["employeeId"] }),
    ]);

    const totalMinutes = monthEntries.reduce((s, e) => s + e.minutes, 0);
    const billableMinutes = monthEntries.reduce((s, e) => s + (e.billable ? e.minutes : 0), 0);

    const lastCycle = cycles[0];
    const outstanding = invoices.filter((i) => i.status === "SENT").reduce((s, i) => s + i.totalCents, 0);
    const collected = invoices.filter((i) => i.status === "PAID").reduce((s, i) => s + i.totalCents, 0);

    // The gap that silently breaks payroll: people with hours but no rate.
    const rated = new Set(ratedEmployees.map((r) => r.employeeId));
    const withHours = await this.prisma.timeEntry.findMany({
      where: { orgId: ctx.orgId, date: { gte: addDays(now, -90) }, ...notOwner },
      select: { employeeId: true },
      distinct: ["employeeId"],
    });
    const missingRates = withHours.filter((e) => !rated.has(e.employeeId)).length;

    return {
      currency: settings.currency,
      month: iso(monthStart).slice(0, 7),
      employeeCount,
      pendingTimesheets: pendingSheets,
      approvedTimesheets: approvedSheets,
      totalWorkMinutes: totalMinutes,
      totalBillableMinutes: billableMinutes,
      utilization: totalMinutes > 0 ? Math.round((billableMinutes / totalMinutes) * 100) : 0,
      missingRates,
      payroll: {
        lastCycle: lastCycle
          ? {
              id: lastCycle.id,
              periodStart: iso(lastCycle.periodStart),
              periodEnd: iso(lastCycle.periodEnd),
              status: lastCycle.status,
              grossPayCents: lastCycle.lines.reduce((s, l) => s + l.grossPayCents, 0),
            }
          : null,
        // "Upcoming cycle" per the org's configured frequency, from the last
        // period's end — or this month if payroll has never been run.
        upcoming: lastCycle ? { periodStart: iso(addDays(lastCycle.periodEnd, 1)), frequency: settings.cycleFrequency } : { periodStart: iso(monthStart), frequency: settings.cycleFrequency },
        recent: cycles.map((c) => ({
          id: c.id,
          periodStart: iso(c.periodStart),
          periodEnd: iso(c.periodEnd),
          status: c.status,
          grossPayCents: c.lines.reduce((s, l) => s + l.grossPayCents, 0),
        })),
      },
      invoices: {
        draft: invoices.filter((i) => i.status === "DRAFT").length,
        sent: invoices.filter((i) => i.status === "SENT").length,
        outstandingCents: outstanding,
        collectedCents: collected,
      },
    };
  }

  /** Spec §6 — payroll history + per-employee/work-hour/overtime rollups. */
  async payrollReport(query: { from?: string; to?: string }) {
    const ctx = requireTenantContext();
    const settings = await this.rates.getSettings();
    const to = query.to ? parseDate(query.to) : today();
    const from = query.from ? parseDate(query.from) : addDays(to, -179);
    if (to < from) throw new BadRequestException("The end date must be on or after the start date.");

    const cycles = await this.prisma.payrollCycle.findMany({
      where: { orgId: ctx.orgId, periodStart: { lte: to }, periodEnd: { gte: from } },
      orderBy: { periodStart: "desc" },
      include: { lines: { include: { employee: { select: { firstName: true, lastName: true } } } } },
    });

    // Per-employee totals across every cycle in range.
    const byEmployee = new Map<string, { employeeId: string; employeeName: string; regularMinutes: number; overtimeMinutes: number; grossPayCents: number; cycles: number }>();
    for (const c of cycles) {
      for (const l of c.lines) {
        const cur = byEmployee.get(l.employeeId) ?? {
          employeeId: l.employeeId,
          employeeName: `${l.employee.firstName} ${l.employee.lastName}`.trim(),
          regularMinutes: 0,
          overtimeMinutes: 0,
          grossPayCents: 0,
          cycles: 0,
        };
        cur.regularMinutes += l.regularMinutes;
        cur.overtimeMinutes += l.overtimeMinutes;
        cur.grossPayCents += l.grossPayCents;
        cur.cycles += 1;
        byEmployee.set(l.employeeId, cur);
      }
    }

    const employees = [...byEmployee.values()].sort((a, b) => b.grossPayCents - a.grossPayCents);
    return {
      from: iso(from),
      to: iso(to),
      currency: settings.currency,
      totals: {
        cycleCount: cycles.length,
        employeeCount: employees.length,
        regularMinutes: employees.reduce((s, e) => s + e.regularMinutes, 0),
        overtimeMinutes: employees.reduce((s, e) => s + e.overtimeMinutes, 0),
        grossPayCents: employees.reduce((s, e) => s + e.grossPayCents, 0),
      },
      employees,
      history: cycles.map((c) => ({
        id: c.id,
        periodStart: iso(c.periodStart),
        periodEnd: iso(c.periodEnd),
        status: c.status,
        employeeCount: c.lines.length,
        regularMinutes: c.lines.reduce((s, l) => s + l.regularMinutes, 0),
        overtimeMinutes: c.lines.reduce((s, l) => s + l.overtimeMinutes, 0),
        grossPayCents: c.lines.reduce((s, l) => s + l.grossPayCents, 0),
      })),
    };
  }

  // ---- Spec §8: exports ----------------------------------------------------

  /**
   * CSV for one of the module's datasets. CSV over PDF deliberately: it's what
   * an accountant actually imports, and it needs no dependency.
   */
  /** The export as a { baseName, columns, rows } table — rendered to CSV or xlsx by the controller. */
  async exportTable(kind: "payroll" | "timesheets" | "billable" | "invoices", query: { from?: string; to?: string; cycleId?: string }) {
    const ctx = requireTenantContext();
    const to = query.to ? parseDate(query.to) : today();
    const from = query.from ? parseDate(query.from) : addDays(to, -29);
    const endExclusive = addDays(to, 1);

    if (kind === "payroll") {
      const where = query.cycleId ? { orgId: ctx.orgId, id: query.cycleId } : { orgId: ctx.orgId, periodStart: { lte: to }, periodEnd: { gte: from } };
      const cycles = await this.prisma.payrollCycle.findMany({
        where,
        orderBy: { periodStart: "desc" },
        include: { lines: { include: { employee: { select: { firstName: true, lastName: true, email: true } } } } },
      });
      const rows: (string | number)[][] = [["Period start", "Period end", "Status", "Employee", "Email", "Regular hours", "Overtime hours", "Rate", "Regular pay", "Overtime pay", "Gross pay", "Currency"]];
      for (const c of cycles) {
        for (const l of c.lines) {
          rows.push([
            iso(c.periodStart),
            iso(c.periodEnd),
            c.status,
            `${l.employee.firstName} ${l.employee.lastName}`.trim(),
            l.employee.email ?? "",
            hours(l.regularMinutes),
            hours(l.overtimeMinutes),
            dollars(l.costRateCents),
            dollars(l.regularPayCents),
            dollars(l.overtimePayCents),
            dollars(l.grossPayCents),
            c.currency,
          ]);
        }
      }
      return { baseName: `payroll-${iso(from)}-to-${iso(to)}`, columns: rows[0]!.map(String), rows: rows.slice(1) };
    }

    if (kind === "timesheets") {
      const sheets = await this.prisma.timesheet.findMany({
        where: { orgId: ctx.orgId, weekStart: { gte: from, lt: endExclusive } },
        orderBy: { weekStart: "desc" },
        include: { employee: { select: { firstName: true, lastName: true, email: true } } },
      });
      const rows: (string | number)[][] = [["Week start", "Employee", "Email", "Status", "Total hours", "Submitted", "Decided", "Note"]];
      for (const t of sheets) {
        rows.push([
          iso(t.weekStart),
          `${t.employee.firstName} ${t.employee.lastName}`.trim(),
          t.employee.email ?? "",
          t.status,
          hours(t.totalMinutes),
          t.submittedAt ? t.submittedAt.toISOString().slice(0, 10) : "",
          t.decidedAt ? t.decidedAt.toISOString().slice(0, 10) : "",
          t.note ?? "",
        ]);
      }
      return { baseName: `timesheets-${iso(from)}-to-${iso(to)}`, columns: rows[0]!.map(String), rows: rows.slice(1) };
    }

    if (kind === "billable") {
      const entries = await this.prisma.timeEntry.findMany({
        where: { orgId: ctx.orgId, date: { gte: from, lt: endExclusive } },
        orderBy: { date: "asc" },
        include: {
          employee: { select: { firstName: true, lastName: true } },
          project: { select: { name: true, client: { select: { name: true } }, team: { select: { name: true } } } },
        },
      });
      const rows: (string | number)[][] = [["Date", "Employee", "Project", "Client", "Team", "Billable", "Hours", "Description"]];
      for (const e of entries) {
        rows.push([
          iso(e.date),
          `${e.employee.firstName} ${e.employee.lastName}`.trim(),
          e.project?.name ?? "",
          e.project?.client?.name ?? "",
          e.project?.team?.name ?? "",
          e.billable ? "Yes" : "No",
          hours(e.minutes),
          e.description ?? "",
        ]);
      }
      return { baseName: `billable-hours-${iso(from)}-to-${iso(to)}`, columns: rows[0]!.map(String), rows: rows.slice(1) };
    }

    // invoices
    const invoices = await this.prisma.clientInvoice.findMany({
      where: { orgId: ctx.orgId, periodStart: { lte: to }, periodEnd: { gte: from } },
      orderBy: { createdAt: "desc" },
      include: { client: { select: { name: true } }, lines: true },
    });
    const rows: (string | number)[][] = [["Invoice", "Client", "Status", "Period start", "Period end", "Line", "Hours", "Rate", "Amount", "Invoice total", "Currency"]];
    for (const i of invoices) {
      for (const l of i.lines) {
        rows.push([
          i.invoiceNumber,
          i.client.name,
          i.status,
          iso(i.periodStart),
          iso(i.periodEnd),
          l.description,
          hours(l.minutes),
          dollars(l.billRateCents),
          dollars(l.amountCents),
          dollars(i.totalCents),
          i.currency,
        ]);
      }
    }
    return { baseName: `invoices-${iso(from)}-to-${iso(to)}`, columns: rows[0]!.map(String), rows: rows.slice(1) };
  }

  /** Back-compat CSV wrapper (used by the scheduled/summary paths). */
  async exportCsv(kind: "payroll" | "timesheets" | "billable" | "invoices", query: { from?: string; to?: string; cycleId?: string }) {
    const t = await this.exportTable(kind, query);
    return { filename: `${t.baseName}.csv`, body: csv([t.columns, ...t.rows]) };
  }
}
