import { Injectable } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { AnalyticsReadPrismaService } from "../../common/database/analytics-prisma.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";

const ONLINE_WINDOW_MS = 10 * 60 * 1000; // active within 10 min → online

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function resolveDay(dayStr?: string): Date {
  if (!dayStr) return startOfUtcDay();
  const d = new Date(`${dayStr}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? startOfUtcDay() : startOfUtcDay(d);
}
const hours = (sec: number) => Math.round((sec / 3600) * 10) / 10;

@Injectable()
export class MonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsReadPrismaService,
    private readonly accessScope: AccessScopeService,
  ) {}

  /** null = all employees visible (org tier); otherwise the scoped id list. */
  private async visibleEmployeeIds(): Promise<string[] | null> {
    const ctx = requireTenantContext();
    const scope = await this.accessScope.resolveScope(ctx.orgId, ctx.userId, permissions.employeeRead);
    return this.accessScope.visibleEmployeeIds(ctx.orgId, scope);
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
    return new Map(rows.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));
  }

  private employeeFilter(visible: string[] | null): { employeeId?: { in: string[] } } {
    return visible ? { employeeId: { in: visible } } : {};
  }

  /**
   * Resolves the employee filter for a query: a specific employee (drill-down,
   * enforcing the caller's scope) or all visible employees. A requested employee
   * outside the caller's scope resolves to an impossible id (no data).
   */
  private async resolveFilter(employeeId?: string): Promise<{ employeeId?: string | { in: string[] } }> {
    const visible = await this.visibleEmployeeIds();
    if (employeeId) {
      if (visible && !visible.includes(employeeId)) return { employeeId: "00000000-0000-0000-0000-000000000000" };
      return { employeeId };
    }
    return this.employeeFilter(visible);
  }

  /** Monitoring dashboard: presence + productivity + top apps/sites for a day (org-wide or one employee). */
  async summary(dayStr?: string, employeeId?: string) {
    const ctx = requireTenantContext();
    const day = resolveDay(dayStr);
    const empFilter = await this.resolveFilter(employeeId);

    const [facts, topApps, topSites, presence] = await Promise.all([
      this.analytics.employeeDayFact.findMany({ where: { orgId: ctx.orgId, day, ...empFilter }, select: { employeeId: true, activeSeconds: true, idleSeconds: true, productiveSeconds: true, productivityScore: true, focusScore: true } }),
      this.aggApps(ctx.orgId, day, empFilter, 6),
      this.aggSites(ctx.orgId, day, empFilter, 6),
      this.presence(dayStr, employeeId),
    ]);

    const n = facts.length || 1;
    const activeSeconds = facts.reduce((s, f) => s + f.activeSeconds, 0);
    const idleSeconds = facts.reduce((s, f) => s + f.idleSeconds, 0);
    const productiveSeconds = facts.reduce((s, f) => s + f.productiveSeconds, 0);
    return {
      day: day.toISOString().slice(0, 10),
      trackedEmployees: facts.length,
      online: presence.filter((p) => p.status === "online").length,
      idle: presence.filter((p) => p.status === "idle").length,
      offline: presence.filter((p) => p.status === "offline").length,
      avgProductivity: Math.round(facts.reduce((s, f) => s + f.productivityScore, 0) / n),
      avgFocus: Math.round(facts.reduce((s, f) => s + f.focusScore, 0) / n),
      activeHours: hours(activeSeconds),
      idleHours: hours(idleSeconds),
      utilization: activeSeconds > 0 ? Math.round((productiveSeconds / activeSeconds) * 100) : 0,
      topApps,
      topWebsites: topSites,
    };
  }

  /** Live-ish presence per employee from the latest activity event. */
  async presence(dayStr?: string, employeeId?: string) {
    const ctx = requireTenantContext();
    const day = resolveDay(dayStr);
    const empFilter = await this.resolveFilter(employeeId);
    const events = await this.analytics.activityEvent.findMany({
      where: { orgId: ctx.orgId, day, ...empFilter },
      orderBy: { occurredAt: "desc" },
      select: { employeeId: true, type: true, title: true, occurredAt: true },
    });
    const latest = new Map<string, { type: string; title: string | null; occurredAt: Date }>();
    for (const e of events) if (!latest.has(e.employeeId)) latest.set(e.employeeId, { type: e.type, title: e.title, occurredAt: e.occurredAt });

    const names = await this.names([...latest.keys()]);
    const now = Date.now();
    return [...latest.entries()]
      .map(([employeeId, e]) => {
        const recent = now - e.occurredAt.getTime() < ONLINE_WINDOW_MS;
        const status = e.type === "idle" ? "idle" : e.type === "break" ? "break" : recent ? "online" : "offline";
        return { employeeId, name: names.get(employeeId) ?? "Unknown", status, lastActivity: e.type, lastTitle: e.title, lastSeen: e.occurredAt.toISOString() };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async aggApps(orgId: string, day: Date, empFilter: { employeeId?: string | { in: string[] } }, take: number) {
    const groups = await this.analytics.appUsageDaily.groupBy({ by: ["appName", "category"], where: { orgId, day, ...empFilter }, _sum: { seconds: true } });
    const merged = new Map<string, { appName: string; category: string; seconds: number }>();
    for (const g of groups) {
      const cur = merged.get(g.appName);
      const secs = g._sum.seconds ?? 0;
      if (!cur) merged.set(g.appName, { appName: g.appName, category: g.category, seconds: secs });
      else {
        cur.seconds += secs;
        if (secs > 0 && g.category !== "NEUTRAL") cur.category = g.category;
      }
    }
    return [...merged.values()].sort((a, b) => b.seconds - a.seconds).slice(0, take).map((a) => ({ ...a, hours: hours(a.seconds) }));
  }

  private async aggSites(orgId: string, day: Date, empFilter: { employeeId?: string | { in: string[] } }, take: number) {
    const groups = await this.analytics.websiteUsageDaily.groupBy({ by: ["domain", "category"], where: { orgId, day, ...empFilter }, _sum: { seconds: true, visits: true } });
    const merged = new Map<string, { domain: string; category: string; seconds: number; visits: number }>();
    for (const g of groups) {
      const cur = merged.get(g.domain);
      const secs = g._sum.seconds ?? 0;
      const visits = g._sum.visits ?? 0;
      if (!cur) merged.set(g.domain, { domain: g.domain, category: g.category, seconds: secs, visits });
      else {
        cur.seconds += secs;
        cur.visits += visits;
        if (secs > 0 && g.category !== "NEUTRAL") cur.category = g.category;
      }
    }
    return [...merged.values()].sort((a, b) => b.seconds - a.seconds).slice(0, take).map((s) => ({ ...s, hours: hours(s.seconds) }));
  }

  async apps(dayStr?: string, employeeId?: string) {
    const ctx = requireTenantContext();
    const day = resolveDay(dayStr);
    return { day: day.toISOString().slice(0, 10), apps: await this.aggApps(ctx.orgId, day, await this.resolveFilter(employeeId), 100) };
  }

  async websites(dayStr?: string, employeeId?: string) {
    const ctx = requireTenantContext();
    const day = resolveDay(dayStr);
    return { day: day.toISOString().slice(0, 10), websites: await this.aggSites(ctx.orgId, day, await this.resolveFilter(employeeId), 100) };
  }

  async sessions(dayStr?: string, employeeId?: string) {
    const ctx = requireTenantContext();
    const day = resolveDay(dayStr);
    const where = { orgId: ctx.orgId, day, ...(await this.resolveFilter(employeeId)) };
    const rows = await this.analytics.workSession.findMany({ where, orderBy: { startedAt: "desc" }, take: 200 });
    const names = await this.names([...new Set(rows.map((r) => r.employeeId))]);
    return {
      day: day.toISOString().slice(0, 10),
      sessions: rows.map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        name: names.get(r.employeeId) ?? "Unknown",
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt ? r.endedAt.toISOString() : null,
        activeHours: hours(r.activeSeconds),
        idleHours: hours(r.idleSeconds),
        breakHours: hours(r.breakSeconds),
        durationHours: hours(((r.endedAt ?? new Date()).getTime() - r.startedAt.getTime()) / 1000),
        open: r.endedAt === null,
      })),
    };
  }

  /**
   * Consolidated activity timeline: consecutive same-app/site samples are merged
   * into a single block with a start→end range. Switching away, an idle/break, or
   * a >5-min gap ends the block — so returning to the same app is a NEW block.
   */
  async timeline(employeeId: string, dayStr?: string) {
    const ctx = requireTenantContext();
    const day = resolveDay(dayStr);
    const rows = await this.analytics.activityEvent.findMany({
      where: { orgId: ctx.orgId, employeeId, day },
      orderBy: { occurredAt: "asc" },
      take: 5000,
      select: { occurredAt: true, type: true, title: true, detail: true, category: true, seconds: true },
    });
    const name = (await this.names([employeeId])).get(employeeId) ?? "Unknown";

    const GAP_MS = 5 * 60 * 1000; // a gap longer than this ends the current block
    interface Seg { type: string; title: string | null; detail: string | null; category: string | null; startMs: number; endMs: number; seconds: number; key: string }
    const segments: Seg[] = [];
    let current: Seg | null = null;
    const flush = () => {
      if (current) segments.push(current);
      current = null;
    };

    for (const e of rows) {
      const t = e.occurredAt.getTime();
      const secs = e.seconds ?? 0;
      if (e.type === "app" || e.type === "website") {
        const key = `${e.type}:${e.title ?? ""}`;
        if (current && current.key === key && t - current.endMs <= GAP_MS) {
          current.endMs = Math.max(current.endMs, t + secs * 1000);
          current.seconds += secs;
        } else {
          flush();
          current = { type: e.type, title: e.title, detail: e.detail, category: e.category, startMs: t, endMs: t + secs * 1000, seconds: secs, key };
        }
      } else {
        // idle / break / session / screenshot / focus — a distinct point/marker.
        flush();
        segments.push({ type: e.type, title: e.title, detail: e.detail, category: e.category, startMs: t, endMs: t + secs * 1000, seconds: secs, key: e.type });
      }
    }
    flush();

    // De-flicker: absorb sub-30s app/website blocks into the previous activity
    // block, then re-merge same-app neighbours that become adjacent. Purely a
    // timeline-readability pass — per-app/site totals (Apps/Websites) are unaffected.
    const MIN_BLOCK_SECONDS = 30;
    const smoothed: Seg[] = [];
    for (const seg of segments) {
      const last = smoothed[smoothed.length - 1];
      const isActivity = seg.type === "app" || seg.type === "website";
      const lastIsActivity = last && (last.type === "app" || last.type === "website");
      if (last && lastIsActivity && isActivity && seg.seconds < MIN_BLOCK_SECONDS) {
        last.endMs = Math.max(last.endMs, seg.endMs);
        last.seconds += seg.seconds;
        continue;
      }
      if (last && last.key === seg.key && seg.startMs - last.endMs <= GAP_MS) {
        last.endMs = Math.max(last.endMs, seg.endMs);
        last.seconds += seg.seconds;
        continue;
      }
      smoothed.push({ ...seg });
    }

    return {
      day: day.toISOString().slice(0, 10),
      employeeId,
      name,
      segments: smoothed.map((s, i) => ({
        id: `${s.startMs}-${i}`,
        type: s.type,
        title: s.title,
        detail: s.detail,
        category: s.category,
        startAt: new Date(s.startMs).toISOString(),
        endAt: new Date(s.endMs).toISOString(),
        seconds: s.seconds,
      })),
    };
  }
}
