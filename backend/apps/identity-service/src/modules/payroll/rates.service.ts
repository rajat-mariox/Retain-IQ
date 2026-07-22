import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

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

/** Where a resolved bill rate came from — surfaced so a rate is never a mystery. */
export type BillRateSource = "project_employee" | "project" | "client_employee" | "client" | "employee_default" | "none";

export type ResolvedBillRate = {
  billRateCents: number | null;
  source: BillRateSource;
  /** The BillRate/EmployeeRate row the number came from, for traceability. */
  rateId: string | null;
};

/**
 * Rates: what we pay (cost) and what we charge (bill).
 *
 * Every rate is effective-dated. Rows are never updated in place when a rate
 * changes — the open row is closed (effectiveTo = newFrom - 1 day) and a new
 * open row is appended. Resolution is always "as of" a date, so re-running an
 * old payroll period reproduces the numbers that period was computed with.
 */
@Injectable()
export class RatesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Employee cost rates -------------------------------------------------

  /** Full rate history for an employee, newest first. */
  async listEmployeeRates(employeeId: string) {
    const ctx = requireTenantContext();
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId: ctx.orgId }, select: { id: true } });
    if (!emp) throw new NotFoundException("Employee not found.");
    const rows = await this.prisma.employeeRate.findMany({
      where: { orgId: ctx.orgId, employeeId },
      orderBy: [{ effectiveFrom: "desc" }],
    });
    return rows.map((r) => this.serializeEmployeeRate(r));
  }

  private serializeEmployeeRate(r: {
    id: string;
    employeeId: string;
    costRateCents: number;
    billRateCents: number | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    note: string | null;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      employeeId: r.employeeId,
      costRateCents: r.costRateCents,
      billRateCents: r.billRateCents,
      effectiveFrom: iso(r.effectiveFrom),
      effectiveTo: r.effectiveTo ? iso(r.effectiveTo) : null,
      current: r.effectiveTo === null,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /**
   * Set an employee's rate from a date. Supersedes the current open rate rather
   * than editing it: the old row is closed the day before `effectiveFrom`, so
   * history stays intact and past payroll stays reproducible.
   */
  async setEmployeeRate(input: { employeeId: string; costRateCents: number; billRateCents?: number | null; effectiveFrom?: string; note?: string }) {
    const ctx = requireTenantContext();
    const emp = await this.prisma.employee.findFirst({ where: { id: input.employeeId, orgId: ctx.orgId }, select: { id: true } });
    if (!emp) throw new NotFoundException("Employee not found.");

    const from = input.effectiveFrom ? parseDate(input.effectiveFrom) : today();

    return this.prisma.$transaction(async (tx) => {
      const open = await tx.employeeRate.findFirst({ where: { orgId: ctx.orgId, employeeId: input.employeeId, effectiveTo: null } });
      if (open) {
        if (from <= open.effectiveFrom) {
          throw new ConflictException(`A rate already starts on ${iso(open.effectiveFrom)}. The new rate must start after it.`);
        }
        await tx.employeeRate.update({ where: { id: open.id }, data: { effectiveTo: addDays(from, -1) } });
      }
      const created = await tx.employeeRate.create({
        data: {
          orgId: ctx.orgId,
          employeeId: input.employeeId,
          costRateCents: input.costRateCents,
          billRateCents: input.billRateCents ?? null,
          effectiveFrom: from,
          note: input.note?.trim() || null,
          createdBy: ctx.userId,
        },
      });
      return this.serializeEmployeeRate(created);
    });
  }

  // ---- Bill rate overrides -------------------------------------------------

  async listBillRates(query: { clientId?: string; projectId?: string }) {
    const ctx = requireTenantContext();
    const where: Record<string, unknown> = { orgId: ctx.orgId };
    if (query.clientId) where.clientId = query.clientId;
    if (query.projectId) where.projectId = query.projectId;

    const rows = await this.prisma.billRate.findMany({
      where,
      orderBy: [{ effectiveFrom: "desc" }],
      include: {
        client: { select: { name: true } },
        project: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      clientName: r.client?.name ?? null,
      projectId: r.projectId,
      projectName: r.project?.name ?? null,
      employeeId: r.employeeId,
      employeeName: r.employee ? `${r.employee.firstName} ${r.employee.lastName}`.trim() : null,
      billRateCents: r.billRateCents,
      effectiveFrom: iso(r.effectiveFrom),
      effectiveTo: r.effectiveTo ? iso(r.effectiveTo) : null,
      current: r.effectiveTo === null,
      scope: r.projectId ? (r.employeeId ? "project_employee" : "project") : r.employeeId ? "client_employee" : "client",
      note: r.note,
    }));
  }

  /**
   * Add a charge-out override. Anchors to exactly one of client or project
   * (an employee-only default belongs on EmployeeRate.billRateCents); an
   * optional employeeId narrows it to one person on that client/project.
   */
  async setBillRate(input: {
    clientId?: string | null;
    projectId?: string | null;
    employeeId?: string | null;
    billRateCents: number;
    effectiveFrom?: string;
    note?: string;
  }) {
    const ctx = requireTenantContext();
    const anchors = [input.clientId, input.projectId].filter(Boolean).length;
    if (anchors !== 1) throw new BadRequestException("Provide exactly one of clientId or projectId.");

    if (input.clientId) {
      const c = await this.prisma.client.findFirst({ where: { id: input.clientId, orgId: ctx.orgId }, select: { id: true } });
      if (!c) throw new NotFoundException("Client not found.");
    }
    if (input.projectId) {
      const p = await this.prisma.project.findFirst({ where: { id: input.projectId, orgId: ctx.orgId }, select: { id: true } });
      if (!p) throw new NotFoundException("Project not found.");
    }
    if (input.employeeId) {
      const e = await this.prisma.employee.findFirst({ where: { id: input.employeeId, orgId: ctx.orgId }, select: { id: true } });
      if (!e) throw new NotFoundException("Employee not found.");
    }

    const from = input.effectiveFrom ? parseDate(input.effectiveFrom) : today();

    return this.prisma.$transaction(async (tx) => {
      // Supersede the open rate at the *same* scope, so overrides layer rather
      // than collide (a project rate never closes a client rate).
      const open = await tx.billRate.findFirst({
        where: {
          orgId: ctx.orgId,
          clientId: input.clientId ?? null,
          projectId: input.projectId ?? null,
          employeeId: input.employeeId ?? null,
          effectiveTo: null,
        },
      });
      if (open) {
        if (from <= open.effectiveFrom) {
          throw new ConflictException(`A rate at this scope already starts on ${iso(open.effectiveFrom)}. The new rate must start after it.`);
        }
        await tx.billRate.update({ where: { id: open.id }, data: { effectiveTo: addDays(from, -1) } });
      }
      return tx.billRate.create({
        data: {
          orgId: ctx.orgId,
          clientId: input.clientId ?? null,
          projectId: input.projectId ?? null,
          employeeId: input.employeeId ?? null,
          billRateCents: input.billRateCents,
          effectiveFrom: from,
          note: input.note?.trim() || null,
        },
      });
    });
  }

  // ---- Resolution ----------------------------------------------------------

  /** The employee's cost rate in effect on `on`, or null if none was set then. */
  async resolveCostRate(employeeId: string, on: Date): Promise<{ costRateCents: number | null; rateId: string | null }> {
    const ctx = requireTenantContext();
    const row = await this.prisma.employeeRate.findFirst({
      where: {
        orgId: ctx.orgId,
        employeeId,
        effectiveFrom: { lte: on },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    return { costRateCents: row?.costRateCents ?? null, rateId: row?.id ?? null };
  }

  /**
   * The charge-out rate for (employee, project) on a date, most-specific first:
   *   project+employee → project → client+employee → client → employee default
   * Returns which rung matched so the UI can explain the number.
   */
  async resolveBillRate(employeeId: string, projectId: string | null, on: Date): Promise<ResolvedBillRate> {
    const ctx = requireTenantContext();

    const clientId = projectId
      ? (await this.prisma.project.findFirst({ where: { id: projectId, orgId: ctx.orgId }, select: { clientId: true } }))?.clientId ?? null
      : null;

    const effective = { effectiveFrom: { lte: on }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }] };
    const ladder: { where: Record<string, unknown>; source: BillRateSource }[] = [];
    if (projectId) {
      ladder.push({ where: { orgId: ctx.orgId, projectId, employeeId, ...effective }, source: "project_employee" });
      ladder.push({ where: { orgId: ctx.orgId, projectId, employeeId: null, ...effective }, source: "project" });
    }
    if (clientId) {
      ladder.push({ where: { orgId: ctx.orgId, clientId, employeeId, ...effective }, source: "client_employee" });
      ladder.push({ where: { orgId: ctx.orgId, clientId, employeeId: null, ...effective }, source: "client" });
    }

    for (const rung of ladder) {
      const hit = await this.prisma.billRate.findFirst({ where: rung.where, orderBy: { effectiveFrom: "desc" } });
      if (hit) return { billRateCents: hit.billRateCents, source: rung.source, rateId: hit.id };
    }

    // Fall back to the employee's own default charge-out rate.
    const emp = await this.prisma.employeeRate.findFirst({
      where: { orgId: ctx.orgId, employeeId, effectiveFrom: { lte: on }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }] },
      orderBy: { effectiveFrom: "desc" },
    });
    if (emp?.billRateCents != null) return { billRateCents: emp.billRateCents, source: "employee_default", rateId: emp.id };

    return { billRateCents: null, source: "none", rateId: null };
  }

  /**
   * Explain a rate without running payroll: what would this person, on this
   * project, on this date, cost and bill — and why. The debugging surface for
   * "why is this invoice line $150?".
   */
  async preview(input: { employeeId: string; projectId?: string | null; on?: string }) {
    const ctx = requireTenantContext();
    const emp = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, orgId: ctx.orgId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!emp) throw new NotFoundException("Employee not found.");
    const on = input.on ? parseDate(input.on) : today();

    const [cost, bill, setting] = await Promise.all([
      this.resolveCostRate(input.employeeId, on),
      this.resolveBillRate(input.employeeId, input.projectId ?? null, on),
      this.getSettings(),
    ]);

    const project = input.projectId
      ? await this.prisma.project.findFirst({
          where: { id: input.projectId, orgId: ctx.orgId },
          select: { name: true, client: { select: { name: true } } },
        })
      : null;

    return {
      employeeId: emp.id,
      employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
      projectId: input.projectId ?? null,
      projectName: project?.name ?? null,
      clientName: project?.client?.name ?? null,
      on: iso(on),
      currency: setting.currency,
      costRateCents: cost.costRateCents,
      billRateCents: bill.billRateCents,
      billRateSource: bill.source,
      /** bill - cost, per hour. Negative means the work is sold below cost. */
      marginCents: cost.costRateCents != null && bill.billRateCents != null ? bill.billRateCents - cost.costRateCents : null,
    };
  }

  // ---- Settings ------------------------------------------------------------

  /** The org's payroll rules, created with defaults on first read. */
  async getSettings() {
    const ctx = requireTenantContext();
    const existing = await this.prisma.payrollSetting.findUnique({ where: { orgId: ctx.orgId } });
    if (existing) return existing;
    return this.prisma.payrollSetting.create({ data: { orgId: ctx.orgId } });
  }

  async updateSettings(input: {
    currency?: string;
    overtimeAfterMins?: number;
    overtimeMultiplier?: number;
    cycleFrequency?: "WEEKLY" | "BIWEEKLY" | "MONTHLY";
    invoicePrefix?: string;
    requireApproval?: boolean;
  }) {
    const ctx = requireTenantContext();
    await this.getSettings(); // ensure the row exists
    return this.prisma.payrollSetting.update({ where: { orgId: ctx.orgId }, data: input });
  }
}
