import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ApprovalService } from "../../common/approval/approval.service.js";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { AttendancePolicyService } from "./attendance-policy.service.js";

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export type CorrectionType = "MISSED_CHECK_IN" | "MISSED_CHECK_OUT" | "WRONG_TIME" | "OVERTIME" | "OTHER";

/**
 * Attendance corrections and overtime approval.
 *
 * Both are the same shape of problem: the employee asserts something the clock
 * didn't capture, and a human with authority over them decides. Routing reuses
 * ApprovalService, so a correction goes to the employee's reporting manager and
 * falls back to the Owner when they have none — the same line that already
 * governs leave and timesheets.
 *
 * Nothing an employee submits changes their own record. Only an approval writes.
 */
@Injectable()
export class AttendanceCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalService,
    private readonly policies: AttendancePolicyService,
    private readonly outbox: OutboxService,
  ) {}

  /** Raise a correction for one of the caller's own days. */
  async request(input: {
    day: string;
    type: CorrectionType;
    reason: string;
    checkInAt?: string;
    checkOutAt?: string;
    overtimeMinutes?: number;
  }) {
    const ctx = requireTenantContext();
    const employeeId = await this.approvals.callerEmployeeId();
    const policy = await this.policies.get(ctx.orgId);
    if (!policy.allowManualCorrection) {
      throw new ForbiddenException("Attendance corrections are turned off for your organization.");
    }

    const day = startOfUtcDay(new Date(`${input.day}T00:00:00.000Z`));
    if (Number.isNaN(day.getTime())) throw new BadRequestException("Invalid date.");
    if (day.getTime() > startOfUtcDay(new Date()).getTime()) {
      throw new BadRequestException("You can't raise a correction for a future date.");
    }

    // An overtime claim needs an amount; a time fix needs at least one time.
    if (input.type === "OVERTIME" && !input.overtimeMinutes) {
      throw new BadRequestException("Tell us how many minutes of overtime you're claiming.");
    }
    if ((input.type === "MISSED_CHECK_IN" || input.type === "MISSED_CHECK_OUT" || input.type === "WRONG_TIME") && !input.checkInAt && !input.checkOutAt) {
      throw new BadRequestException("Provide the corrected check-in or check-out time.");
    }

    const existing = await this.prisma.attendanceCorrection.findFirst({
      where: { orgId: ctx.orgId, employeeId, day, status: "PENDING" },
      select: { id: true },
    });
    if (existing) throw new BadRequestException("You already have a pending correction for that day.");

    const record = await this.prisma.attendanceRecord.findUnique({
      where: { orgId_employeeId_day: { orgId: ctx.orgId, employeeId, day } },
      select: { id: true },
    });

    const created = await this.prisma.attendanceCorrection.create({
      data: {
        orgId: ctx.orgId,
        employeeId,
        attendanceId: record?.id ?? null,
        day,
        type: input.type,
        reason: input.reason.trim(),
        requestedCheckInAt: input.checkInAt ? new Date(input.checkInAt) : null,
        requestedCheckOutAt: input.checkOutAt ? new Date(input.checkOutAt) : null,
        requestedOvertimeMinutes: input.overtimeMinutes ?? null,
      },
    });

    await this.notifyApprovers(ctx.orgId, employeeId, created.id, input.type);
    return created;
  }

  /** The caller's own corrections. */
  async mine() {
    const ctx = requireTenantContext();
    const employeeId = await this.approvals.callerEmployeeId();
    const rows = await this.prisma.attendanceCorrection.findMany({
      where: { orgId: ctx.orgId, employeeId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((r) => this.serialize(r));
  }

  /**
   * The approval queue: only the people this approver actually has reach over.
   * `approvableEmployeeIds()` returns null for org-wide reach (Owner).
   */
  async pending() {
    const ctx = requireTenantContext();
    const reach = await this.approvals.approvableEmployeeIds();
    const rows = await this.prisma.attendanceCorrection.findMany({
      where: {
        orgId: ctx.orgId,
        status: "PENDING",
        ...(reach ? { employeeId: { in: reach } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    const names = await this.employeeNames(ctx.orgId, rows.map((r) => r.employeeId));
    return rows.map((r) => ({ ...this.serialize(r), employeeName: names.get(r.employeeId) ?? null }));
  }

  /**
   * Approve or reject. Approving is the only path that edits an attendance
   * record, and it snapshots what it overwrote so the change stays explicable.
   */
  async decide(id: string, approve: boolean, note?: string) {
    const ctx = requireTenantContext();
    const correction = await this.prisma.attendanceCorrection.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!correction) throw new NotFoundException("Correction request not found.");
    if (correction.status !== "PENDING") throw new BadRequestException("This request has already been decided.");

    // Routing: manager for their reports, Owner when there's no manager.
    await this.approvals.assertCanApprove(correction.employeeId);

    if (!approve) {
      const rejected = await this.prisma.attendanceCorrection.update({
        where: { id },
        data: { status: "REJECTED", decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: note?.trim() || null },
      });
      await this.notifyRequester(correction.orgId, correction.employeeId, id, "REJECTED");
      return this.serialize(rejected);
    }

    const record = await this.prisma.attendanceRecord.findUnique({
      where: { orgId_employeeId_day: { orgId: correction.orgId, employeeId: correction.employeeId, day: correction.day } },
      include: { sessions: { orderBy: { sequence: "asc" } } },
    });
    if (!record) throw new BadRequestException("There's no attendance record for that day to correct.");

    const previousState = {
      checkInAt: record.checkInAt?.toISOString() ?? null,
      checkOutAt: record.checkOutAt?.toISOString() ?? null,
      workMinutes: record.workMinutes,
      approvedOvertimeMinutes: record.approvedOvertimeMinutes,
    };

    await this.prisma.$transaction(async (tx) => {
      if (correction.type === "OVERTIME") {
        /*
         * Two different situations, deliberately treated differently:
         *
         *  - The system measured overtime. Then it is the ceiling: approval can
         *    trim a claim but never inflate past what the clock saw.
         *  - The system measured none. This is the case the correction path
         *    exists for — a missed check-out means auto-close clamped the day to
         *    shift end, so genuine late work shows as zero. Here the manager's
         *    sign-off IS the evidence, so the claim stands.
         *
         * Either way it can never exceed the day's worked time: you cannot have
         * more overtime than you have work.
         */
        const claimed = correction.requestedOvertimeMinutes ?? 0;
        const ceiling = record.overtimeMinutes > 0 ? record.overtimeMinutes : record.workMinutes;
        const payable = Math.max(0, Math.min(claimed, ceiling));
        await tx.attendanceRecord.update({
          where: { id: record.id },
          data: { approvedOvertimeMinutes: payable, overtimeApprovedBy: ctx.userId, overtimeApprovedAt: new Date() },
        });
      } else {
        // A time fix rewrites the first/last session, then the day totals follow.
        const first = record.sessions[0] ?? null;
        const last = [...record.sessions].reverse()[0] ?? null;
        const newIn = correction.requestedCheckInAt ?? record.checkInAt;
        const newOut = correction.requestedCheckOutAt ?? record.checkOutAt;
        if (newIn && newOut && newOut < newIn) {
          throw new BadRequestException("The corrected check-out can't be before the check-in.");
        }
        // The corrected times must also fit the SESSION they land on, not just
        // the day. On a multi-session day the last session may start well after
        // the day's first check-in, so comparing against the day alone would
        // happily write an end that precedes its own start.
        if (correction.requestedCheckOutAt && last && correction.requestedCheckOutAt < last.startedAt) {
          throw new BadRequestException(
            "That check-out time is before the last session started. Correct the session's start time too, or pick a later time.",
          );
        }
        if (correction.requestedCheckInAt && first?.endedAt && correction.requestedCheckInAt > first.endedAt) {
          throw new BadRequestException("That check-in time is after the first session already ended.");
        }

        if (first && correction.requestedCheckInAt) {
          await tx.attendanceSession.update({
            where: { id: first.id },
            data: {
              startedAt: correction.requestedCheckInAt,
              minutes: first.endedAt ? Math.max(0, Math.round((first.endedAt.getTime() - correction.requestedCheckInAt.getTime()) / 60000)) : first.minutes,
            },
          });
        }
        if (last && correction.requestedCheckOutAt) {
          await tx.attendanceSession.update({
            where: { id: last.id },
            data: {
              endedAt: correction.requestedCheckOutAt,
              minutes: Math.max(0, Math.round((correction.requestedCheckOutAt.getTime() - last.startedAt.getTime()) / 60000)),
              autoClosed: false, // a human has now vouched for this day
            },
          });
        }

        const sessions = await tx.attendanceSession.findMany({ where: { attendanceId: record.id } });
        const gross = sessions.reduce((a, s) => a + (s.endedAt ? Math.max(0, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60000)) : 0), 0);
        await tx.attendanceRecord.update({
          where: { id: record.id },
          data: {
            checkInAt: newIn,
            checkOutAt: newOut,
            workMinutes: Math.max(0, gross - record.unpaidBreakMinutes),
            state: newOut ? "COMPLETED" : "WORKING",
          },
        });
      }

      await tx.attendanceCorrection.update({
        where: { id },
        data: { status: "APPROVED", decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: note?.trim() || null, previousState },
      });

      await tx.attendanceEvent.create({
        data: {
          orgId: correction.orgId,
          employeeId: correction.employeeId,
          attendanceId: record.id,
          type: "CORRECTION",
          source: "web",
          actorUserId: ctx.userId,
          note: `${correction.type} approved: ${correction.reason}`,
        },
      });
    });

    await this.notifyRequester(correction.orgId, correction.employeeId, id, "APPROVED");
    const fresh = await this.prisma.attendanceCorrection.findUnique({ where: { id } });
    return this.serialize(fresh!);
  }

  /**
   * Days with unapproved overtime, for the approver's queue. Overtime is
   * measured automatically but pays nothing until someone signs it off, so this
   * is where genuine extra hours actually get recognised.
   */
  async pendingOvertime() {
    const ctx = requireTenantContext();
    const reach = await this.approvals.approvableEmployeeIds();
    const rows = await this.prisma.attendanceRecord.findMany({
      where: {
        orgId: ctx.orgId,
        overtimeMinutes: { gt: 0 },
        approvedOvertimeMinutes: 0,
        overtimeApprovedAt: null,
        ...(reach ? { employeeId: { in: reach } } : {}),
      },
      orderBy: { day: "desc" },
      take: 200,
      select: { id: true, employeeId: true, day: true, overtimeMinutes: true, workMinutes: true, checkInAt: true, checkOutAt: true },
    });
    const names = await this.employeeNames(ctx.orgId, rows.map((r) => r.employeeId));
    return rows.map((r) => ({
      attendanceId: r.id,
      employeeId: r.employeeId,
      employeeName: names.get(r.employeeId) ?? null,
      day: r.day.toISOString().slice(0, 10),
      overtimeMinutes: r.overtimeMinutes,
      workMinutes: r.workMinutes,
      checkInAt: r.checkInAt?.toISOString() ?? null,
      checkOutAt: r.checkOutAt?.toISOString() ?? null,
    }));
  }

  /**
   * Approve overtime on a day directly. `minutes` lets the approver grant less
   * than was measured; it can never exceed it, so approval can trim a claim but
   * never invent one.
   */
  async approveOvertime(attendanceId: string, minutes?: number, note?: string) {
    const ctx = requireTenantContext();
    const record = await this.prisma.attendanceRecord.findFirst({
      where: { id: attendanceId, orgId: ctx.orgId },
      select: { id: true, employeeId: true, overtimeMinutes: true },
    });
    if (!record) throw new NotFoundException("Attendance record not found.");
    await this.approvals.assertCanApprove(record.employeeId);
    if (record.overtimeMinutes <= 0) throw new BadRequestException("There's no overtime on that day to approve.");

    const granted = Math.max(0, Math.min(minutes ?? record.overtimeMinutes, record.overtimeMinutes));
    const updated = await this.prisma.attendanceRecord.update({
      where: { id: record.id },
      data: { approvedOvertimeMinutes: granted, overtimeApprovedBy: ctx.userId, overtimeApprovedAt: new Date() },
      select: { id: true, day: true, overtimeMinutes: true, approvedOvertimeMinutes: true },
    });

    await this.prisma.attendanceEvent.create({
      data: {
        orgId: ctx.orgId,
        employeeId: record.employeeId,
        attendanceId: record.id,
        type: "OVERTIME_APPROVED",
        source: "web",
        actorUserId: ctx.userId,
        note: note?.trim() || `Approved ${granted} of ${record.overtimeMinutes} overtime minutes`,
      },
    });

    return {
      attendanceId: updated.id,
      day: updated.day.toISOString().slice(0, 10),
      overtimeMinutes: updated.overtimeMinutes,
      approvedOvertimeMinutes: updated.approvedOvertimeMinutes,
    };
  }

  /** Withdraw one's own pending request. */
  async cancel(id: string) {
    const ctx = requireTenantContext();
    const employeeId = await this.approvals.callerEmployeeId();
    const row = await this.prisma.attendanceCorrection.findFirst({ where: { id, orgId: ctx.orgId, employeeId } });
    if (!row) throw new NotFoundException("Correction request not found.");
    if (row.status !== "PENDING") throw new BadRequestException("Only a pending request can be withdrawn.");
    const updated = await this.prisma.attendanceCorrection.update({ where: { id }, data: { status: "CANCELLED" } });
    return this.serialize(updated);
  }

  // ---- helpers ----

  private serialize(r: {
    id: string; employeeId: string; day: Date; type: string; reason: string;
    requestedCheckInAt: Date | null; requestedCheckOutAt: Date | null; requestedOvertimeMinutes: number | null;
    status: string; decidedAt: Date | null; decisionNote: string | null; createdAt: Date;
  }) {
    return {
      id: r.id,
      employeeId: r.employeeId,
      day: r.day.toISOString().slice(0, 10),
      type: r.type,
      reason: r.reason,
      requestedCheckInAt: r.requestedCheckInAt?.toISOString() ?? null,
      requestedCheckOutAt: r.requestedCheckOutAt?.toISOString() ?? null,
      requestedOvertimeMinutes: r.requestedOvertimeMinutes,
      status: r.status,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private async employeeNames(orgId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.employee.findMany({
      where: { orgId, id: { in: [...new Set(ids)] } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(rows.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));
  }

  /**
   * Notify whoever can actually decide this: the employee's manager, or the
   * Owner when they report to nobody.
   */
  private async notifyApprovers(orgId: string, employeeId: string, correctionId: string, type: string): Promise<void> {
    try {
      const employee = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { firstName: true, lastName: true, managerId: true },
      });
      const approverEmployeeId = employee?.managerId ?? null;
      const membership = approverEmployeeId
        ? await this.prisma.organizationMembership.findFirst({
            where: { orgId, employeeId: approverEmployeeId, status: "ACTIVE" },
            select: { userId: true },
          })
        : await this.prisma.organizationMembership.findFirst({
            where: { orgId, status: "ACTIVE", role: { name: "Owner" } },
            select: { userId: true },
          });
      if (!membership?.userId) return;

      await this.prisma.$transaction(async (tx) => {
        await this.outbox.enqueue(tx, {
          eventType: "attendance.correction_requested",
          aggregateType: "attendance_correction",
          aggregateId: correctionId,
          orgId,
          payload: {
            approverUserId: membership.userId,
            employeeName: employee ? `${employee.firstName} ${employee.lastName}`.trim() : "An employee",
            correctionType: type,
          },
        });
      });
    } catch {
      // The request is saved and visible in the queue regardless.
    }
  }

  private async notifyRequester(orgId: string, employeeId: string, correctionId: string, status: string): Promise<void> {
    try {
      const membership = await this.prisma.organizationMembership.findFirst({
        where: { orgId, employeeId, status: "ACTIVE" },
        select: { userId: true },
      });
      if (!membership?.userId) return;
      await this.prisma.$transaction(async (tx) => {
        await this.outbox.enqueue(tx, {
          eventType: "attendance.correction_decided",
          aggregateType: "attendance_correction",
          aggregateId: correctionId,
          orgId,
          payload: { requesterUserId: membership.userId, status },
        });
      });
    } catch {
      // Best-effort.
    }
  }
}
