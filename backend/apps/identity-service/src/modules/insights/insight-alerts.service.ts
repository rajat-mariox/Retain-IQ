import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../common/database/prisma.service.js";
import { logger } from "../../common/observability/observability.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { AnalyticsReadPrismaService } from "../../common/database/analytics-prisma.service.js";
import { ObservationService } from "../observation/observation.service.js";

/** ISO-8601 week key (e.g. 2026-W31) — stable per calendar week for dedupe. */
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

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
    private readonly observations: ObservationService,
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
      const name = `${employee.firstName} ${employee.lastName}`.trim();

      // Track it as an Observation (the manager's actionable queue), deduped per
      // calendar week so a daily sweep can't spam the same drop. Severity scales
      // with the size of the drop.
      const drop = previous - current;
      const severity = drop >= 35 ? "HIGH" : drop >= 25 ? "MEDIUM" : "LOW";
      await this.observations
        .createFromAi({
          orgId: r.orgId,
          employeeId: r.employeeId,
          type: "PRODUCTIVITY_DROP",
          severity,
          title: `Productivity drop — ${name}`,
          detail: `Productivity fell to ${current}% (was ${previous}%) week-over-week.`,
          metric: { current, previous, drop },
          dedupeKey: `prod-drop:${r.employeeId}:${isoWeek(now)}`,
        })
        .catch((err) => logger.warn({ err: String(err), employeeId: r.employeeId }, "observation create (prod-drop) failed"));

      await this.emit("productivity.drop", r.orgId, `prod-drop:${r.employeeId}:${day(now)}`, {
        employeeName: name,
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
      let obsType: "BURNOUT_RISK" | "LOW_ENGAGEMENT" | null = null;
      if (avgDailyHours > 9 && focus < 70) {
        title = "Burnout risk detected";
        body = `Sustained ${avgDailyHours.toFixed(1)}h/day with focus at ${Math.round(focus)}%. Consider rebalancing their workload.`;
        obsType = "BURNOUT_RISK";
      } else if (avgDailyHours > 0 && avgDailyHours < 3) {
        title = "Low engagement detected";
        body = `Only ${avgDailyHours.toFixed(1)}h/day of tracked activity this week. A check-in may be worthwhile.`;
        obsType = "LOW_ENGAGEMENT";
      }
      if (!title || !body || !obsType) continue;

      const employee = await this.prisma.employee.findFirst({
        where: { id: f.employeeId, orgId: f.orgId },
        select: { firstName: true, lastName: true },
      });
      if (!employee) continue;
      const name = `${employee.firstName} ${employee.lastName}`.trim();

      // Burnout is a higher-severity concern than disengagement.
      await this.observations
        .createFromAi({
          orgId: f.orgId,
          employeeId: f.employeeId,
          type: obsType,
          severity: obsType === "BURNOUT_RISK" ? "HIGH" : "MEDIUM",
          title: `${title.replace(" detected", "")} — ${name}`,
          detail: body,
          metric: { avgDailyHours: Number(avgDailyHours.toFixed(1)), focus: Math.round(focus) },
          dedupeKey: `${obsType.toLowerCase()}:${f.employeeId}:${isoWeek(now)}`,
        })
        .catch((err) => logger.warn({ err: String(err), employeeId: f.employeeId }, "observation create (recommendation) failed"));

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
