import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service.js";
import { DEFAULT_POLICY, type AttendancePolicy } from "./attendance-state.js";

/**
 * Reads the per-org attendance policy, falling back to conservative defaults so
 * an organisation that was never configured behaves exactly like the classic
 * one-check-in-a-day flow.
 *
 * The policy is an org-level operational setting: the org's own admins (anyone
 * with attendance.manage — the Owner by default, plus HR managers/roles it's
 * granted to) edit it from the tenant Settings page. The platform (super) admin
 * console can also edit it for support/overrides, and it is seeded when an org
 * is created.
 */
@Injectable()
export class AttendancePolicyService {
  // Policies change rarely but are read on every attendance action.
  private readonly cache = new Map<string, { value: AttendancePolicy; expiresAt: number }>();
  private static readonly TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The stored policy row for an org, or the defaults (with `configured:false`)
   * when it was never set — for editing surfaces that need every raw field.
   */
  async getForEditing(orgId: string): Promise<{ configured: boolean; policy: AttendancePolicy }> {
    const row = await this.prisma.attendancePolicy.findUnique({ where: { orgId } });
    if (!row) return { configured: false, policy: DEFAULT_POLICY };
    return { configured: true, policy: await this.get(orgId) };
  }

  /**
   * Create or update an org's attendance policy (partial patch) and drop the
   * cache so the change takes effect on the next attendance action. Keeps the
   * session switches coherent (same rule as the admin console).
   */
  async update(orgId: string, input: Record<string, unknown>): Promise<AttendancePolicy> {
    const data = { ...input } as Record<string, unknown>;
    if (data.allowReEntry === true && data.allowMultipleSessions === undefined) data.allowMultipleSessions = true;
    if (data.allowMultipleSessions === false && data.allowReEntry === undefined) data.allowReEntry = false;

    await this.prisma.attendancePolicy.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
    });
    this.invalidate(orgId); // take effect immediately, not after the TTL
    return this.get(orgId);
  }

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
          minMinutesBeforeBreak: row.minMinutesBeforeBreak,
          minMinutesBeforeCheckOut: row.minMinutesBeforeCheckOut,
          graceMinutes: row.graceMinutes,
          autoCheckOutAtShiftEnd: row.autoCheckOutAtShiftEnd,
          autoCheckOutAfterMinutes: row.autoCheckOutAfterMinutes,
          idleCheckoutMinutes: row.idleCheckoutMinutes,
          idleCheckoutWarnMinutes: row.idleCheckoutWarnMinutes,
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
