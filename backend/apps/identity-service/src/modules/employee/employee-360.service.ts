import { Injectable, NotFoundException } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AnalyticsReadPrismaService } from "../../common/database/analytics-prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { PermissionBundleService } from "../../common/security/permission-bundle.service.js";
import { ApprovalService } from "../../common/approval/approval.service.js";
import { renderField, maskAmount } from "../../common/security/field-mask.js";

const MIN = 60;

/**
 * Employee 360 aggregation. Reads a single employee's operational data from the
 * services that OWN it — attendance/leave/timesheets/screenshots from identity-db,
 * productivity/activity from the analytics read model — never duplicating any of it.
 *
 * Every section is authorization-filtered on the SERVER: a section is only
 * included if the caller both holds its permission (attendance.read, screenshots.read,
 * …) and the target employee is within that permission's ABAC scope. Sections the
 * caller can't see are omitted entirely — the response never carries data the actor
 * isn't allowed to read, so the frontend has nothing sensitive to hide.
 */
@Injectable()
export class Employee360Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsReadPrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly bundles: PermissionBundleService,
    private readonly approval: ApprovalService,
  ) {}

  /** True if the caller holds `permission` AND the target employee is in its scope. */
  private async canSee(orgId: string, userId: string, employeeId: string, permission: string, held: Set<string>): Promise<boolean> {
    if (!held.has(permission)) return false;
    const scope = await this.accessScope.resolveScope(orgId, userId, permission);
    if (scope.tier === "org") return true;
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    return visible === null || visible.includes(employeeId);
  }

  async aggregate(employeeId: string, opts: { from?: string; to?: string }) {
    const ctx = requireTenantContext();
    // Base gate: the caller must be able to see the employee at all (employee.read).
    const bundle = await this.bundles.resolve(ctx.orgId, ctx.userId);
    const held = new Set(bundle?.permissions ?? []);
    if (!(await this.canSee(ctx.orgId, ctx.userId, employeeId, permissions.employeeRead, held))) {
      throw new NotFoundException("Employee not found.");
    }
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId: ctx.orgId }, select: { id: true } });
    if (!emp) throw new NotFoundException("Employee not found.");

    // Window: default last 30 days.
    const now = new Date();
    const to = opts.to ? new Date(opts.to) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const from = opts.from ? new Date(opts.from) : new Date(to.getTime() - 30 * 86_400_000);

    const [canAttendance, canMonitoring, canScreens] = await Promise.all([
      this.canSee(ctx.orgId, ctx.userId, employeeId, permissions.attendanceRead, held),
      // Productivity/activity read path is gated on employee.read (already true here).
      Promise.resolve(true),
      this.canSee(ctx.orgId, ctx.userId, employeeId, permissions.screenshotsRead, held),
    ]);

    const sections: Record<string, unknown> = {};
    const authorized: string[] = ["profile"];

    if (canAttendance) { sections.attendance = await this.attendance(ctx.orgId, employeeId, from, to); authorized.push("attendance"); }
    if (canMonitoring) { sections.productivity = await this.productivity(ctx.orgId, employeeId, from, to); authorized.push("productivity"); }
    if (canScreens) { sections.monitoring = await this.monitoring(ctx.orgId, employeeId, from, to); authorized.push("monitoring"); }
    if (canAttendance) { sections.timesheets = await this.timesheets(ctx.orgId, employeeId, from, to); authorized.push("timesheets"); }
    // Leave uses approval reach rather than a static permission.
    if (await this.canSeeLeave(employeeId)) { sections.leave = await this.leave(ctx.orgId, employeeId); authorized.push("leave"); }
    // Compensation is HIGHLY_RESTRICTED: always present so the field's existence is
    // known, but the amount is MASKED unless the caller holds payroll.read.
    sections.compensation = await this.compensation(ctx.orgId, employeeId, held.has(permissions.payrollRead) || held.has(permissions.payrollApprove));
    authorized.push("compensation");

    return {
      employeeId,
      window: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      authorizedSections: authorized,
      ...sections,
    };
  }

  private async canSeeLeave(employeeId: string): Promise<boolean> {
    const reach = await this.approval.approvableEmployeeIds().catch(() => [] as string[] | null);
    if (reach === null) return true; // org-wide
    const own = await this.approval.callerEmployeeId().catch(() => null);
    return own === employeeId || reach.includes(employeeId);
  }

  // ---- attendance (identity-db) --------------------------------------------

  private async attendance(orgId: string, employeeId: string, from: Date, to: Date) {
    const rows = await this.prisma.attendanceRecord.findMany({
      where: { orgId, employeeId, day: { gte: from, lt: to } },
      select: { status: true, workMinutes: true, lateMinutes: true, overtimeMinutes: true, approvedOvertimeMinutes: true, earlyExitMinutes: true },
    });
    let present = 0, late = 0, absent = 0, onLeave = 0, workMinutes = 0, lateMinutes = 0, otMinutes = 0, earlyExits = 0;
    for (const r of rows) {
      if (r.status === "PRESENT") present++;
      else if (r.status === "LATE") { late++; lateMinutes += r.lateMinutes; }
      else if (r.status === "ABSENT") absent++;
      else if (r.status === "ON_LEAVE") onLeave++;
      if (r.status === "PRESENT" || r.status === "LATE") workMinutes += r.workMinutes;
      otMinutes += r.approvedOvertimeMinutes || 0;
      if (r.earlyExitMinutes > 0) earlyExits++;
    }
    const attended = present + late;
    const scheduled = attended + absent; // days they were expected & not on leave
    return {
      presentDays: present, lateDays: late, absentDays: absent, leaveDays: onLeave,
      attendanceRate: scheduled > 0 ? Math.round((attended / scheduled) * 100) : 100,
      workHours: Math.round((workMinutes / MIN) * 10) / 10,
      overtimeHours: Math.round((otMinutes / MIN) * 10) / 10,
      avgLateMinutes: late > 0 ? Math.round(lateMinutes / late) : 0,
      earlyExits,
    };
  }

  // ---- productivity (analytics read model) ---------------------------------

  private async productivity(orgId: string, employeeId: string, from: Date, to: Date) {
    const facts = await this.analytics.employeeDayFact.findMany({
      where: { orgId, employeeId, day: { gte: from, lt: to } },
      select: { activeSeconds: true, idleSeconds: true, productivityScore: true, focusScore: true },
    });
    if (facts.length === 0) return { trackedDays: 0, activeHours: 0, idleHours: 0, avgProductivity: 0, avgFocus: 0 };
    const active = facts.reduce((s, f) => s + f.activeSeconds, 0);
    const idle = facts.reduce((s, f) => s + f.idleSeconds, 0);
    const prod = facts.reduce((s, f) => s + f.productivityScore, 0) / facts.length;
    const focus = facts.reduce((s, f) => s + f.focusScore, 0) / facts.length;
    return {
      trackedDays: facts.length,
      activeHours: Math.round((active / 3600) * 10) / 10,
      idleHours: Math.round((idle / 3600) * 10) / 10,
      avgProductivity: Math.round(prod),
      avgFocus: Math.round(focus),
    };
  }

  // ---- monitoring (screenshots — identity-db metadata) ---------------------

  private async monitoring(orgId: string, employeeId: string, from: Date, to: Date) {
    const [count, last] = await Promise.all([
      this.prisma.screenshotObject.count({ where: { orgId, employeeId, capturedAt: { gte: from, lt: to } } }),
      this.prisma.screenshotObject.findFirst({ where: { orgId, employeeId }, orderBy: { capturedAt: "desc" }, select: { capturedAt: true } }),
    ]);
    return { screenshotCount: count, lastCapturedAt: last?.capturedAt?.toISOString() ?? null };
  }

  // ---- timesheets (identity-db) --------------------------------------------

  private async timesheets(orgId: string, employeeId: string, from: Date, to: Date) {
    const rows = await this.prisma.timeEntry.findMany({ where: { orgId, employeeId, date: { gte: from, lt: to } }, select: { minutes: true, billable: true } });
    const total = rows.reduce((s, r) => s + r.minutes, 0);
    const billable = rows.filter((r) => r.billable).reduce((s, r) => s + r.minutes, 0);
    return {
      loggedHours: Math.round((total / MIN) * 10) / 10,
      billableHours: Math.round((billable / MIN) * 10) / 10,
      utilization: total > 0 ? Math.round((billable / total) * 100) : 0,
    };
  }

  // ---- compensation (identity-db, field-masked) ----------------------------

  /**
   * The employee's current hourly cost rate, masked unless authorized. Even an
   * unauthorized viewer learns compensation is on file and its currency — but the
   * amount is redacted to "••••", never the number. Authorized (payroll.read)
   * viewers get the real cents value.
   */
  private async compensation(orgId: string, employeeId: string, authorized: boolean) {
    const [rate, setting] = await Promise.all([
      this.prisma.employeeRate.findFirst({ where: { orgId, employeeId, effectiveTo: null }, select: { costRateCents: true, effectiveFrom: true } }),
      this.prisma.payrollSetting.findUnique({ where: { orgId }, select: { currency: true } }),
    ]);
    const currency = setting?.currency ?? "USD";
    const cents = rate?.costRateCents ?? null;
    const field = renderField<number>(cents, "HIGHLY_RESTRICTED", authorized, () => maskAmount());
    return {
      onFile: cents !== null,
      currency,
      unit: "per hour",
      // When authorized this is the numeric cents; when masked it's the "••••" string.
      costRate: field.value,
      masked: field.masked,
      effectiveFrom: rate?.effectiveFrom ? rate.effectiveFrom.toISOString().slice(0, 10) : null,
    };
  }

  // ---- leave (identity-db) -------------------------------------------------

  private async leave(orgId: string, employeeId: string) {
    const year = new Date().getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    const taken = await this.prisma.leaveRequest.aggregate({
      where: { orgId, employeeId, status: "APPROVED", startDate: { gte: yearStart, lt: yearEnd } },
      _sum: { days: true },
    });
    const pending = await this.prisma.leaveRequest.count({ where: { orgId, employeeId, status: "PENDING" } });
    return { daysTakenThisYear: taken._sum.days ?? 0, pendingRequests: pending };
  }
}
