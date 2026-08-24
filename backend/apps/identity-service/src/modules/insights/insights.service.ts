import { BadRequestException, Injectable } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { AnalyticsReadPrismaService } from "../../common/database/analytics-prisma.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
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
    private readonly accessScope: AccessScopeService,
  ) {}

  private windowStart(): Date {
    return new Date(Date.now() - WINDOW_DAYS * DAY_MS);
  }

  /** Productive seconds per employee (org-configurable classification of app/site usage). */
  private async productiveSecondsByEmployee(where: { orgId: string; day: { gte: Date; lt?: Date }; employeeId?: string | { in: string[] } }, rules: ProductivityRules): Promise<Map<string, number>> {
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
    const [byEmployee, employees, prodByEmp, prodGoal] = await Promise.all([
      this.analytics.employeeDayFact.groupBy({
        by: ["employeeId"],
        where: { orgId: ctx.orgId, day: { gte: since } },
        _avg: { focusScore: true },
        _sum: { activeSeconds: true },
        _count: { _all: true },
      }),
      this.prisma.employee.findMany({ where: { orgId: ctx.orgId }, select: { id: true, firstName: true, lastName: true } }),
      this.productiveSecondsByEmployee({ orgId: ctx.orgId, day: { gte: since } }, rules),
      // The org-level productivity target (a Goal with metric='productivity', no
      // project). Optional — null when the org hasn't set one.
      this.prisma.goal.findFirst({ where: { orgId: ctx.orgId, metric: "productivity", projectId: null, ownerEmployeeId: null }, select: { target: true }, orderBy: { updatedAt: "desc" } }),
    ]);
    const productivityTarget = prodGoal?.target != null ? Math.round(prodGoal.target) : null;

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
        targetMet: productivityTarget != null ? productivity >= productivityTarget : null,
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
        productivityTarget, // org's productivity goal (%), or null if unset
        onTargetCount: productivityTarget != null ? people.filter((p) => p.productivity >= productivityTarget).length : null,
      },
      topPerformers,
      people: [...people].sort((a, b) => b.productivity - a.productivity),
    };
  }

  /** The org's productivity target (%), stored as an org-level Goal. Null if unset. */
  async getProductivityTarget() {
    const ctx = requireTenantContext();
    const g = await this.prisma.goal.findFirst({ where: { orgId: ctx.orgId, metric: "productivity", projectId: null, ownerEmployeeId: null }, select: { target: true }, orderBy: { updatedAt: "desc" } });
    return { target: g?.target != null ? Math.round(g.target) : null };
  }

  /** Set (or clear) the org's productivity target. Stored as a single org-level Goal. */
  async setProductivityTarget(target: number | null) {
    const ctx = requireTenantContext();
    const existing = await this.prisma.goal.findFirst({ where: { orgId: ctx.orgId, metric: "productivity", projectId: null, ownerEmployeeId: null }, select: { id: true } });
    if (target == null) {
      if (existing) await this.prisma.goal.delete({ where: { id: existing.id } });
      return { target: null };
    }
    const t = Math.max(0, Math.min(100, Math.round(target)));
    if (existing) await this.prisma.goal.update({ where: { id: existing.id }, data: { target: t, status: "ACTIVE" } });
    else await this.prisma.goal.create({ data: { orgId: ctx.orgId, title: "Productivity target", metric: "productivity", target: t, status: "ACTIVE" } });
    return { target: t };
  }

  /**
   * Productivity rolled up by department and by team — averages of productivity,
   * focus and active hours across each group's tracked employees, plus headcount
   * and a burnout-risk count. Scope-aware: an org-wide role sees every group; a
   * department/team-scoped manager sees only their own.
   */
  async byGroup() {
    const ctx = requireTenantContext();
    const since = this.windowStart();
    const rules = await this.productivity.getRules(ctx.orgId);

    const scope = await this.accessScope.resolveScope(ctx.orgId, ctx.userId, permissions.employeeRead);
    const visible = await this.accessScope.visibleEmployeeIds(ctx.orgId, scope);
    const empWhere = visible === null ? { orgId: ctx.orgId } : { orgId: ctx.orgId, id: { in: visible } };

    const [employees, departments, teams, facts, prodByEmp] = await Promise.all([
      this.prisma.employee.findMany({ where: empWhere, select: { id: true, departmentId: true, teamId: true } }),
      this.prisma.department.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
      this.prisma.team.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
      this.analytics.employeeDayFact.groupBy({
        by: ["employeeId"],
        where: { orgId: ctx.orgId, day: { gte: since } },
        _avg: { focusScore: true },
        _sum: { activeSeconds: true },
        _count: { _all: true },
      }),
      this.productiveSecondsByEmployee({ orgId: ctx.orgId, day: { gte: since } }, rules),
    ]);

    // Per-employee productivity/focus/hours, keyed for grouping.
    const factByEmp = new Map(facts.map((f) => [f.employeeId, f]));
    const perEmp = new Map<string, { productivity: number; focus: number; activeHours: number; risk: boolean }>();
    for (const e of employees) {
      const f = factByEmp.get(e.id);
      if (!f) continue; // no tracked activity in the window — excluded from the average
      const activeSec = f._sum.activeSeconds ?? 0;
      const days = f._count._all || 1;
      const activeHours = hours(activeSec);
      const productivity = pct(prodByEmp.get(e.id) ?? 0, activeSec);
      const focus = score(f._avg.focusScore);
      const risk = activeHours / days > 9 && focus < 70;
      perEmp.set(e.id, { productivity, focus, activeHours, risk });
    }

    // Aggregate a list of employee ids into one group row.
    const rollup = (name: string, empIds: string[]) => {
      const tracked = empIds.map((id) => perEmp.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
      const n = tracked.length;
      const avg = (sel: (t: (typeof tracked)[number]) => number) => (n > 0 ? Math.round(tracked.reduce((s, t) => s + sel(t), 0) / n) : 0);
      return {
        name,
        headcount: empIds.length,
        trackedEmployees: n,
        avgProductivity: avg((t) => t.productivity),
        avgFocus: avg((t) => t.focus),
        avgActiveHours: n > 0 ? Math.round((tracked.reduce((s, t) => s + t.activeHours, 0) / n) * 10) / 10 : 0,
        burnoutRisk: tracked.filter((t) => t.risk).length,
      };
    };

    const byDeptIds = new Map<string, string[]>();
    const byTeamIds = new Map<string, string[]>();
    for (const e of employees) {
      if (e.departmentId) byDeptIds.set(e.departmentId, [...(byDeptIds.get(e.departmentId) ?? []), e.id]);
      if (e.teamId) byTeamIds.set(e.teamId, [...(byTeamIds.get(e.teamId) ?? []), e.id]);
    }

    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const teamName = new Map(teams.map((t) => [t.id, t.name]));

    const byDepartment = [...byDeptIds.entries()]
      .map(([id, ids]) => ({ id, ...rollup(deptName.get(id) ?? "Unknown", ids) }))
      .sort((a, b) => b.avgProductivity - a.avgProductivity);
    const byTeam = [...byTeamIds.entries()]
      .map(([id, ids]) => ({ id, ...rollup(teamName.get(id) ?? "Unknown", ids) }))
      .sort((a, b) => b.avgProductivity - a.avgProductivity);

    return { byDepartment, byTeam };
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

    // Dashboard analytics are scope-aware, not permission-gated: an Owner (org
    // tier) sees the whole org; a department/team-scoped manager sees their unit;
    // a plain employee sees only themselves. `visible` is the set of employee ids
    // the caller may see, or null for org-wide (no restriction).
    const scope = await this.accessScope.resolveScope(ctx.orgId, ctx.userId, permissions.employeeRead);
    const visible = await this.accessScope.visibleEmployeeIds(ctx.orgId, scope);

    // Owner/admin accounts are provisioned as Employee records but are NOT part of
    // the workforce — exclude them from the headcount metrics.
    const admins = await this.prisma.organizationMembership.findMany({
      where: { orgId: ctx.orgId, status: "ACTIVE", role: { name: "Owner" }, employeeId: { not: null } },
      select: { employeeId: true },
    });
    const excludeIds = admins.map((a) => a.employeeId).filter((x): x is string => Boolean(x));

    // Employee-table filter: org tier → just exclude admins; scoped/self → restrict
    // to the visible id set (minus admins).
    const scopedIds = visible === null ? null : visible.filter((id) => !excludeIds.includes(id));
    const empWhere: { orgId: string; id?: { in?: string[]; notIn?: string[] } } =
      scopedIds === null
        ? excludeIds.length > 0
          ? { orgId: ctx.orgId, id: { notIn: excludeIds } }
          : { orgId: ctx.orgId }
        : { orgId: ctx.orgId, id: { in: scopedIds } };
    // Fact/attendance filter keyed by employeeId (analytics + attendance rows).
    const factEmp = visible === null ? {} : { employeeId: { in: visible } };

    const rules = await this.productivity.getRules(ctx.orgId);
    const [statusGroups, newJoinees, byEmployee, attendanceGroups, recentActive, priorActive, openReqs, prodAll, prodRecent, prodPrior] = await Promise.all([
      this.prisma.employee.groupBy({ by: ["status"], where: empWhere, _count: { _all: true } }),
      this.prisma.employee.count({ where: { ...empWhere, createdAt: { gte: since } } }),
      this.analytics.employeeDayFact.groupBy({
        by: ["employeeId"],
        where: { orgId: ctx.orgId, day: { gte: since }, ...factEmp },
        _avg: { focusScore: true },
        _sum: { activeSeconds: true },
        _count: { _all: true },
      }),
      this.prisma.attendanceRecord.groupBy({ by: ["status"], where: { orgId: ctx.orgId, day: { gte: since }, ...factEmp }, _count: { _all: true } }),
      this.analytics.employeeDayFact.aggregate({ _sum: { activeSeconds: true }, where: { orgId: ctx.orgId, day: { gte: half }, ...factEmp } }),
      this.analytics.employeeDayFact.aggregate({ _sum: { activeSeconds: true }, where: { orgId: ctx.orgId, day: { gte: since, lt: half }, ...factEmp } }),
      // Open requisitions are an org-level figure; only surface it at org tier so a
      // scoped viewer doesn't see org-wide hiring numbers outside their reach.
      visible === null
        ? this.prisma.requisition.aggregate({ _sum: { openings: true }, where: { orgId: ctx.orgId, status: "OPEN" } })
        : Promise.resolve({ _sum: { openings: 0 } }),
      this.productiveSecondsByEmployee({ orgId: ctx.orgId, day: { gte: since }, ...factEmp }, rules),
      this.productiveSecondsByEmployee({ orgId: ctx.orgId, day: { gte: half }, ...factEmp }, rules),
      this.productiveSecondsByEmployee({ orgId: ctx.orgId, day: { gte: since, lt: half }, ...factEmp }, rules),
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
    // With NO tracked activity yet (e.g. a brand-new org), the health score and
    // its pillars are undefined — not a fabricated 100. A "risk" or "burnout"
    // pillar shown as 100 for an org with zero data reads as "100% risk" and is
    // misleading; return null so the UI shows "—" / "No activity data yet".
    const hasData = per.length > 0;
    const engagement = focusScore; // proxy for engagement
    const riskPillar = Math.round(100 - ((high + critical) / per.length) * 100);
    const burnoutPillar = Math.round(100 - (burnoutCount / per.length) * 100);
    const pillars = hasData
      ? { productivity: companyProductivity, attendance: attendanceRate, engagement, risk: riskPillar, burnout: burnoutPillar }
      : { productivity: null, attendance: null, engagement: null, risk: null, burnout: null };
    const healthScore = hasData
      ? Math.round(0.3 * companyProductivity + 0.2 * attendanceRate + 0.2 * engagement + 0.15 * riskPillar + 0.15 * burnoutPillar)
      : null;

    // --- Workflow alerts (Observation → Escalation → Incident funnel) ---
    // The open-case counts across the action spine, scoped to the caller's reach.
    const empScope = visible === null ? {} : { employeeId: { in: visible.length > 0 ? visible : ["00000000-0000-0000-0000-000000000000"] } };
    const [openObservations, criticalObservations, activeEscalations, overdueEscalations, openIncidents] = await Promise.all([
      this.prisma.observation.count({ where: { orgId: ctx.orgId, status: { in: ["OPEN", "ACKNOWLEDGED"] }, ...empScope } }),
      this.prisma.observation.count({ where: { orgId: ctx.orgId, severity: "CRITICAL", status: { notIn: ["RESOLVED", "DISMISSED"] }, ...empScope } }),
      this.prisma.escalation.count({ where: { orgId: ctx.orgId, status: { in: ["PENDING", "ACKNOWLEDGED"] }, ...empScope } }),
      this.prisma.escalation.count({ where: { orgId: ctx.orgId, status: "PENDING", dueAt: { not: null, lt: new Date() }, ...empScope } }),
      this.prisma.incident.count({ where: { orgId: ctx.orgId, status: { in: ["OPEN", "INVESTIGATING"] }, ...(visible === null ? {} : { employeeId: { in: visible.length > 0 ? visible : ["00000000-0000-0000-0000-000000000000"] } }) } }),
    ]);
    const alerts = { openObservations, criticalObservations, activeEscalations, overdueEscalations, openIncidents };

    return { workforce, health: { score: healthScore, pillars }, attrition, productivity, alerts };
  }
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}
