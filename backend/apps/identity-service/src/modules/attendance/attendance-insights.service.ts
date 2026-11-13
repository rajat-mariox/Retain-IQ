import { BadRequestException, Injectable } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { OrgRolesService } from "../../common/org-roles/org-roles.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri
const dateKey = (d: Date): string => d.toISOString().slice(0, 10);
const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, Math.round(n)));

type RiskLevel = "low" | "medium" | "high" | "critical";

/**
 * Attendance intelligence — compute-on-read scorecards derived from AttendanceRecord
 * (which lives in identity-db; we deliberately do NOT touch the analytics
 * EmployeeDayFact stream). Mirrors the composite-pillar + additive-risk-bucket
 * approach used by insights.executiveOverview(): each employee gets an attendance
 * rate, a punctuality score, a consistency score, an overall 0-100 composite, and a
 * derived risk level, all over a trailing window (default 3 months).
 */
@Injectable()
export class AttendanceInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly orgRoles: OrgRolesService,
  ) {}

  private async orgToday(orgId: string): Promise<Date> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
    const tz = org?.timezone || "UTC";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return new Date(`${parts}T00:00:00.000Z`);
  }

  async attendanceScores(monthsBack = 3) {
    const ctx = requireTenantContext();
    const span = Math.min(12, Math.max(1, Math.floor(monthsBack) || 3));
    const today = await this.orgToday(ctx.orgId);
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (span - 1), 1));

    const current = await this.computeWindow(ctx.orgId, ctx.userId, start, today, true);
    // Same-length window immediately before, for the trend deltas (avg score /
    // avg days missed). Rows aren't needed there — only the two aggregates.
    const prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - span, 1));
    const prevEnd = new Date(start.getTime() - 86_400_000); // day before the current window
    const previous = await this.computeWindow(ctx.orgId, ctx.userId, prevStart, prevEnd, false);

    const rows = current.rows;
    const n = rows.length;
    // Grade distribution (Excellent / Good / Fair / Needs attention) as counts + %.
    const gradeCounts = { excellent: 0, good: 0, fair: 0, needsAttention: 0 };
    let sumDaysMissed = 0;
    for (const r of rows) {
      sumDaysMissed += r.absentDays;
      if (!r.hasData || r.grade === "Needs attention" || r.grade === "No check-ins") gradeCounts.needsAttention += 1;
      else if (r.grade === "Excellent") gradeCounts.excellent += 1;
      else if (r.grade === "Good") gradeCounts.good += 1;
      else gradeCounts.fair += 1;
    }
    const avgDaysMissed = n > 0 ? Math.round((sumDaysMissed / n) * 10) / 10 : 0;
    const pct = (c: number) => (n > 0 ? Math.round((c / n) * 100) : 0);

    const summary = {
      employees: n,
      avgScore: current.avgScore,
      avgAttendanceRate: current.avgRate,
      avgDaysMissed,
      atRisk: current.riskCounts.high + current.riskCounts.critical,
      risk: current.riskCounts,
      distribution: {
        excellent: gradeCounts.excellent,
        good: gradeCounts.good,
        fair: gradeCounts.fair,
        needsAttention: gradeCounts.needsAttention,
        excellentPct: pct(gradeCounts.excellent),
        goodPct: pct(gradeCounts.good),
        fairPct: pct(gradeCounts.fair),
        needsAttentionPct: pct(gradeCounts.needsAttention),
      },
      // Deltas vs the previous window (positive = improved). Days-missed delta is
      // inverted so "fewer missed" reads as a positive change to the UI.
      deltaScore: current.avgScore - previous.avgScore,
      deltaDaysMissed: Math.round((avgDaysMissed - previous.avgDaysMissed) * 10) / 10,
    };

    return { months: span, from: dateKey(start).slice(0, 7), to: `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`, summary, rows };
  }

  /**
   * Score every in-scope employee over [start, endInclusive]. Returns the rows
   * (when asked) plus the window aggregates used for the summary and trend deltas.
   * Extracted so the current and previous windows share one implementation.
   */
  private async computeWindow(orgId: string, userId: string, start: Date, endInclusive: Date, withRows: boolean) {
    const today = await this.orgToday(orgId);
    const end = new Date(Date.UTC(endInclusive.getUTCFullYear(), endInclusive.getUTCMonth(), endInclusive.getUTCDate() + 1)); // exclusive
    // Never count "scheduled" days that haven't happened yet.
    const rangeEnd = end.getTime() < today.getTime() + 86_400_000 ? end : new Date(today.getTime() + 86_400_000);

    const exclude = await this.orgRoles.ownerEmployeeIds(orgId);
    const scope = await this.accessScope.resolveScope(orgId, userId, permissions.attendanceRead);
    const scopeWhere = this.accessScope.employeeWhere(scope);
    const ctx = { orgId };

    const [shifts, employees, records, holidays] = await Promise.all([
      this.prisma.shift.findMany({ where: { orgId: ctx.orgId }, select: { id: true, workingDays: true, isDefault: true, status: true } }),
      this.prisma.employee.findMany({
        where: { orgId: ctx.orgId, status: { in: ["ACTIVE", "ON_LEAVE", "NOTICE_PERIOD"] }, ...scopeWhere, ...(exclude.length > 0 ? { id: { notIn: exclude } } : {}) },
        select: { id: true, firstName: true, lastName: true, shiftId: true, departmentId: true, departmentRef: { select: { name: true } } },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      }),
      this.prisma.attendanceRecord.findMany({
        where: { orgId: ctx.orgId, day: { gte: start, lt: end } },
        select: { employeeId: true, status: true, day: true, workMinutes: true, lateMinutes: true, earlyExitMinutes: true },
      }),
      this.prisma.holiday.findMany({ where: { orgId: ctx.orgId, date: { gte: start, lt: end } }, select: { date: true, type: true, departmentId: true } }),
    ]);

    const shiftById = new Map(shifts.map((s) => [s.id, s]));
    const defaultShift = shifts.find((s) => s.isDefault && s.status === "ACTIVE") ?? null;
    const companyHolidays = new Set(holidays.filter((h) => h.type !== "DEPARTMENT").map((h) => dateKey(h.date)));
    const deptHolidays = new Map<string, Set<string>>();
    for (const h of holidays) {
      if (h.type === "DEPARTMENT" && h.departmentId) {
        const set = deptHolidays.get(h.departmentId) ?? new Set<string>();
        set.add(dateKey(h.date));
        deptHolidays.set(h.departmentId, set);
      }
    }

    // Working-day count for a (shift pattern × department) combo, holidays removed.
    const wdCache = new Map<string, number>();
    const workingDayCount = (pattern: number[], deptId: string | null): number => {
      const eff = pattern.length > 0 ? pattern : DEFAULT_WORKING_DAYS;
      const key = `${[...eff].sort((a, b) => a - b).join(",")}|${deptId ?? ""}`;
      const cached = wdCache.get(key);
      if (cached !== undefined) return cached;
      const patternSet = new Set(eff);
      const deptSet = deptId ? deptHolidays.get(deptId) : undefined;
      let count = 0;
      for (const d = new Date(start); d < rangeEnd; d.setUTCDate(d.getUTCDate() + 1)) {
        const k = dateKey(d);
        if (patternSet.has(d.getUTCDay()) && !companyHolidays.has(k) && !(deptSet && deptSet.has(k))) count += 1;
      }
      wdCache.set(key, count);
      return count;
    };

    // Per-employee raw tallies.
    type Tally = { present: number; late: number; leave: number; lateMinTotal: number; earlyExitDays: number; workMins: number[] };
    const tally = new Map<string, Tally>();
    const get = (id: string): Tally => {
      let t = tally.get(id);
      if (!t) { t = { present: 0, late: 0, leave: 0, lateMinTotal: 0, earlyExitDays: 0, workMins: [] }; tally.set(id, t); }
      return t;
    };
    for (const r of records) {
      const t = get(r.employeeId);
      if (r.status === "PRESENT") t.present += 1;
      else if (r.status === "LATE") { t.late += 1; t.lateMinTotal += r.lateMinutes; }
      else if (r.status === "ON_LEAVE") t.leave += 1;
      if (r.earlyExitMinutes > 0) t.earlyExitDays += 1;
      if (r.status === "PRESENT" || r.status === "LATE") t.workMins.push(r.workMinutes);
    }

    let sumRate = 0;
    let sumScore = 0;
    const riskCounts: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };

    const rows = employees.map((e) => {
      const empShift = (e.shiftId ? shiftById.get(e.shiftId) : null) ?? defaultShift;
      const shift = empShift && empShift.status === "ACTIVE" ? empShift : defaultShift;
      const scheduled = workingDayCount(shift ? shift.workingDays : DEFAULT_WORKING_DAYS, e.departmentId);
      const t = tally.get(e.id) ?? { present: 0, late: 0, leave: 0, lateMinTotal: 0, earlyExitDays: 0, workMins: [] };
      const attended = t.present + t.late;
      // Expected on-duty days exclude approved leave (not the employee's fault).
      const expected = Math.max(0, scheduled - t.leave);
      const absent = Math.max(0, expected - attended);

      // Did this person attend at all in the window? Punctuality/consistency are
      // only meaningful once there's at least one day worked — otherwise a phantom
      // employee (never checked in) would score a misleading "100 punctuality".
      const hasData = attended > 0;

      // 1) Attendance rate — attended / expected on-duty days.
      const attendanceRate = expected > 0 ? clamp((attended / expected) * 100) : 100;

      // 2) Punctuality — starts at 100, penalised by the share of late days and the
      // average lateness on those days (a 30-min-late habit hurts more than a 5-min one).
      const lateRatio = attended > 0 ? t.late / attended : 0;
      const avgLateMin = t.late > 0 ? t.lateMinTotal / t.late : 0;
      const earlyRatio = attended > 0 ? t.earlyExitDays / attended : 0;
      const punctuality = hasData ? clamp(100 - lateRatio * 55 - Math.min(30, avgLateMin) - earlyRatio * 15) : null;

      // 3) Consistency — steadiness of daily worked minutes. Coefficient of variation
      // (stddev / mean) → 0 CV = perfectly steady = 100; CV ≥ 0.5 → 0.
      let consistency: number | null = null;
      if (t.workMins.length >= 3) {
        const mean = t.workMins.reduce((s, v) => s + v, 0) / t.workMins.length;
        if (mean > 0) {
          const variance = t.workMins.reduce((s, v) => s + (v - mean) ** 2, 0) / t.workMins.length;
          const cv = Math.sqrt(variance) / mean;
          consistency = clamp(100 - (cv / 0.5) * 100);
        } else consistency = 0;
      } else if (hasData) {
        // 1–2 days worked: too few to judge steadiness — treat as neutral, don't punish.
        consistency = null;
      }

      // Composite 0-100 — attendance weighted highest, then punctuality, then consistency.
      // Missing pillars are dropped and the weights renormalised, so a no-data
      // employee's score is driven purely by attendance (not a phantom 100).
      const parts: { w: number; v: number }[] = [{ w: 0.5, v: attendanceRate }];
      if (punctuality !== null) parts.push({ w: 0.3, v: punctuality });
      if (consistency !== null) parts.push({ w: 0.2, v: consistency });
      const wTot = parts.reduce((s, p) => s + p.w, 0);
      const score = clamp(parts.reduce((s, p) => s + p.w * p.v, 0) / wTot);

      // Risk — additive buckets, mirroring the attrition pattern in insights.
      let r = 0;
      if (attendanceRate < 70) r += 35;
      else if (attendanceRate < 85) r += 15;
      if (lateRatio > 0.4) r += 25;
      else if (lateRatio > 0.2) r += 12;
      if (absent >= 5) r += 25;
      else if (absent >= 2) r += 10;
      if (earlyRatio > 0.3) r += 10;
      const risk: RiskLevel = r >= 60 ? "critical" : r >= 40 ? "high" : r >= 20 ? "medium" : "low";
      riskCounts[risk] += 1;
      sumRate += attendanceRate;
      sumScore += score;

      // Plain-language grade + the single biggest reason behind the risk, so a
      // non-technical manager reads intent, not raw 0-100 numbers.
      const grade = !hasData ? "No check-ins" : score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 55 ? "Fair" : "Needs attention";
      let reason: string;
      if (!hasData) reason = "No attendance recorded this period";
      else if (attendanceRate < 70) reason = "Low attendance";
      else if (lateRatio > 0.4) reason = "Frequently late";
      else if (absent >= 5) reason = "Several days absent";
      else if (attendanceRate < 85) reason = "Some days missed";
      else if (lateRatio > 0.2) reason = "Occasionally late";
      else if (earlyRatio > 0.3) reason = "Often leaves early";
      else reason = "On track";

      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        department: e.departmentRef?.name ?? null,
        scheduledDays: scheduled,
        presentDays: t.present,
        lateDays: t.late,
        leaveDays: t.leave,
        absentDays: absent,
        avgLateMinutes: Math.round(avgLateMin),
        hasData,
        attendanceRate,
        punctuality,
        consistency,
        score,
        grade,
        risk,
        reason,
      };
    });

    rows.sort((a, b) => a.score - b.score); // most at-risk first

    const n = rows.length;
    const avgDaysMissed = n > 0 ? rows.reduce((s, r) => s + r.absentDays, 0) / n : 0;
    return {
      rows: withRows ? rows : [],
      avgScore: n > 0 ? Math.round(sumScore / n) : 0,
      avgRate: n > 0 ? Math.round(sumRate / n) : 0,
      avgDaysMissed,
      riskCounts,
    };
  }
}
