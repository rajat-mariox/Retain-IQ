import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service.js";
import { DEFAULT_POLICY, type AttendancePolicy } from "./attendance-state.js";

/**
 * Reads the per-org attendance policy, falling back to conservative defaults so
 * an organisation that was never configured behaves exactly like the classic
 * one-check-in-a-day flow.
 *
 * The policy is owned by the platform (super) admin, not the org owner — it is
 * set when an organisation is created and edited from the admin console.
 */
@Injectable()
export class AttendancePolicyService {
  // Policies change rarely but are read on every attendance action.
  private readonly cache = new Map<string, { value: AttendancePolicy; expiresAt: number }>();
  private static readonly TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async get(orgId: string): Promise<AttendancePolicy> {
    const hit = this.cache.get(orgId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const row = await this.prisma.attendancePolicy.findUnique({ where: { orgId } });
    const value: AttendancePolicy = row
      ? {
          allowMultipleSessions: row.allowMultipleSessions,
          allowReEntry: row.allowReEntry,
          maxSessionsPerDay: row.maxSessionsPerDay,
          maxBreaksPerDay: row.maxBreaksPerDay,
          maxBreakMinutesPerDay: row.maxBreakMinutesPerDay,
          maxSingleBreakMinutes: row.maxSingleBreakMinutes,
          paidBreakMinutesPerDay: row.paidBreakMinutesPerDay,
          allowCheckOutOnBreak: row.allowCheckOutOnBreak,
          graceMinutes: row.graceMinutes,
          autoCheckOutAtShiftEnd: row.autoCheckOutAtShiftEnd,
          autoCheckOutAfterMinutes: row.autoCheckOutAfterMinutes,
          overtimeAfterMinutes: row.overtimeAfterMinutes,
          minHoursForPresent: row.minHoursForPresent,
          workModel: row.workModel,
          allowedLocations: row.allowedLocations,
          requireLocation: row.requireLocation,
          allowManualCorrection: row.allowManualCorrection,
        }
      : DEFAULT_POLICY;

    this.cache.set(orgId, { value, expiresAt: Date.now() + AttendancePolicyService.TTL_MS });
    return value;
  }

  /** Drop the cached policy for an org — called after the admin edits it. */
  invalidate(orgId: string): void {
    this.cache.delete(orgId);
  }
}
