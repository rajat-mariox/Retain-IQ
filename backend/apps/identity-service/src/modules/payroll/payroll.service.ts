import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OrgRolesService } from "../../common/org-roles/org-roles.service.js";
import { CompOffService } from "../leave/comp-off.service.js";
import { RatesService } from "./rates.service.js";

function parseDate(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Invalid date.");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
/** Monday (UTC) of the week containing `d` — matches TimeTrackingService. */
function weekStartOf(d: Date): Date {
  return addDays(d, -((d.getUTCDay() + 6) % 7));
}
/** Round half-up to whole cents. Money never leaves this file as a float. */
const cents = (n: number) => Math.round(n);

type LineDraft = {
  employeeId: string;
  employeeName: string;
  regularMinutes: number;
  overtimeMinutes: number;
  billableMinutes: number;
  costRateCents: number | null;
  regularPayCents: number;
  overtimePayCents: number;
  grossPayCents: number;
  /** Set when the employee has hours but no rate — they're excluded from the run. */
  problem?: string;
};

/**
 * Payroll runs.
 *
 * Inputs are *approved* timesheet hours (or all tracked hours if the org turns
 * requireApproval off) and the cost rate in effect on each entry's own date.
 * Overtime is computed per ISO week against PayrollSetting.overtimeAfterMins,
 * because a weekly threshold is what OT rules are actually written against —
 * summing a month and dividing would silently under-report it.
 *
 * Running is idempotent: it recomputes DRAFT lines from scratch. Locking freezes
 * them; a locked cycle can never be re-run, so the numbers signed off are the
 * numbers that stay.
 */
@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RatesService,
    private readonly orgRoles: OrgRolesService,
    private readonly compOff: CompOffService,
  ) {}

  // ---- cycles --------------------------------------------------------------

  async listCycles() {
    const ctx = requireTenantContext();
    const rows = await this.prisma.payrollCycle.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { periodStart: "desc" },
      include: { _count: { select: { lines: true } }, lines: { select: { grossPayCents: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      periodStart: iso(c.periodStart),
      periodEnd: iso(c.periodEnd),
      status: c.status,
      currency: c.currency,
      employeeCount: c._count.lines,
      totalGrossCents: c.lines.reduce((s, l) => s + l.grossPayCents, 0),
      runAt: c.runAt?.toISOString() ?? null,
      lockedAt: c.lockedAt?.toISOString() ?? null,
      paidAt: c.paidAt?.toISOString() ?? null,
      note: c.note,
    }));
  }

  async createCycle(input: { periodStart: string; periodEnd: string; note?: string }) {
    const ctx = requireTenantContext();
    const start = parseDate(input.periodStart);
    const end = parseDate(input.periodEnd);
    if (end < start) throw new BadRequestException("The end date must be on or after the start date.");

    const settings = await this.rates.getSettings();
    // Overlapping periods would double-pay the same hours.
    const overlap = await this.prisma.payrollCycle.findFirst({
      where: { orgId: ctx.orgId, periodStart: { lte: end }, periodEnd: { gte: start } },
      select: { id: true, periodStart: true, periodEnd: true },
    });
    if (overlap) {
      throw new ConflictException(`This period overlaps an existing cycle (${iso(overlap.periodStart)} → ${iso(overlap.periodEnd)}).`);
    }

    const c = await this.prisma.payrollCycle.create({
      data: { orgId: ctx.orgId, periodStart: start, periodEnd: end, currency: settings.currency, note: input.note?.trim() || null },
    });
    return { id: c.id, periodStart: iso(c.periodStart), periodEnd: iso(c.periodEnd), status: c.status, currency: c.currency };
  }

  // ---- the run ------------------------------------------------------------

  /**
   * Compute what each employee is owed for a period, without persisting.
   * `run` reuses this, so preview and run can never disagree.
   */
  private async computeLines(periodStart: Date, periodEnd: Date): Promise<{ lines: LineDraft[]; currency: string; requireApproval: boolean }> {
    const ctx = requireTenantContext();
    const settings = await this.rates.getSettings();
    const endExclusive = addDays(periodEnd, 1);

    // The Owner runs payroll, they aren't on it — exclude them so their tracked
    // hours never turn into a payslip. (Attendance excludes them the same way.)
    const excluded = await this.orgRoles.ownerEmployeeIds(ctx.orgId);

    // Only hours the org considers final. With requireApproval on (the default),
    // that means the week's timesheet was approved — never a draft someone is
    // still editing.
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        orgId: ctx.orgId,
        date: { gte: periodStart, lt: endExclusive },
        ...(excluded.length > 0 ? { employeeId: { notIn: excluded } } : {}),
      },
      select: { employeeId: true, date: true, minutes: true, billable: true },
    });

    let usable = entries;
    if (settings.requireApproval) {
      const approved = await this.prisma.timesheet.findMany({
        where: { orgId: ctx.orgId, status: "APPROVED", weekStart: { gte: addDays(weekStartOf(periodStart), 0), lt: endExclusive } },
        select: { employeeId: true, weekStart: true },
      });
      const approvedWeeks = new Set(approved.map((t) => `${t.employeeId}:${iso(t.weekStart)}`));
      usable = entries.filter((e) => approvedWeeks.has(`${e.employeeId}:${iso(weekStartOf(e.date))}`));
    }

    // Bucket by employee → ISO week → day, so overtime is assessed against the
    // week the hours were worked in, while the day grain is preserved for
    // pricing each day at its own effective-dated rate (rates can change
    // mid-period; the whole week must not inherit the newest one).
    type DayBucket = { minutes: number; billable: number };
    type WeekBucket = { days: Map<string, DayBucket> };
    const byEmployee = new Map<string, Map<string, WeekBucket>>();
    for (const e of usable) {
      const wk = iso(weekStartOf(e.date));
      const day = iso(e.date);
      const weeks = byEmployee.get(e.employeeId) ?? new Map<string, WeekBucket>();
      const week: WeekBucket = weeks.get(wk) ?? { days: new Map<string, DayBucket>() };
      const bucket: DayBucket = week.days.get(day) ?? { minutes: 0, billable: 0 };
      bucket.minutes += e.minutes;
      if (e.billable) bucket.billable += e.minutes;
      week.days.set(day, bucket);
      weeks.set(wk, week);
      byEmployee.set(e.employeeId, weeks);
    }

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: [...byEmployee.keys()] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const nameOf = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));

    const lines: LineDraft[] = [];
    for (const [employeeId, weeks] of byEmployee) {
      let regular = 0;
      let overtime = 0;
      let billable = 0;
      let regularPay = 0;
      let overtimePay = 0;
      // Weighted numerator/denominator for the blended DISPLAY rate below.
      let rateWeightNumerator = 0;
      let rateWeightMinutes = 0;
      const missingRateDates: string[] = [];

      // Overtime is a WEEKLY property (max(0, weekMinutes − threshold)), but
      // pricing is a DAILY property (each day at its own effective rate). So we
      // decide OT per week, then walk that week's days in chronological order:
      // the first `overtimeAfterMins` minutes of the week are regular, every
      // minute after that is overtime — a deterministic chronological split, so
      // a mid-week rate change lands the OT on the days it was actually worked.
      for (const [, week] of weeks) {
        const days = [...week.days.entries()].sort(([a], [b]) => a.localeCompare(b));
        const weekMinutes = days.reduce((s, [, d]) => s + d.minutes, 0);
        const weekRegularCap = Math.max(0, weekMinutes - Math.max(0, weekMinutes - settings.overtimeAfterMins));
        let regularConsumed = 0; // regular minutes already attributed earlier in the week

        for (const [dayIso, d] of days) {
          billable += d.billable;

          // Split this day's minutes into regular vs OT by position in the week.
          const dayRegular = Math.max(0, Math.min(d.minutes, weekRegularCap - regularConsumed));
          const dayOvertime = d.minutes - dayRegular;
          regularConsumed += dayRegular;
          regular += dayRegular;
          overtime += dayOvertime;

          if (d.minutes === 0) continue;

          // Price this day at ITS OWN effective-dated cost rate.
          const { costRateCents: dayRate } = await this.rates.resolveCostRate(employeeId, parseDate(dayIso));
          if (dayRate == null) {
            missingRateDates.push(dayIso);
            continue;
          }
          regularPay += cents((dayRegular / 60) * dayRate);
          // In a COMP_OFF org overtime is compensated as time-off, not money, so it
          // adds nothing to pay here — it is converted to comp-off days at lock().
          if (settings.overtimeHandling !== "COMP_OFF") {
            overtimePay += cents((dayOvertime / 60) * dayRate * (settings.overtimeMultiplier / 100));
          }
          rateWeightNumerator += dayRate * d.minutes;
          rateWeightMinutes += d.minutes;
        }
      }

      // Any worked day without a resolvable rate excludes the WHOLE employee —
      // pricing part of their week would silently underpay them.
      if (missingRateDates.length > 0) {
        const dates = [...new Set(missingRateDates)].sort();
        lines.push({
          employeeId,
          employeeName: nameOf.get(employeeId) ?? "Unknown",
          regularMinutes: regular,
          overtimeMinutes: overtime,
          billableMinutes: billable,
          costRateCents: null,
          regularPayCents: 0,
          overtimePayCents: 0,
          grossPayCents: 0,
          problem: `No cost rate is set for this employee on: ${dates.join(", ")}.`,
        });
        continue;
      }

      // costRateCents is a DISPLAY aggregate only — the pay fields above are the
      // authoritative money, each priced at its own day's rate. We surface the
      // minutes-weighted average of the day rates so the single number shown next
      // to a multi-rate line is representative rather than arbitrary.
      const costRateCents = rateWeightMinutes > 0 ? Math.round(rateWeightNumerator / rateWeightMinutes) : null;
      lines.push({
        employeeId,
        employeeName: nameOf.get(employeeId) ?? "Unknown",
        regularMinutes: regular,
        overtimeMinutes: overtime,
        billableMinutes: billable,
        costRateCents,
        regularPayCents: regularPay,
        overtimePayCents: overtimePay,
        grossPayCents: regularPay + overtimePay,
      });
    }

    lines.sort((a, b) => b.grossPayCents - a.grossPayCents || a.employeeName.localeCompare(b.employeeName));
    return { lines, currency: settings.currency, requireApproval: settings.requireApproval };
  }

  /** Dry-run a period — including employees who'd be skipped, and why. */
  async preview(query: { periodStart: string; periodEnd: string }) {
    const start = parseDate(query.periodStart);
    const end = parseDate(query.periodEnd);
    if (end < start) throw new BadRequestException("The end date must be on or after the start date.");
    const { lines, currency, requireApproval } = await this.computeLines(start, end);
    return this.summarize({ periodStart: iso(start), periodEnd: iso(end), status: "PREVIEW", currency, requireApproval }, lines);
  }

  /**
   * Compute and persist the cycle's lines. Idempotent — re-running a DRAFT
   * replaces its lines. A LOCKED/PAID cycle refuses, so signed-off numbers
   * can't move under anyone.
   */
  async run(cycleId: string) {
    const ctx = requireTenantContext();
    const cycle = await this.prisma.payrollCycle.findFirst({ where: { id: cycleId, orgId: ctx.orgId } });
    if (!cycle) throw new NotFoundException("Payroll cycle not found.");
    if (cycle.status !== "DRAFT") throw new ConflictException(`This cycle is ${cycle.status.toLowerCase()} and can no longer be re-run.`);

    const { lines, currency, requireApproval } = await this.computeLines(cycle.periodStart, cycle.periodEnd);
    const payable = lines.filter((l) => l.costRateCents != null);

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollLine.deleteMany({ where: { cycleId: cycle.id } });
      if (payable.length) {
        await tx.payrollLine.createMany({
          data: payable.map((l) => ({
            orgId: ctx.orgId,
            cycleId: cycle.id,
            employeeId: l.employeeId,
            regularMinutes: l.regularMinutes,
            overtimeMinutes: l.overtimeMinutes,
            billableMinutes: l.billableMinutes,
            costRateCents: l.costRateCents as number,
            regularPayCents: l.regularPayCents,
            overtimePayCents: l.overtimePayCents,
            grossPayCents: l.grossPayCents,
          })),
        });
      }
      await tx.payrollCycle.update({ where: { id: cycle.id }, data: { runAt: new Date(), currency } });
    });

    return this.summarize(
      { id: cycle.id, periodStart: iso(cycle.periodStart), periodEnd: iso(cycle.periodEnd), status: cycle.status, currency, requireApproval },
      lines,
    );
  }

  /** A cycle with its persisted lines. */
  async get(cycleId: string) {
    const ctx = requireTenantContext();
    const cycle = await this.prisma.payrollCycle.findFirst({
      where: { id: cycleId, orgId: ctx.orgId },
      include: { lines: { include: { employee: { select: { firstName: true, lastName: true } } } } },
    });
    if (!cycle) throw new NotFoundException("Payroll cycle not found.");

    const settings = await this.rates.getSettings();
    const lines: LineDraft[] = cycle.lines.map((l) => ({
      employeeId: l.employeeId,
      employeeName: `${l.employee.firstName} ${l.employee.lastName}`.trim(),
      regularMinutes: l.regularMinutes,
      overtimeMinutes: l.overtimeMinutes,
      billableMinutes: l.billableMinutes,
      costRateCents: l.costRateCents,
      regularPayCents: l.regularPayCents,
      overtimePayCents: l.overtimePayCents,
      grossPayCents: l.grossPayCents,
    }));
    lines.sort((a, b) => b.grossPayCents - a.grossPayCents);

    return this.summarize(
      {
        id: cycle.id,
        periodStart: iso(cycle.periodStart),
        periodEnd: iso(cycle.periodEnd),
        status: cycle.status,
        currency: cycle.currency,
        requireApproval: settings.requireApproval,
        runAt: cycle.runAt?.toISOString() ?? null,
        lockedAt: cycle.lockedAt?.toISOString() ?? null,
      },
      lines,
    );
  }

  /** Freeze the cycle. After this its lines are the financial record. */
  async lock(cycleId: string) {
    const ctx = requireTenantContext();
    const cycle = await this.prisma.payrollCycle.findFirst({ where: { id: cycleId, orgId: ctx.orgId }, include: { _count: { select: { lines: true } } } });
    if (!cycle) throw new NotFoundException("Payroll cycle not found.");
    if (cycle.status !== "DRAFT") throw new ConflictException("Only a draft cycle can be locked.");
    if (!cycle.runAt) throw new ConflictException("Run this cycle before locking it.");
    if (cycle._count.lines === 0) throw new ConflictException("This cycle has no payable lines to lock.");

    await this.prisma.payrollCycle.update({ where: { id: cycle.id }, data: { status: "LOCKED", lockedAt: new Date(), lockedBy: ctx.userId } });

    // COMP_OFF orgs don't pay overtime — locking the cycle is the moment its
    // approved OT converts into comp-off leave. Idempotent, so re-locking (or a
    // PAY org) is a no-op. Never let a comp-off hiccup fail the lock itself.
    const settings = await this.rates.getSettings();
    if (settings.overtimeHandling === "COMP_OFF") {
      try {
        await this.compOff.earnFromCycle(ctx.orgId, cycle.id, cycle.periodStart, cycle.periodEnd);
      } catch (err) {
        this.logger.warn(`Comp-off conversion failed for cycle ${cycle.id}: ${String(err)}`);
      }
    }
    return this.get(cycleId);
  }

  async markPaid(cycleId: string) {
    const ctx = requireTenantContext();
    const cycle = await this.prisma.payrollCycle.findFirst({ where: { id: cycleId, orgId: ctx.orgId } });
    if (!cycle) throw new NotFoundException("Payroll cycle not found.");
    if (cycle.status !== "LOCKED") throw new ConflictException("Lock the cycle before marking it paid.");
    await this.prisma.payrollCycle.update({ where: { id: cycle.id }, data: { status: "PAID", paidAt: new Date() } });
    return this.get(cycleId);
  }

  private summarize(
    cycle: { id?: string; periodStart: string; periodEnd: string; status: string; currency: string; requireApproval: boolean; runAt?: string | null; lockedAt?: string | null },
    lines: LineDraft[],
  ) {
    const payable = lines.filter((l) => l.costRateCents != null);
    const totalMinutes = lines.reduce((s, l) => s + l.regularMinutes + l.overtimeMinutes, 0);
    const billableMinutes = lines.reduce((s, l) => s + l.billableMinutes, 0);
    return {
      ...cycle,
      totals: {
        employeeCount: payable.length,
        regularMinutes: lines.reduce((s, l) => s + l.regularMinutes, 0),
        overtimeMinutes: lines.reduce((s, l) => s + l.overtimeMinutes, 0),
        billableMinutes,
        totalMinutes,
        utilization: totalMinutes > 0 ? Math.round((billableMinutes / totalMinutes) * 100) : 0,
        grossPayCents: payable.reduce((s, l) => s + l.grossPayCents, 0),
        overtimePayCents: payable.reduce((s, l) => s + l.overtimePayCents, 0),
      },
      lines: lines.map((l) => ({ ...l, costRateCents: l.costRateCents })),
      /** Employees with hours but no rate — surfaced, never silently dropped. */
      excluded: lines.filter((l) => l.problem).map((l) => ({ employeeId: l.employeeId, employeeName: l.employeeName, reason: l.problem })),
    };
  }
}
