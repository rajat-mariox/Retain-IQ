import { Injectable } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { AnalyticsReadPrismaService } from "../../common/database/analytics-prisma.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";

const MONTH_MS = 30 * 24 * 3600 * 1000;

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}
function pct(n: number, d: number) {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}
function round1(n: number) {
  return Math.round(n * 10) / 10;
}

interface EmpRow {
  id: string;
  departmentId: string | null;
  teamId: string | null;
  gender: string | null;
  employmentType: string | null;
  lifecycleStage: string;
  status: string;
  joinDate: Date | null;
  exitedAt: Date | null;
}

@Injectable()
export class HrAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsReadPrismaService,
  ) {}

  private async loadEmployees(orgId: string): Promise<EmpRow[]> {
    const rows = await this.prisma.employee.findMany({
      where: { orgId },
      select: { id: true, departmentId: true, teamId: true, gender: true, employmentType: true, lifecycleStage: true, status: true, joinedAt: true, createdAt: true, exitedAt: true },
    });
    return rows.map((e) => ({
      id: e.id,
      departmentId: e.departmentId,
      teamId: e.teamId,
      gender: e.gender,
      employmentType: e.employmentType,
      lifecycleStage: e.lifecycleStage,
      status: e.status,
      joinDate: e.joinedAt ?? e.createdAt ?? null,
      exitedAt: e.exitedAt,
    }));
  }

  private isActiveAt(e: EmpRow, at: Date) {
    if (e.joinDate && e.joinDate > at) return false;
    if (e.exitedAt && e.exitedAt <= at) return false;
    return true;
  }

  async overview() {
    const ctx = requireTenantContext();
    const now = new Date();
    const [emps, deptRows, teamRows] = await Promise.all([
      this.loadEmployees(ctx.orgId),
      this.prisma.department.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
      this.prisma.team.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
    ]);
    const deptName = new Map(deptRows.map((d) => [d.id, d.name]));
    const teamName = new Map(teamRows.map((t) => [t.id, t.name]));

    // ---- Headcount & growth over the last 12 months ----
    const months: { key: string; label: string; end: Date }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0); // last day of that month
      months.push({ key: monthKey(d), label: monthLabel(d), end: d });
    }
    const headcountSeries = months.map((m, idx) => {
      const start = idx === 0 ? new Date(0) : months[idx - 1]!.end;
      const headcount = emps.filter((e) => this.isActiveAt(e, m.end)).length;
      const joins = emps.filter((e) => e.joinDate && e.joinDate > start && e.joinDate <= m.end).length;
      const exits = emps.filter((e) => e.exitedAt && e.exitedAt > start && e.exitedAt <= m.end).length;
      return { month: m.label, headcount, joins, exits };
    });

    // ---- Attrition (real, last 12 months) ----
    const yearAgo = new Date(now.getTime() - 365 * 24 * 3600 * 1000);
    const exits12m = emps.filter((e) => e.exitedAt && e.exitedAt >= yearAgo).length;
    const currentHeadcount = emps.filter((e) => this.isActiveAt(e, now)).length;
    // Average only over months the org actually had staff — a young org would otherwise
    // average in empty months and collapse the denominator, inflating the rate.
    const staffedMonths = headcountSeries.filter((m) => m.headcount > 0);
    const avgHeadcount = staffedMonths.length ? staffedMonths.reduce((a, m) => a + m.headcount, 0) / staffedMonths.length : currentHeadcount;

    // ---- Tenure (active employees) ----
    const active = emps.filter((e) => this.isActiveAt(e, now));
    const tenures = active.map((e) => (e.joinDate ? (now.getTime() - e.joinDate.getTime()) / MONTH_MS : 0));
    const avgTenureMonths = tenures.length ? round1(tenures.reduce((a, t) => a + t, 0) / tenures.length) : 0;
    const tenureBuckets = [
      { label: "< 1 yr", count: tenures.filter((t) => t < 12).length },
      { label: "1–2 yrs", count: tenures.filter((t) => t >= 12 && t < 24).length },
      { label: "2–5 yrs", count: tenures.filter((t) => t >= 24 && t < 60).length },
      { label: "5+ yrs", count: tenures.filter((t) => t >= 60).length },
    ];

    // ---- Distributions (active) ----
    const distByKey = (get: (e: EmpRow) => string | null, resolve?: Map<string, string>) => {
      const m = new Map<string, number>();
      for (const e of active) {
        const raw = get(e);
        const key = raw ? (resolve?.get(raw) ?? raw) : "Unassigned";
        m.set(key, (m.get(key) ?? 0) + 1);
      }
      return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    };

    // ---- Lifecycle funnel ----
    const lifecycle = { onboarding: 0, probation: 0, confirmed: 0, exited: 0 };
    for (const e of emps) {
      if (e.lifecycleStage === "ONBOARDING") lifecycle.onboarding++;
      else if (e.lifecycleStage === "PROBATION") lifecycle.probation++;
      else if (e.lifecycleStage === "CONFIRMED") lifecycle.confirmed++;
      else if (e.lifecycleStage === "EXITED") lifecycle.exited++;
    }

    // ---- Performance rating distribution ----
    const reviews = await this.prisma.performanceReview.findMany({
      where: { orgId: ctx.orgId, overallRating: { not: null } },
      select: { overallRating: true, employee: { select: { departmentId: true } } },
    });
    const ratingDist = [1, 2, 3, 4, 5].map((r) => ({ rating: r, count: reviews.filter((x) => x.overallRating === r).length }));
    const avgRating = reviews.length ? round1(reviews.reduce((a, x) => a + (x.overallRating ?? 0), 0) / reviews.length) : null;
    const deptPerf = new Map<string, { sum: number; n: number }>();
    for (const x of reviews) {
      const key = x.employee.departmentId ? (deptName.get(x.employee.departmentId) ?? "Unassigned") : "Unassigned";
      const cur = deptPerf.get(key) ?? { sum: 0, n: 0 };
      cur.sum += x.overallRating ?? 0;
      cur.n++;
      deptPerf.set(key, cur);
    }
    const performanceByDept = [...deptPerf.entries()].map(([name, v]) => ({ name, avg: round1(v.sum / v.n), rated: v.n })).sort((a, b) => b.avg - a.avg);

    // ---- Onboarding completion ----
    const journeys = await this.prisma.onboardingJourney.findMany({ where: { orgId: ctx.orgId }, select: { status: true, startedAt: true, completedAt: true } });
    const completed = journeys.filter((j) => j.status === "COMPLETED");
    const daysToComplete = completed.filter((j) => j.completedAt).map((j) => (j.completedAt!.getTime() - j.startedAt.getTime()) / (24 * 3600 * 1000));
    const onboarding = {
      total: journeys.length,
      completed: completed.length,
      inProgress: journeys.filter((j) => j.status === "IN_PROGRESS").length,
      completionPct: pct(completed.length, journeys.length),
      avgDaysToComplete: daysToComplete.length ? round1(daysToComplete.reduce((a, d) => a + d, 0) / daysToComplete.length) : null,
    };

    return {
      headcount: { current: currentHeadcount, series: headcountSeries },
      attrition: { exits12m, avgHeadcount: Math.round(avgHeadcount), ratePct: pct(exits12m, avgHeadcount) },
      tenure: { avgMonths: avgTenureMonths, buckets: tenureBuckets },
      distribution: {
        byDepartment: distByKey((e) => e.departmentId, deptName),
        byTeam: distByKey((e) => e.teamId, teamName),
        byEmploymentType: distByKey((e) => e.employmentType),
        byGender: distByKey((e) => e.gender),
      },
      lifecycle,
      performance: { rated: reviews.length, avgRating, distribution: ratingDist, byDepartment: performanceByDept },
      onboarding,
    };
  }

  async talentRisk() {
    const ctx = requireTenantContext();
    const now = new Date();
    const [emps, deptRows] = await Promise.all([
      this.loadEmployees(ctx.orgId),
      this.prisma.department.findMany({ where: { orgId: ctx.orgId }, select: { id: true, name: true } }),
    ]);
    const deptName = new Map(deptRows.map((d) => [d.id, d.name]));

    // Activity-based burnout signal (last 30 days) per employee, from analytics DB.
    const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const facts = await this.analytics.employeeDayFact.groupBy({
      by: ["employeeId"],
      where: { orgId: ctx.orgId, day: { gte: since } },
      _sum: { activeSeconds: true },
      _avg: { focusScore: true },
      _count: { _all: true },
    });
    const burnoutByEmp = new Map<string, boolean>();
    for (const f of facts) {
      const days = f._count._all || 1;
      const avgDailyHours = (f._sum.activeSeconds ?? 0) / days / 3600;
      const focus = f._avg.focusScore ?? 100;
      burnoutByEmp.set(f.employeeId, avgDailyHours > 8.5 && focus < 70);
    }

    const yearAgo = new Date(now.getTime() - 365 * 24 * 3600 * 1000);
    const active = emps.filter((e) => this.isActiveAt(e, now));

    // Group by department.
    const byDept = new Map<string, EmpRow[]>();
    for (const e of active) {
      const key = e.departmentId ? (deptName.get(e.departmentId) ?? "Unassigned") : "Unassigned";
      if (!byDept.has(key)) byDept.set(key, []);
      byDept.get(key)!.push(e);
    }

    const departments = [...byDept.entries()].map(([name, list]) => {
      const headcount = list.length;
      // exits attributed to this department in the last year (using dept of exited employees)
      const deptId = deptRows.find((d) => d.name === name)?.id ?? null;
      const exits12m = emps.filter((e) => e.exitedAt && e.exitedAt >= yearAgo && e.departmentId === deptId).length;
      const denom = headcount + exits12m;
      const attritionPct = pct(exits12m, denom);
      const tenures = list.map((e) => (e.joinDate ? (now.getTime() - e.joinDate.getTime()) / MONTH_MS : 0));
      const avgTenureMonths = tenures.length ? round1(tenures.reduce((a, t) => a + t, 0) / tenures.length) : 0;
      const burnoutCount = list.filter((e) => burnoutByEmp.get(e.id)).length;
      const burnoutPct = pct(burnoutCount, headcount);

      // Composite risk score: attrition + burnout, tempered by short tenure (flight risk).
      let riskScore = 0;
      riskScore += Math.min(attritionPct, 50) * 0.8;
      riskScore += burnoutPct * 0.6;
      if (avgTenureMonths > 0 && avgTenureMonths < 12) riskScore += 15;
      riskScore = Math.round(riskScore);
      const riskLevel = riskScore >= 45 ? "critical" : riskScore >= 25 ? "elevated" : "healthy";

      return { name, headcount, exits12m, attritionPct, avgTenureMonths, burnoutCount, burnoutPct, riskScore, riskLevel };
    }).sort((a, b) => b.riskScore - a.riskScore);

    const totalActive = active.length;
    // Scope to current employees: the analytics DB may still hold facts for people
    // who have since exited, which would otherwise push burnoutPct above 100%.
    const totalBurnout = active.filter((e) => burnoutByEmp.get(e.id)).length;
    const trackedForActivity = active.filter((e) => burnoutByEmp.has(e.id)).length;
    return {
      summary: {
        headcount: totalActive,
        atRiskDepartments: departments.filter((d) => d.riskLevel !== "healthy").length,
        burnoutEmployees: totalBurnout,
        burnoutPct: pct(totalBurnout, totalActive),
        trackedForActivity,
      },
      departments,
    };
  }
}
