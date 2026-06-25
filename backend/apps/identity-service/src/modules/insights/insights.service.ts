import { BadRequestException, Injectable } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { AnalyticsReadPrismaService } from "../../common/database/analytics-prisma.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
const hours = (sec: number | null | undefined) => Math.round((sec ?? 0) / 3600);
const score = (v: number | null | undefined) => Math.round(v ?? 0);

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsReadPrismaService,
  ) {}

  private windowStart(): Date {
    return new Date(Date.now() - WINDOW_DAYS * DAY_MS);
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

    const facts = await this.analytics.employeeDayFact.findMany({
      where: { orgId: ctx.orgId, employeeId: membership.employeeId, day: { gte: this.windowStart() } },
      orderBy: { day: "asc" },
    });

    const series = facts.map((f) => ({
      date: f.day.toISOString().slice(0, 10),
      activeHours: hours(f.activeSeconds),
      productiveHours: hours(f.productiveSeconds),
      idleHours: hours(f.idleSeconds),
      productivity: score(f.productivityScore),
      focus: score(f.focusScore),
    }));

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
    const [byEmployee, employees] = await Promise.all([
      this.analytics.employeeDayFact.groupBy({
        by: ["employeeId"],
        where: { orgId: ctx.orgId, day: { gte: since } },
        _avg: { productivityScore: true, focusScore: true },
        _sum: { activeSeconds: true, productiveSeconds: true },
        _count: { _all: true },
      }),
      this.prisma.employee.findMany({ where: { orgId: ctx.orgId }, select: { id: true, firstName: true, lastName: true } }),
    ]);

    const names = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));

    const people = byEmployee.map((f) => {
      const days = f._count._all || 1;
      const activeHours = hours(f._sum.activeSeconds);
      const productivity = score(f._avg.productivityScore);
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
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}
