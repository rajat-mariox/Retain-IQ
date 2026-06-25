import { BadRequestException, Injectable } from "@nestjs/common";
import { getRequestContext, requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

// No shift model yet — anyone checking in after 09:15 (UTC) is marked LATE.
const LATE_AFTER_MINUTES = 9 * 60 + 15;

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function statusFor(checkInAt: Date): "PRESENT" | "LATE" {
  const minuteOfDay = checkInAt.getUTCHours() * 60 + checkInAt.getUTCMinutes();
  return minuteOfDay > LATE_AFTER_MINUTES ? "LATE" : "PRESENT";
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve the calling user's employee record via their org membership. */
  private async caller(): Promise<{ orgId: string; employeeId: string }> {
    const ctx = requireTenantContext();
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { id: ctx.membershipId },
      select: { orgId: true, employeeId: true },
    });
    if (!membership?.employeeId) {
      throw new BadRequestException("Your account is not linked to an employee record.");
    }
    return { orgId: membership.orgId, employeeId: membership.employeeId };
  }

  async checkIn() {
    const { orgId, employeeId } = await this.caller();
    const day = startOfUtcDay();
    const key = { orgId_employeeId_day: { orgId, employeeId, day } };

    const existing = await this.prisma.attendanceRecord.findUnique({ where: key });
    if (existing?.checkInAt) {
      return existing; // already checked in today — idempotent
    }

    const now = new Date();
    const ctx = getRequestContext();
    return this.prisma.attendanceRecord.upsert({
      where: key,
      create: { orgId, employeeId, day, checkInAt: now, status: statusFor(now), source: "web", ipAddress: ctx.ipAddress ?? null },
      update: { checkInAt: now, status: statusFor(now) },
    });
  }

  async checkOut() {
    const { orgId, employeeId } = await this.caller();
    const day = startOfUtcDay();
    const record = await this.prisma.attendanceRecord.findUnique({
      where: { orgId_employeeId_day: { orgId, employeeId, day } },
    });
    if (!record?.checkInAt) {
      throw new BadRequestException("You have not checked in today.");
    }
    const now = new Date();
    const workMinutes = Math.max(0, Math.round((now.getTime() - record.checkInAt.getTime()) / 60000));
    return this.prisma.attendanceRecord.update({ where: { id: record.id }, data: { checkOutAt: now, workMinutes } });
  }

  async me() {
    const { orgId, employeeId } = await this.caller();
    const day = startOfUtcDay();
    const since = startOfUtcDay(new Date(Date.now() - 14 * 86_400_000));
    const [today, history] = await Promise.all([
      this.prisma.attendanceRecord.findUnique({ where: { orgId_employeeId_day: { orgId, employeeId, day } } }),
      this.prisma.attendanceRecord.findMany({ where: { orgId, employeeId, day: { gte: since } }, orderBy: { day: "desc" } }),
    ]);
    return { today, history };
  }

  /** Org-wide attendance for today (admin view). */
  async today() {
    const ctx = requireTenantContext();
    const day = startOfUtcDay();
    const [records, totalEmployees] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { orgId: ctx.orgId, day },
        select: { employeeId: true, status: true, checkInAt: true, checkOutAt: true, workMinutes: true },
      }),
      this.prisma.employee.count({ where: { orgId: ctx.orgId, status: "ACTIVE" } }),
    ]);

    const present = records.filter((r) => r.status === "PRESENT").length;
    const late = records.filter((r) => r.status === "LATE").length;
    const onLeave = records.filter((r) => r.status === "ON_LEAVE").length;
    const checkedIn = present + late;
    const absent = Math.max(0, totalEmployees - checkedIn - onLeave);

    return {
      day: day.toISOString().slice(0, 10),
      totalEmployees,
      present,
      late,
      onLeave,
      absent,
      checkedIn,
      attendanceRate: totalEmployees > 0 ? Math.round((checkedIn / totalEmployees) * 100) : 0,
      records,
    };
  }
}
