import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { AuditService } from "../../common/audit/audit.service.js";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";

export type OvertimeDayType = "WEEKDAY" | "WEEKEND" | "HOLIDAY" | "NIGHT";
type ResolvedMode = "PAID" | "COMP_OFF" | "PENDING_CHOICE";

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Fallback OT rate multipliers by day type when the caller doesn't supply one. */
const DEFAULT_MULTIPLIER: Record<OvertimeDayType, number> = {
  WEEKDAY: 1.5,
  WEEKEND: 2,
  HOLIDAY: 2,
  NIGHT: 1.5,
};

/**
 * Overtime & comp-off (§14).
 *
 * Recording overtime resolves the employee's org OT policy from their effective
 * PayrollProfileVersion.overtimePolicyMode and acts on it:
 *  - PAID_OVERTIME → mode PAID: amount = hours × hourly-rate × multiplier. The
 *    figure is an earning the payroll batch later picks up.
 *  - COMP_OFF → mode COMP_OFF: no earning; a PayrollCompOff EARNED ledger entry is
 *    written instead (time off in lieu).
 *  - EMPLOYEE_CHOICE → the record is parked as PENDING_CHOICE until the employee
 *    picks paid or comp-off (resolved via `chooseMode`).
 *  - MIXED_POLICY → resolved per day type (rest-day/holiday work is paid, ordinary
 *    weekday/night overtime accrues comp-off).
 *  - NOT_APPLICABLE → rejected: this employee's policy does not recognise overtime.
 *
 * Comp-off balance is the sum of ledger deltaMinutes that have not lapsed.
 * Recording/approving overtime requires payroll.overtime.approve; balances are read
 * under payroll.record.read and scoped to the caller's reach.
 */
