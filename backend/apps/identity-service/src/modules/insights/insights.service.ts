import { BadRequestException, Injectable } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { AnalyticsReadPrismaService } from "../../common/database/analytics-prisma.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { classifyApp, classifyDomain, type ProductivityRules } from "../../common/productivity/classify.js";
import { ProductivitySettingsService } from "../../common/productivity/productivity-settings.service.js";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
const hours = (sec: number | null | undefined) => Math.round((sec ?? 0) / 3600);
const score = (v: number | null | undefined) => Math.round(v ?? 0);
const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsReadPrismaService,
    private readonly productivity: ProductivitySettingsService,
  ) {}

  private windowStart(): Date {
    return new Date(Date.now() - WINDOW_DAYS * DAY_MS);
  }

  /** Productive seconds per employee (org-configurable classification of app/site usage). */
  private async productiveSecondsByEmployee(where: { orgId: string; day: { gte: Date; lt?: Date }; employeeId?: string }, rules: ProductivityRules): Promise<Map<string, number>> {
    const [apps, sites] = await Promise.all([
      this.analytics.appUsageDaily.findMany({ where, select: { employeeId: true, appName: true, seconds: true } }),
      this.analytics.websiteUsageDaily.findMany({ where, select: { employeeId: true, domain: true, seconds: true } }),
    ]);
    const map = new Map<string, number>();
    const add = (id: string, s: number) => map.set(id, (map.get(id) ?? 0) + s);
    for (const a of apps) if (classifyApp(a.appName, rules) === "PRODUCTIVE") add(a.employeeId, a.seconds);
    for (const s of sites) if (classifyDomain(s.domain, rules) === "PRODUCTIVE") add(s.employeeId, s.seconds);
    return map;
  }

  /** The caller's own time/productivity (Time Tracking + personal insights). */
  async me() {
    const ctx = requireTenantContext();
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { id: ctx.membershipId },
      select: { employeeId: true },
    });
    if (!membership?.employeeId) {
      throw new BadRequestException("Your account is not linked to an employee record.");
    }

    const since = this.windowStart();
    const employeeId = membership.employeeId;
    const [facts, apps, sites, rules] = await Promise.all([
      this.analytics.employeeDayFact.findMany({ where: { orgId: ctx.orgId, employeeId, day: { gte: since } }, orderBy: { day: "asc" } }),
      this.analytics.appUsageDaily.findMany({ where: { orgId: ctx.orgId, employeeId, day: { gte: since } }, select: { day: true, appName: true, seconds: true } }),
      this.analytics.websiteUsageDaily.findMany({ where: { orgId: ctx.orgId, employeeId, day: { gte: since } }, select: { day: true, domain: true, seconds: true } }),
      this.productivity.getRules(ctx.orgId),
    ]);

    // Productive seconds per day = configured productive apps + domains.
    const prodByDay = new Map<string, number>();
    const addDay = (day: Date, s: number) => { const k = day.toISOString().slice(0, 10); prodByDay.set(k, (prodByDay.get(k) ?? 0) + s); };
    for (const a of apps) if (classifyApp(a.appName, rules) === "PRODUCTIVE") addDay(a.day, a.seconds);
    for (const s of sites) if (classifyDomain(s.domain, rules) === "PRODUCTIVE") addDay(s.day, s.seconds);

    const series = facts.map((f) => {
      const d = f.day.toISOString().slice(0, 10);
      const active = f.activeSeconds ?? 0;
      const productiveSec = active > 0 ? Math.min(prodByDay.get(d) ?? 0, active) : prodByDay.get(d) ?? 0;
      return {
        date: d,
        activeHours: hours(f.activeSeconds),
        productiveHours: hours(productiveSec),
        idleHours: hours(f.idleSeconds),
        productivity: pct(productiveSec, active),
        focus: score(f.focusScore),
      };
    });

    const trackedDays = series.length;
    const totals = {
      activeHours: series.reduce((s, d) => s + d.activeHours, 0),
      productiveHours: series.reduce((s, d) => s + d.productiveHours, 0),
      avgProductivity: trackedDays ? Math.round(series.reduce((s, d) => s + d.productivity, 0) / trackedDays) : 0,
      avgFocus: trackedDays ? Math.round(series.reduce((s, d) => s + d.focus, 0) / trackedDays) : 0,
      trackedDays,
    };

    // Momentum: second-half vs first-half average productivity.
    const mid = Math.floor(trackedDays / 2);
    const firstAvg = avg(series.slice(0, mid).map((d) => d.productivity));
    const lastAvg = avg(series.slice(mid).map((d) => d.productivity));
    const momentum = lastAvg - firstAvg;

    return {
      series,
      totals,
      momentum: { direction: momentum > 3 ? "up" : momentum < -3 ? "down" : "stable", deltaPct: Math.round(momentum) },
    };
  }

  /** Org-wide workforce insights (AI Analytics — derived heuristics, not an LLM). */
  async team() {
    const ctx = requireTenantContext();
    const since = this.windowStart();
    const rules = await this.productivity.getRules(ctx.orgId);
    const [byEmployee, employees, prodByEmp] = await Promise.all([
      this.analytics.employeeDayFact.groupBy({
        by: ["employeeId"],
        where: { orgId: ctx.orgId, day: { gte: since } },
        _avg: { focusScore: true },
        _sum: { activeSeconds: true },
        _count: { _all: true },
      }),
      this.prisma.employee.findMany({ where: { orgId: ctx.orgId }, select: { id: true, firstName: true, lastName: true } }),
      this.productiveSecondsByEmployee({ orgId: ctx.orgId, day: { gte: since } }, rules),
    ]);

    const names = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));

    const people = byEmployee.map((f) => {
      const days = f._count._all || 1;
      const activeSec = f._sum.activeSeconds ?? 0;
      const activeHours = hours(activeSec);
      const productivity = pct(prodByEmp.get(f.employeeId) ?? 0, activeSec);
      const focus = score(f._avg.focusScore);
      const avgDailyHours = activeHours / days;
      const risk =
        avgDailyHours > 9 && focus < 70 ? "burnout_risk" : avgDailyHours < 3 ? "low_engagement" : "healthy";
      return {
        employeeId: f.employeeId,
        name: names.get(f.employeeId) ?? "Unknown",
        productivity,
        focus,
        activeHours,
        trackedDays: f._count._all,
        risk,
      };
    });

    const tracked = people.length || 1;
    const avgProductivity = Math.round(people.reduce((s, p) => s + p.productivity, 0) / tracked);
    const avgFocus = Math.round(people.reduce((s, p) => s + p.focus, 0) / tracked);
    const burnoutRisk = people.filter((p) => p.risk === "burnout_risk").length;
    const lowEngagement = people.filter((p) => p.risk === "low_engagement").length;
    const workforceHealth = Math.round(0.6 * avgProductivity + 0.4 * avgFocus);
    const topPerformers = [...people].sort((a, b) => b.productivity - a.productivity).slice(0, 5);

    return {
      summary: {
        trackedEmployees: people.length,
        avgProductivity,
        avgFocus,
        workforceHealth,
        burnoutRisk,
        lowEngagement,
      },
      topPerformers,
      people: [...people].sort((a, b) => b.productivity - a.productivity),
    };
  }

  /**
   * Executive Overview: workforce headcount + health score + attrition risk +
   * productivity, org-wide. Headcount/attendance/productivity are REAL (Employee
   * status, AttendanceRecord, EmployeeDayFact). Risk/attrition/burnout are DERIVED
   * heuristics (documented — not an ML model). openPositions is 0 until a
   * requisition entity exists.
   */
  async executiveOverview() {
    const ctx = requireTenantContext();
    const since = this.windowStart();
    const half = new Date(Date.now() - 15 * DAY_MS);

    // Owner/admin accounts are provisioned as Employee records but are NOT part of
    // the workforce — exclude them from the headcount metrics.
    const admins = await this.prisma.organizationMembership.findMany({
      where: { orgId: ctx.orgId, status: "ACTIVE", role: { name: "Owner" }, employeeId: { not: null } },
      select: { employeeId: true },
    });
    const excludeIds = admins.map((a) => a.employeeId).filter((x): x is string => Boolean(x));
    const empWhere = excludeIds.length > 0 ? { orgId: ctx.orgId, id: { notIn: excludeIds } } : { orgId: ctx.orgId };

    const rules = await this.productivity.getRules(ctx.orgId);
    const [statusGroups, newJoinees, byEmployee, attendanceGroups, recentActive, priorActive, openReqs, prodAll, prodRecent, prodPrior] = await Promise.all([
      this.prisma.employee.groupBy({ by: ["status"], where: empWhere, _count: { _all: true } }),
      this.prisma.employee.count({ where: { ...empWhere, createdAt: { gte: since } } }),
      this.analytics.employeeDayFact.groupBy({
        by: ["employeeId"],
        where: { orgId: ctx.orgId, day: { gte: since } },
        _avg: { focusScore: true },
        _sum: { activeSeconds: true },
        _count: { _all: true },
      }),
      this.prisma.attendanceRecord.groupBy({ by: ["status"], where: { orgId: ctx.orgId, day: { gte: since } }, _count: { _all: true } }),
      this.analytics.employeeDayFact.aggregate({ _sum: { activeSeconds: true }, where: { orgId: ctx.orgId, day: { gte: half } } }),
      this.analytics.employeeDayFact.aggregate({ _sum: { activeSeconds: true }, where: { orgId: ctx.orgId, day: { gte: since, lt: half } } }),
      this.prisma.requisition.aggregate({ _sum: { openings: true }, where: { orgId: ctx.orgId, status: "OPEN" } }),
      this.productiveSecondsByEmployee({ orgId: ctx.orgId, day: { gte: since } }, rules),
      this.productiveSecondsByEmployee({ orgId: ctx.orgId, day: { gte: half } }, rules),
      this.productiveSecondsByEmployee({ orgId: ctx.orgId, day: { gte: since, lt: half } }, rules),
    ]);

    // --- Workforce Overview (real headcount) ---
    const st = (s: string) => statusGroups.find((g) => g.status === s)?._count._all ?? 0;
    const total = statusGroups.reduce((a, g) => a + g._count._all, 0);
    const workforce = {
      total,
      active: st("ACTIVE"),
      newJoinees,
      onLeave: st("ON_LEAVE"),
      noticePeriod: st("NOTICE_PERIOD"),
      openPositions: openReqs._sum.openings ?? 0, // sum of OPEN requisition openings
    };

    // --- Productivity Overview (real) ---
    const per = byEmployee.map((f) => {
      const active = f._sum.activeSeconds ?? 0;
      const productive = prodAll.get(f.employeeId) ?? 0;
      return {
        productivity: pct(productive, active),
        focus: score(f._avg.focusScore),
        active,
        productive,
        days: f._count._all,
      };
    });
    const n = per.length || 1;
    const companyProductivity = Math.round(per.reduce((s, p) => s + p.productivity, 0) / n);
    const focusScore = Math.round(per.reduce((s, p) => s + p.focus, 0) / n);
    const totActive = per.reduce((s, p) => s + p.active, 0);
    const totProductive = per.reduce((s, p) => s + p.productive, 0);
    const productivity = {
      companyProductivity,
      focusScore,
      activeHours: hours(totActive),
      utilization: totActive > 0 ? Math.round((totProductive / totActive) * 100) : 0,
    };

    // Attendance rate (30d) — for the health pillar.
    const attTotal = attendanceGroups.reduce((a, g) => a + g._count._all, 0);
    const attPresent = (attendanceGroups.find((g) => g.status === "PRESENT")?._count._all ?? 0) + (attendanceGroups.find((g) => g.status === "LATE")?._count._all ?? 0);
    const attendanceRate = attTotal > 0 ? Math.round((attPresent / attTotal) * 100) : 0;

    // --- Attrition Overview (derived risk buckets) ---
    let high = 0;
    let medium = 0;
    let critical = 0;
    let burnoutCount = 0;
    for (const p of per) {
      const avgDaily = p.days ? p.active / 3600 / p.days : 0;
      let r = 0;
      if (p.productivity < 60) r += 30;
      else if (p.productivity < 75) r += 15;
      if (p.focus < 60) r += 20;
      else if (p.focus < 75) r += 10;
      if (avgDaily > 9.5) r += 30;
      else if (avgDaily > 8.5) r += 15; // overwork → burnout
      if (avgDaily < 3) r += 25; // disengagement
      if (avgDaily > 8.5 && p.focus < 70) burnoutCount++;
      if (r >= 60) critical += 1;
      else if (r >= 40) high += 1;
      else if (r >= 25) medium += 1;
    }
    const sumMap = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
    const trendDelta = pct(sumMap(prodRecent), recentActive._sum.activeSeconds ?? 0) - pct(sumMap(prodPrior), priorActive._sum.activeSeconds ?? 0);
    const attrition = {
      high,
      medium,
      critical,
      atRiskPct: per.length ? Math.round(((high + critical) / per.length) * 100) : 0,
      trend: trendDelta < -3 ? "worsening" : trendDelta > 3 ? "improving" : "stable",
      trendDelta,
    };

    // --- Workforce Health Score (0-100 composite) ---
    const engagement = focusScore; // proxy for engagement
    const riskPillar = per.length ? Math.round(100 - ((high + critical) / per.length) * 100) : 100;
    const burnoutPillar = per.length ? Math.round(100 - (burnoutCount / per.length) * 100) : 100;
    const pillars = { productivity: companyProductivity, attendance: attendanceRate, engagement, risk: riskPillar, burnout: burnoutPillar };
    const healthScore = Math.round(0.3 * pillars.productivity + 0.2 * pillars.attendance + 0.2 * pillars.engagement + 0.15 * pillars.risk + 0.15 * pillars.burnout);

    return { workforce, health: { score: healthScore, pillars }, attrition, productivity };
  }
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}
