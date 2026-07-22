import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../common/database/prisma.service.js";
import { logger } from "../../common/observability/observability.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { AnalyticsReadPrismaService } from "../../common/database/analytics-prisma.service.js";

const DAY_MS = 24 * 3600 * 1000;
const RECENT_DAYS = 7;
const PRIOR_DAYS = 14;
/** Percentage points of productivity loss that counts as a real drop. */
const DROP_THRESHOLD = 15;

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Productivity alerts (§3) and AI recommendations (§6).
 *
 * Both are derived from the same activity facts the Insights dashboards use,
 * compared week-over-week. Emitted daily so managers get a nudge rather than a
 * live firehose. Every event carries a stable aggregateId (employee + week) so
 * a re-run can't double-notify.
 */
@Injectable()
export class InsightAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsReadPrismaService,
    private readonly outbox: OutboxService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sweep(): Promise<void> {
    try {
      await this.sweepProductivityDrops();
      await this.sweepRecommendations();
    } catch (error) {
      logger.warn({ err: String(error) }, "insight alert sweep failed");
    }
  }

  /** Week-over-week productivity regressions, reported to approvers. */
  private async sweepProductivityDrops(): Promise<void> {
    const now = new Date();
    const recentFrom = new Date(now.getTime() - RECENT_DAYS * DAY_MS);
    const priorFrom = new Date(now.getTime() - PRIOR_DAYS * DAY_MS);

    const [recent, prior] = await Promise.all([
      this.analytics.employeeDayFact.groupBy({
        by: ["orgId", "employeeId"],
        where: { day: { gte: recentFrom } },
        _avg: { productivityScore: true },
        _count: { _all: true },
      }),
      this.analytics.employeeDayFact.groupBy({
        by: ["orgId", "employeeId"],
        where: { day: { gte: priorFrom, lt: recentFrom } },
        _avg: { productivityScore: true },
        _count: { _all: true },
      }),
    ]);

    const priorBy = new Map(prior.map((p) => [`${p.orgId}:${p.employeeId}`, p]));
    let emitted = 0;

    for (const r of recent) {
      // Need enough signal on both sides to make a fair comparison.
      if (r._count._all < 3) continue;
      const p = priorBy.get(`${r.orgId}:${r.employeeId}`);
      if (!p || p._count._all < 3) continue;

      const current = Math.round(r._avg.productivityScore ?? 0);
      const previous = Math.round(p._avg.productivityScore ?? 0);
      if (previous - current < DROP_THRESHOLD) continue;

      const employee = await this.prisma.employee.findFirst({
        where: { id: r.employeeId, orgId: r.orgId },
        select: { firstName: true, lastName: true },
      });
      if (!employee) continue;

      await this.emit("productivity.drop", r.orgId, `prod-drop:${r.employeeId}:${day(now)}`, {
        employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
        current,
        previous,
      });
      emitted += 1;
    }
    if (emitted > 0) logger.info({ emitted }, "productivity drop alerts emitted");
  }

  /**
   * Turns the workforce heuristics into actionable recommendations: sustained
   * overwork (burnout risk) and prolonged low activity (disengagement).
   */
  private async sweepRecommendations(): Promise<void> {
    const now = new Date();
    const from = new Date(now.getTime() - RECENT_DAYS * DAY_MS);

    const facts = await this.analytics.employeeDayFact.groupBy({
      by: ["orgId", "employeeId"],
      where: { day: { gte: from } },
      _sum: { activeSeconds: true },
      _avg: { focusScore: true },
      _count: { _all: true },
    });

    let emitted = 0;
    for (const f of facts) {
      const days = f._count._all || 1;
      if (days < 4) continue; // not enough of a week to judge
      const avgDailyHours = (f._sum.activeSeconds ?? 0) / days / 3600;
      const focus = f._avg.focusScore ?? 100;

      let title: string | null = null;
      let body: string | null = null;
      if (avgDailyHours > 9 && focus < 70) {
        title = "Burnout risk detected";
        body = `Sustained ${avgDailyHours.toFixed(1)}h/day with focus at ${Math.round(focus)}%. Consider rebalancing their workload.`;
      } else if (avgDailyHours > 0 && avgDailyHours < 3) {
        title = "Low engagement detected";
        body = `Only ${avgDailyHours.toFixed(1)}h/day of tracked activity this week. A check-in may be worthwhile.`;
      }
      if (!title || !body) continue;

      const employee = await this.prisma.employee.findFirst({
        where: { id: f.employeeId, orgId: f.orgId },
        select: { firstName: true, lastName: true },
      });
      if (!employee) continue;
      const name = `${employee.firstName} ${employee.lastName}`.trim();

      await this.emit("ai.recommendation", f.orgId, `ai-rec:${f.employeeId}:${day(now)}`, {
        title: `${title}: ${name}`,
        body,
      });
      emitted += 1;
    }
    if (emitted > 0) logger.info({ emitted }, "AI recommendations emitted");
  }

  private async emit(eventType: string, orgId: string, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.outbox.enqueue(tx, { eventType, aggregateType: "insight", aggregateId, orgId, payload });
    });
  }
}