@Injectable()
export class OvertimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly accessScope: AccessScopeService,
  ) {}

  /**
   * Record (and, since only an approver may call this, approve) a block of
   * overtime for an employee on a given day.
   */
  async record(input: { employeeId: string; workDate: string; hours: number; dayType: OvertimeDayType; multiplier?: number; note?: string }) {
    const ctx = requireTenantContext();
    await this.assertEmployeeInOrg(ctx.orgId, input.employeeId);

    const workDate = startOfUtcDay(new Date(`${input.workDate}T00:00:00.000Z`));
    if (Number.isNaN(workDate.getTime())) throw new BadRequestException("Invalid work date.");
    if (workDate.getTime() > startOfUtcDay(new Date()).getTime()) {
      throw new BadRequestException("You can't record overtime for a future date.");
    }

    const version = await this.effectiveProfileVersion(ctx.orgId, input.employeeId, workDate);
    const policy = this.readPolicy(version.compOffPolicy);
    const resolved = this.resolveMode(version.overtimePolicyMode, input.dayType);

    const hours = new Prisma.Decimal(input.hours);
    let multiplier: Prisma.Decimal | null = null;
    let amount = new Prisma.Decimal(0);
    let deltaMinutes = 0;

    if (resolved === "PAID") {
      multiplier = new Prisma.Decimal(input.multiplier ?? DEFAULT_MULTIPLIER[input.dayType]);
      amount = this.paidAmount(version, hours, multiplier, policy);
    } else if (resolved === "COMP_OFF") {
      deltaMinutes = Math.round(input.hours * 60);
    }
    // PENDING_CHOICE: no amount, no ledger entry yet.

    const expiresAt = resolved === "COMP_OFF" ? this.compOffExpiry(policy) : null;

    const overtime = await this.prisma.$transaction(async (tx) => {
      const ot = await tx.payrollOvertime.create({
        data: {
          orgId: ctx.orgId,
          employeeId: input.employeeId,
          workDate,
          hours,
          dayType: input.dayType,
          mode: resolved,
          multiplier,
          amount,
          approvedBy: ctx.userId,
        },
      });
      if (resolved === "COMP_OFF") {
        await tx.payrollCompOff.create({
          data: {
            orgId: ctx.orgId,
            employeeId: input.employeeId,
            deltaMinutes,
            entryType: "EARNED",
            source: "OVERTIME",
            sourceRef: ot.id,
            expiresAt,
            note: input.note?.trim() || null,
          },
        });
      }
      await this.outbox.enqueue(tx, {
        eventType: "payroll.overtime.recorded",
        aggregateType: "payroll_overtime",
        aggregateId: ot.id,
        orgId: ctx.orgId,
        payload: {
          employeeId: input.employeeId,
          workDate: workDate.toISOString().slice(0, 10),
          hours: Number(hours),
          dayType: input.dayType,
          mode: resolved,
          amount: Number(amount),
          compOffMinutes: deltaMinutes,
        },
      });
      return ot;
    });

    await this.audit.record({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      resourceType: "payroll_overtime",
      resourceId: overtime.id,
      action: "payroll.overtime.recorded",
      after: { employeeId: input.employeeId, mode: resolved, amount: Number(amount), compOffMinutes: deltaMinutes },
    });

    return this.serializeOvertime(overtime, deltaMinutes);
  }

  /**
   * Resolve an EMPLOYEE_CHOICE overtime record once the employee decides between
   * paid overtime and comp-off. Only a PENDING_CHOICE record can be resolved.
   */
  async chooseMode(id: string, choice: "PAID" | "COMP_OFF") {
    const ctx = requireTenantContext();
    const ot = await this.prisma.payrollOvertime.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!ot) throw new NotFoundException("Overtime record not found.");
    if (ot.mode !== "PENDING_CHOICE") throw new BadRequestException("This overtime record has already been resolved.");
    if (ot.batchId) throw new BadRequestException("This overtime has already been consumed by a payroll batch.");

    const workDate = startOfUtcDay(ot.workDate);
    const version = await this.effectiveProfileVersion(ctx.orgId, ot.employeeId, workDate);
    const policy = this.readPolicy(version.compOffPolicy);

    let multiplier: Prisma.Decimal | null = null;
    let amount = new Prisma.Decimal(0);
    let deltaMinutes = 0;
    if (choice === "PAID") {
      multiplier = new Prisma.Decimal(DEFAULT_MULTIPLIER[(ot.dayType as OvertimeDayType) ?? "WEEKDAY"] ?? 1.5);
      amount = this.paidAmount(version, ot.hours, multiplier, policy);
    } else {
      deltaMinutes = Math.round(Number(ot.hours) * 60);
    }
    const expiresAt = choice === "COMP_OFF" ? this.compOffExpiry(policy) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.payrollOvertime.update({
        where: { id },
        data: { mode: choice, multiplier, amount, approvedBy: ctx.userId },
      });
      if (choice === "COMP_OFF") {
        await tx.payrollCompOff.create({
          data: {
            orgId: ctx.orgId,
            employeeId: ot.employeeId,
            deltaMinutes,
            entryType: "EARNED",
            source: "OVERTIME",
            sourceRef: ot.id,
            expiresAt,
          },
        });
      }
      await this.outbox.enqueue(tx, {
        eventType: "payroll.overtime.resolved",
        aggregateType: "payroll_overtime",
        aggregateId: ot.id,
        orgId: ctx.orgId,
        payload: { employeeId: ot.employeeId, mode: choice, amount: Number(amount), compOffMinutes: deltaMinutes },
      });
      return u;
    });

    await this.audit.record({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      resourceType: "payroll_overtime",
      resourceId: ot.id,
      action: "payroll.overtime.resolved",
      before: { mode: "PENDING_CHOICE" },
      after: { mode: choice, amount: Number(amount), compOffMinutes: deltaMinutes },
    });

    return this.serializeOvertime(updated, deltaMinutes);
  }

  /**
   * The employee's comp-off balance and ledger. Balance is the sum of deltaMinutes
   * across entries that have not lapsed (no expiry, or expiring in the future).
   */
  async compOff(employeeId: string) {
    const ctx = requireTenantContext();
    const scope = await this.accessScope.resolveScope(ctx.orgId, ctx.userId, "payroll.record.read");
    const visible = await this.accessScope.visibleEmployeeIds(ctx.orgId, scope);
    if (visible !== null && !visible.includes(employeeId)) {
      throw new ForbiddenException("That employee is outside your access scope.");
    }
    await this.assertEmployeeInOrg(ctx.orgId, employeeId);

    const now = new Date();
    const entries = await this.prisma.payrollCompOff.findMany({
      where: { orgId: ctx.orgId, employeeId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const active = entries.filter((e) => e.expiresAt === null || e.expiresAt > now);
    const balanceMinutes = active.reduce((sum, e) => sum + e.deltaMinutes, 0);

    return {
      employeeId,
      balanceMinutes,
      balanceHours: Math.round((balanceMinutes / 60) * 100) / 100,
      entries: entries.map((e) => ({
        id: e.id,
        deltaMinutes: e.deltaMinutes,
        entryType: e.entryType,
        source: e.source,
        sourceRef: e.sourceRef,
        expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
        expired: e.expiresAt !== null && e.expiresAt <= now,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  // ---- helpers ----

  private resolveMode(policyMode: string, dayType: OvertimeDayType): ResolvedMode {
    switch (policyMode) {
      case "PAID_OVERTIME":
        return "PAID";
      case "COMP_OFF":
        return "COMP_OFF";
      case "EMPLOYEE_CHOICE":
        return "PENDING_CHOICE";
      case "MIXED_POLICY":
        // Rest-day/holiday work is paid; ordinary weekday/night overtime accrues comp-off.
        return dayType === "HOLIDAY" || dayType === "WEEKEND" ? "PAID" : "COMP_OFF";
      default:
        throw new BadRequestException("Overtime is not applicable under this employee's payroll policy.");
    }
  }

  /** amount = hours × hourly-rate × multiplier, all decimal-safe. */
  private paidAmount(
    version: { paymentBasis: string; baseAmount: Prisma.Decimal },
    hours: Prisma.Decimal,
    multiplier: Prisma.Decimal,
    policy: { hoursPerDay: number; daysPerMonth: number; compOffValidityDays: number },
  ): Prisma.Decimal {
    const base = version.baseAmount;
    let hourlyRate: Prisma.Decimal;
    if (version.paymentBasis === "HOURLY") {
      hourlyRate = base;
    } else if (version.paymentBasis === "DAILY") {
      hourlyRate = base.div(policy.hoursPerDay);
    } else {
      // FIXED: base is a monthly figure → derive an hourly rate.
      hourlyRate = base.div(new Prisma.Decimal(policy.daysPerMonth).mul(policy.hoursPerDay));
    }
    return hourlyRate.mul(hours).mul(multiplier);
  }

  private async effectiveProfileVersion(orgId: string, employeeId: string, onDate: Date) {
    const profile = await this.prisma.payrollProfile.findUnique({
      where: { orgId_employeeId: { orgId, employeeId } },
      select: { id: true },
    });
    if (!profile) throw new BadRequestException("This employee has no payroll profile; set up their pay before recording overtime.");
    const version = await this.prisma.payrollProfileVersion.findFirst({
      where: {
        orgId,
        profileId: profile.id,
        effectiveFrom: { lte: onDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
      },
      orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
    });
    if (!version) throw new BadRequestException("No effective payroll profile version covers that date.");
    return version;
  }

  private readPolicy(raw: Prisma.JsonValue | null): { hoursPerDay: number; daysPerMonth: number; compOffValidityDays: number } {
    const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback);
    return {
      hoursPerDay: num(obj.standardHoursPerDay, 8),
      daysPerMonth: num(obj.standardDaysPerMonth, 26),
      compOffValidityDays: num(obj.compOffValidityDays, 90),
    };
  }

  private compOffExpiry(policy: { compOffValidityDays: number }): Date {
    return new Date(Date.now() + policy.compOffValidityDays * 24 * 60 * 60 * 1000);
  }

  private async assertEmployeeInOrg(orgId: string, employeeId: string): Promise<void> {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true } });
    if (!emp) throw new NotFoundException("Employee not found in this organization.");
  }

  private serializeOvertime(
    r: { id: string; employeeId: string; workDate: Date; hours: Prisma.Decimal; dayType: string; mode: string; multiplier: Prisma.Decimal | null; amount: Prisma.Decimal; batchId: string | null; approvedBy: string | null; createdAt: Date },
    compOffMinutes: number,
  ) {
    return {
      id: r.id,
      employeeId: r.employeeId,
      workDate: r.workDate.toISOString().slice(0, 10),
      hours: Number(r.hours),
      dayType: r.dayType,
      mode: r.mode,
      multiplier: r.multiplier === null ? null : Number(r.multiplier),
      amount: Number(r.amount),
      compOffMinutes,
      batchId: r.batchId,
      approvedBy: r.approvedBy,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
