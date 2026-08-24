import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { ApprovalService } from "../../common/approval/approval.service.js";

/** Round to the nearest half-day (comp-off is granted in 0.5 increments). */
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * Comp-off (compensatory time-off) balances. A balance is the running SUM of
 * CompOffLedger.deltaDays for an employee: positive entries are earned (approved
 * overtime in a COMP_OFF org, or a manual grant), negative entries are spent
 * (a COMP_OFF leave request). Everything is reversible — cancelling a comp-off
 * leave writes the opposite entry rather than deleting history.
 */
@Injectable()
export class CompOffService {
  private readonly log = new Logger(CompOffService.name);
  // If a shift's working window can't be resolved, fall back to an 8h day so the
  // "one full working day of OT = one comp-off day" formula still has a divisor.
  private static readonly DEFAULT_DAILY_MINUTES = 480;

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalService,
  ) {}

  /** Current comp-off balance (days) for an employee. Excludes expired credits. */
  async balanceOf(orgId: string, employeeId: string): Promise<number> {
    const now = new Date();
    const rows = await this.prisma.compOffLedger.findMany({
      where: { orgId, employeeId },
      select: { deltaDays: true, expiresAt: true },
    });
    // A positive (earned) entry past its expiry no longer counts; spends always count.
    const total = rows.reduce((sum, r) => {
      if (r.deltaDays > 0 && r.expiresAt && r.expiresAt < now) return sum;
      return sum + r.deltaDays;
    }, 0);
    return roundHalf(total);
  }

  /** The caller's own comp-off balance + ledger, or a report's within reach. */
  async myBalance(employeeId?: string) {
    const ctx = requireTenantContext();
    const own = await this.approvals.callerEmployeeId().catch(() => null);
    const target = employeeId ?? own;
    if (!target) return { employeeId: null, balance: 0, ledger: [] as unknown[] };
    if (employeeId && employeeId !== own) {
      const reach = await this.approvals.approvableEmployeeIds();
      if (reach !== null && !reach.includes(employeeId)) {
        throw new ForbiddenException("You can only view comp-off for people you manage.");
      }
    }
    const [balance, ledger] = await Promise.all([
      this.balanceOf(ctx.orgId, target),
      this.prisma.compOffLedger.findMany({ where: { orgId: ctx.orgId, employeeId: target }, orderBy: { createdAt: "desc" }, take: 100 }),
    ]);
    return {
      employeeId: target,
      balance,
      ledger: ledger.map((l) => ({
        id: l.id, deltaDays: l.deltaDays, source: l.source, note: l.note,
        expiresAt: l.expiresAt?.toISOString() ?? null, createdAt: l.createdAt.toISOString(),
      })),
    };
  }

  /** Manually grant (or debit, with a negative amount) comp-off. Approver-gated. */
  async grant(input: { employeeId: string; days: number; note?: string; expiresAt?: string | null }) {
    const ctx = requireTenantContext();
    if (!Number.isFinite(input.days) || input.days === 0) throw new BadRequestException("Enter a non-zero number of days.");
    await this.approvals.assertCanApprove(input.employeeId);
    const entry = await this.prisma.compOffLedger.create({
      data: {
        orgId: ctx.orgId,
        employeeId: input.employeeId,
        deltaDays: roundHalf(input.days),
        source: "MANUAL_GRANT",
        note: input.note?.trim() || null,
        grantedBy: ctx.userId,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
    });
    return { id: entry.id, balance: await this.balanceOf(ctx.orgId, input.employeeId) };
  }

  /**
   * Spend comp-off for an approved COMP_OFF leave. Called when such a leave is
   * approved. Writes a negative LEAVE_SPENT entry keyed to the request so it can
   * be reversed on cancellation. Guards against overspend.
   */
  async spendForLeave(orgId: string, employeeId: string, leaveRequestId: string, days: number): Promise<void> {
    const balance = await this.balanceOf(orgId, employeeId);
    if (roundHalf(days) > balance) {
      throw new BadRequestException(`Not enough comp-off balance (${balance} day(s) available, ${days} requested).`);
    }
    await this.prisma.compOffLedger.create({
      data: { orgId, employeeId, deltaDays: -roundHalf(days), source: "LEAVE_SPENT", sourceRef: leaveRequestId },
    });
  }

  /** Reverse the spend when a COMP_OFF leave is cancelled — credit the days back. */
  async reverseForLeave(orgId: string, employeeId: string, leaveRequestId: string): Promise<void> {
    const spent = await this.prisma.compOffLedger.findFirst({ where: { orgId, employeeId, sourceRef: leaveRequestId, source: "LEAVE_SPENT" } });
    if (!spent) return;
    await this.prisma.compOffLedger.create({
      data: { orgId, employeeId, deltaDays: -spent.deltaDays, source: "LEAVE_REVERSED", sourceRef: leaveRequestId, note: "Comp-off leave cancelled" },
    });
  }

  /**
   * Convert a locked payroll cycle's approved overtime into comp-off, one entry
   * per employee. Only runs for a COMP_OFF org. Idempotent: a cycle already
   * converted (its OVERTIME entries exist) is skipped, so re-locking never
   * double-credits. Formula: approvedOvertimeMinutes / that shift's daily work
   * minutes, so a full working day of OT earns one comp-off day.
   */
  async earnFromCycle(orgId: string, cycleId: string, periodStart: Date, periodEnd: Date): Promise<number> {
    const already = await this.prisma.compOffLedger.count({ where: { orgId, source: "OVERTIME", sourceRef: cycleId } });
    if (already > 0) return 0; // already converted for this cycle

    const records = await this.prisma.attendanceRecord.groupBy({
      by: ["employeeId"],
      where: { orgId, day: { gte: periodStart, lte: periodEnd }, approvedOvertimeMinutes: { gt: 0 } },
      _sum: { approvedOvertimeMinutes: true },
    });
    if (records.length === 0) return 0;

    // Resolve each employee's daily-work minutes from their shift (fallback 8h).
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: records.map((r) => r.employeeId) } },
      select: { id: true, shiftRef: { select: { startMinute: true, endMinute: true } } },
    });
    const dailyMinutesOf = new Map<string, number>();
    for (const e of employees) {
      const s = e.shiftRef;
      let mins = CompOffService.DEFAULT_DAILY_MINUTES;
      if (s) {
        const span = s.endMinute > s.startMinute ? s.endMinute - s.startMinute : s.endMinute + 1440 - s.startMinute;
        if (span > 0) mins = span;
      }
      dailyMinutesOf.set(e.id, mins);
    }

    let granted = 0;
    for (const r of records) {
      const otMinutes = r._sum.approvedOvertimeMinutes ?? 0;
      const daily = dailyMinutesOf.get(r.employeeId) ?? CompOffService.DEFAULT_DAILY_MINUTES;
      const days = roundHalf(otMinutes / daily);
      if (days <= 0) continue;
      await this.prisma.compOffLedger.create({
        data: { orgId, employeeId: r.employeeId, deltaDays: days, source: "OVERTIME", sourceRef: cycleId, note: `${otMinutes} min approved OT → comp-off` },
      });
      granted += 1;
    }
    if (granted > 0) this.log.log(`Comp-off earned for ${granted} employee(s) from cycle ${cycleId}`);
    return granted;
  }
}
