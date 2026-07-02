import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { OffsetPage } from "@retainiq/contracts";
import { AnalyticsReadPrismaService } from "../../common/database/analytics-prisma.service.js";
import { BillingReadPrismaService } from "../../common/database/billing-prisma.service.js";
import { NotificationsReadPrismaService } from "../../common/database/notifications-prisma.service.js";
import { BrokerService } from "../../common/messaging/broker.service.js";
import { hashPassword } from "../../common/crypto/password.util.js";
import { generateTempPassword } from "../../common/crypto/temp-password.util.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { ensureSystemRoles } from "../../common/security/roles.util.js";
import type {
  AdminActivityFeed,
  AdminActivityItem,
  AdminAttendanceToday,
  AdminAuditEntry,
  AdminAuditPage,
  AdminBilling,
  AuditCategory,
  AdminCustomerSuccess,
  AdminDbHealth,
  AdminEmployee,
  AdminFeatureUsage,
  AdminLoginPoint,
  AdminMrrPoint,
  AdminOrg,
  AdminOrgDetail,
  AdminOrgHealth,
  AdminOverview,
  AdminFailedPaymentRow,
  AdminPlanDist,
  AdminQueueHealth,
  AdminRevenue,
  AdminServiceHealth,
  AdminStorage,
  AdminStorageTotals,
  AdminSubLifecycleRow,
  AdminSubscription,
  AdminSubscriptionsView,
  AdminSystemHealth,
  AdminTopCustomer,
  AdminUsage,
  AdminUsageAnalytics,
  AdminUsagePoint,
  ChurnReason,
  HealthBand,
  HealthStatus,
} from "./admin.dto.js";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
// Platform-wide rollups change slowly; a short cache spares a full recompute on
// every dashboard load. Mutations (create-org) clear it.
const CACHE_TTL_MS = 30_000;

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const hours = (seconds: number | null | undefined) => Math.round((seconds ?? 0) / 3600);
const score = (value: number | null | undefined) => Math.round(value ?? 0);

/**
 * Platform-admin reporting reads. Joins identity-db (orgs/users/employees) with
 * the analytics-db read model (EmployeeDayFact) to produce cross-org rollups.
 * Read-only; aggregation happens in-process across two connections.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsReadPrismaService,
    private readonly billing: BillingReadPrismaService,
    private readonly notifications: NotificationsReadPrismaService,
    private readonly broker: BrokerService,
    private readonly outbox: OutboxService,
  ) {}

  private readonly cache = new Map<string, { at: number; value: unknown }>();

  private async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return hit.value as T;
    }
    const value = await fn();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private windowStart(): Date {
    return new Date(Date.now() - WINDOW_DAYS * DAY_MS);
  }

  overview(): Promise<AdminOverview> {
    return this.cached("overview", () => this.computeOverview());
  }

  private async computeOverview(): Promise<AdminOverview> {
    const since = this.windowStart();
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [totalOrgs, statusGroups, totalUsers, totalEmployees, newOrgsThisMonth, prodAgg, trackedOrgRows] =
      await Promise.all([
        this.prisma.organization.count({ where: { status: { not: "DELETED" } } }),
        this.prisma.organization.groupBy({ by: ["status"], _count: { _all: true } }),
        this.prisma.user.count(),
        this.prisma.employee.count(),
        this.prisma.organization.count({ where: { createdAt: { gte: monthStart } } }),
        this.analytics.employeeDayFact.aggregate({ _avg: { productivityScore: true }, where: { day: { gte: since } } }),
        this.analytics.employeeDayFact.findMany({
          where: { day: { gte: since } },
          distinct: ["orgId"],
          select: { orgId: true },
        }),
      ]);

    const statusCount = (status: string) =>
      statusGroups.find((g) => g.status === status)?._count._all ?? 0;

    return {
      totalOrgs,
      activeOrgs: statusCount("ACTIVE"),
      suspendedOrgs: statusCount("SUSPENDED"),
      newOrgsThisMonth,
      totalUsers,
      totalEmployees,
      avgProductivity: score(prodAgg._avg.productivityScore),
      trackedOrgs: trackedOrgRows.length,
    };
  }

  organizations(query: { page: number; pageSize: number }): Promise<OffsetPage<AdminOrg>> {
    return this.cached(`organizations:${query.page}:${query.pageSize}`, () => this.computeOrganizations(query));
  }

  private async computeOrganizations(query: { page: number; pageSize: number }): Promise<OffsetPage<AdminOrg>> {
    const since = this.windowStart();
    const where = { status: { not: "DELETED" as const } };

    // Paginate the orgs at the DB, then enrich only this page's orgIds.
    const [orgs, total] = await this.prisma.$transaction([
      this.prisma.organization.findMany({
        where,
        select: { id: true, name: true, slug: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.organization.count({ where }),
    ]);
    const ids = orgs.map((o) => o.id);

    const [memberCounts, employeeCounts, lastSessions, factAgg, subs] = await Promise.all([
      this.prisma.organizationMembership.groupBy({ by: ["orgId"], where: { orgId: { in: ids } }, _count: { _all: true } }),
      this.prisma.employee.groupBy({ by: ["orgId"], where: { orgId: { in: ids } }, _count: { _all: true } }),
      this.prisma.session.groupBy({ by: ["orgId"], where: { orgId: { in: ids } }, _max: { lastUsedAt: true } }),
      this.analytics.employeeDayFact.groupBy({
        by: ["orgId"],
        where: { orgId: { in: ids }, day: { gte: since } },
        _sum: { activeSeconds: true },
        _avg: { productivityScore: true },
      }),
      this.billing.subscription.findMany({ where: { orgId: { in: ids } }, select: { orgId: true, planId: true, status: true } }),
    ]);

    const members = new Map(memberCounts.map((m) => [m.orgId, m._count._all]));
    const employees = new Map(employeeCounts.map((e) => [e.orgId, e._count._all]));
    const lastActive = new Map(lastSessions.filter((s) => s.orgId).map((s) => [s.orgId!, s._max.lastUsedAt]));
    const facts = new Map(factAgg.map((f) => [f.orgId, f]));
    const subByOrg = new Map(subs.map((s) => [s.orgId, s]));

    const items = orgs.map((o): AdminOrg => {
      const fact = facts.get(o.id);
      const last = lastActive.get(o.id) ?? null;
      const sub = subByOrg.get(o.id);
      return {
        id: o.id,
        name: o.name,
        slug: o.slug,
        status: o.status,
        users: members.get(o.id) ?? 0,
        employees: employees.get(o.id) ?? 0,
        avgProductivity: score(fact?._avg.productivityScore),
        activeHours: hours(fact?._sum.activeSeconds),
        createdAt: o.createdAt.toISOString(),
        lastActiveAt: last ? last.toISOString() : null,
        plan: sub?.planId ?? null,
        subscriptionStatus: sub?.status ?? null,
      };
    });

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async organizationDetail(id: string): Promise<AdminOrgDetail> {
    const since = this.windowStart();
    const org = await this.prisma.organization.findUnique({
      select: { id: true, name: true, slug: true, status: true, region: true, timezone: true, createdAt: true },
      where: { id },
    });
    if (!org || org.status === "DELETED") {
      throw new NotFoundException("Organization not found.");
    }

    const today = startOfUtcDay();
    const [employees, memberCount, lastSession, factByEmployee, attendance, subscription, storageAgg] = await Promise.all([
      this.prisma.employee.findMany({
        where: { orgId: id },
        select: { id: true, firstName: true, lastName: true, email: true, status: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.organizationMembership.count({ where: { orgId: id } }),
      this.prisma.session.aggregate({ where: { orgId: id }, _max: { lastUsedAt: true } }),
      this.analytics.employeeDayFact.groupBy({
        by: ["employeeId"],
        where: { orgId: id, day: { gte: since } },
        _avg: { productivityScore: true },
        _sum: { activeSeconds: true, productiveSeconds: true },
        _max: { day: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { orgId: id, day: { gte: since } },
        select: { employeeId: true, status: true, day: true },
      }),
      this.billing.subscription.findUnique({ where: { orgId: id }, include: { plan: true } }),
      this.prisma.screenshotObject.aggregate({ where: { orgId: id }, _sum: { sizeBytes: true } }),
    ]);

    // Per-employee attendance over the window: present+late days / tracked days.
    const todayKey = today.toISOString().slice(0, 10);
    const attByEmployee = new Map<string, { present: number; tracked: number; today: string | null }>();
    for (const a of attendance) {
      const agg = attByEmployee.get(a.employeeId) ?? { present: 0, tracked: 0, today: null };
      agg.tracked += 1;
      if (a.status === "PRESENT" || a.status === "LATE") agg.present += 1;
      if (a.day.toISOString().slice(0, 10) === todayKey) agg.today = a.status;
      attByEmployee.set(a.employeeId, agg);
    }

    const factMap = new Map(factByEmployee.map((f) => [f.employeeId, f]));
    const employeeRows: AdminEmployee[] = employees.map((e) => {
      const f = factMap.get(e.id);
      const att = attByEmployee.get(e.id);
      return {
        id: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        email: e.email,
        status: e.status,
        avgProductivity: score(f?._avg.productivityScore),
        activeHours: hours(f?._sum.activeSeconds),
        productiveHours: hours(f?._sum.productiveSeconds),
        lastActiveDay: f?._max.day ? f._max.day.toISOString().slice(0, 10) : null,
        attendanceRate: att && att.tracked > 0 ? Math.round((att.present / att.tracked) * 100) : 0,
        daysPresent: att?.present ?? 0,
        todayStatus: att?.today ?? null,
      };
    });

    const todayRecords = attendance.filter((a) => a.day.toISOString().slice(0, 10) === todayKey);
    const presentToday = todayRecords.filter((a) => a.status === "PRESENT").length;
    const lateToday = todayRecords.filter((a) => a.status === "LATE").length;
    const onLeaveToday = todayRecords.filter((a) => a.status === "ON_LEAVE").length;
    const checkedIn = presentToday + lateToday;
    const attendanceToday: AdminAttendanceToday = {
      totalEmployees: employees.length,
      present: presentToday,
      late: lateToday,
      onLeave: onLeaveToday,
      absent: Math.max(0, employees.length - checkedIn - onLeaveToday),
      attendanceRate: employees.length > 0 ? Math.round((checkedIn / employees.length) * 100) : 0,
    };

    const tracked = employeeRows.filter((e) => e.avgProductivity > 0);
    const avgProductivity =
      tracked.length > 0 ? Math.round(tracked.reduce((s, e) => s + e.avgProductivity, 0) / tracked.length) : 0;

    const orgRow: AdminOrg = {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      users: memberCount,
      employees: employees.length,
      avgProductivity,
      activeHours: employeeRows.reduce((s, e) => s + e.activeHours, 0),
      createdAt: org.createdAt.toISOString(),
      lastActiveAt: lastSession._max.lastUsedAt ? lastSession._max.lastUsedAt.toISOString() : null,
      plan: subscription?.planId ?? null,
      subscriptionStatus: subscription?.status ?? null,
      region: org.region,
      timezone: org.timezone,
    };

    const subscriptionDto: AdminSubscription = subscription
      ? {
          planId: subscription.planId,
          planName: subscription.plan.name,
          status: subscription.status,
          seats: subscription.seats,
          activeSeats: subscription.activeSeats,
          pricePerSeat: subscription.plan.pricePerSeat,
          mrr: subscription.activeSeats * subscription.plan.pricePerSeat,
          autoRenew: subscription.autoRenew,
          currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
          trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
        }
      : { planId: null, planName: null, status: null, seats: 0, activeSeats: 0, pricePerSeat: 0, mrr: 0, autoRenew: false, currentPeriodEnd: null, trialEndsAt: null };

    const storage: AdminStorage = {
      usedBytes: storageAgg._sum.sizeBytes ? Number(storageAgg._sum.sizeBytes) : 0,
      limitBytes: subscription?.plan?.storageLimitMb != null ? subscription.plan.storageLimitMb * 1024 * 1024 : null,
    };

    return { org: orgRow, subscription: subscriptionDto, storage, employees: employeeRows, attendanceToday };
  }

  /** Super-admin provisions a new org + its owner account (temp password) + subscription. */
  async createOrganization(input: {
    orgName: string;
    ownerEmail: string;
    ownerFirstName: string;
    ownerLastName: string;
    planId: string;
    seats?: number;
  }) {
    const email = input.ownerEmail.toLowerCase();
    const [existing, plan] = await Promise.all([
      this.prisma.user.findUnique({ where: { email } }),
      this.billing.plan.findUnique({ where: { id: input.planId } }),
    ]);
    if (existing) {
      throw new ConflictException("A user with this email already exists.");
    }
    if (!plan) {
      throw new BadRequestException("Unknown plan.");
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    const slug = await this.uniqueSlug(input.orgName);

    const seats = input.seats ?? 10;

    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({ data: { name: input.orgName, slug } });
      const roles = await ensureSystemRoles(tx, created.id);
      const user = await tx.user.create({ data: { email, passwordHash, mustChangePassword: true } });
      const employee = await tx.employee.create({
        data: { orgId: created.id, email, firstName: input.ownerFirstName, lastName: input.ownerLastName, title: "Owner", createdBy: user.id },
      });
      await tx.organizationMembership.create({
        data: { orgId: created.id, userId: user.id, employeeId: employee.id, roleId: roles.get("Owner")!, status: "ACTIVE" },
      });
      // Base-role grant (multi-grant RBAC): owner gets an ORG-scoped Owner grant.
      await tx.roleAssignment.create({
        data: { orgId: created.id, userId: user.id, employeeId: employee.id, roleId: roles.get("Owner")!, scopeType: "ORG", status: "ACTIVE", createdBy: user.id },
      });
      // Provision the subscription via choreography: billing-service consumes
      // this and creates the Subscription in billing-db (transactional outbox).
      await this.outbox.enqueue(tx, {
        eventType: "organization.created",
        aggregateType: "organization",
        aggregateId: created.id,
        orgId: created.id,
        actorUserId: user.id,
        payload: { planId: plan.id, seats, billingEmail: email },
      });
      return created;
    });

    this.cache.clear(); // new org should appear in the dashboards immediately
    this.recordEvent("org.created", org.id, `Organization "${org.name}" created on the ${plan.name} plan`);

    return {
      org: { id: org.id, name: org.name, slug: org.slug },
      owner: { email, tempPassword },
      plan: { id: plan.id, name: plan.name },
    };
  }

  /** Edit an org's profile (name/region/timezone). Slug is immutable. */
  async updateOrganization(
    id: string,
    input: { name?: string; region?: string; timezone?: string },
  ): Promise<{ id: string; name: string; slug: string; status: string }> {
    await this.ensureLiveOrg(id);
    const org = await this.prisma.organization.update({
      where: { id },
      data: { name: input.name, region: input.region, timezone: input.timezone },
      select: { id: true, name: true, slug: true, status: true },
    });
    this.cache.clear();
    this.recordEvent("org.updated", id, `Organization "${org.name}" profile updated`);
    return org;
  }

  /**
   * Change an org's lifecycle status: suspend (block access), activate (restore),
   * or delete (soft — sets DELETED so it drops out of the dashboards). We never
   * hard-delete: it would cascade across employees/sessions/projects and orphan
   * the org's subscription in billing-db.
   */
  async setOrganizationStatus(id: string, status: "ACTIVE" | "SUSPENDED" | "DELETED"): Promise<{ id: string; status: string }> {
    await this.ensureLiveOrg(id);
    const org = await this.prisma.organization.update({
      where: { id },
      data: { status },
      select: { id: true, status: true, name: true },
    });
    this.cache.clear();
    const verb = status === "SUSPENDED" ? "suspended" : status === "DELETED" ? "deleted" : "activated";
    this.recordEvent(`org.${verb}`, id, `Organization "${org.name}" ${verb}`);
    return { id: org.id, status: org.status };
  }

  /** Throws NotFound for a missing or already-deleted org. */
  private async ensureLiveOrg(id: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({ where: { id }, select: { status: true } });
    if (!org || org.status === "DELETED") {
      throw new NotFoundException("Organization not found.");
    }
  }

  /** Append a row to the platform activity feed. Best-effort (never blocks the action). */
  private recordEvent(type: string, orgId: string | null, summary: string): void {
    void this.prisma.platformEvent.create({ data: { type, orgId, summary } }).catch(() => undefined);
  }

  private async uniqueSlug(orgName: string): Promise<string> {
    const base =
      orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "org";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${randomBytes(3).toString("hex")}`;
      const taken = await this.prisma.organization.findUnique({ where: { slug: candidate } });
      if (!taken) return candidate;
    }
    return `${base}-${randomBytes(6).toString("hex")}`;
  }

  getBilling(): Promise<AdminBilling> {
    return this.cached("billing", () => this.computeBilling());
  }

  private async computeBilling(): Promise<AdminBilling> {
    // Aggregate in the DB: one groupBy over subscriptions (one row per org) +
    // one SUM-by-month over invoices — never load every invoice/sub into Node.
    const [plans, subAgg] = await Promise.all([
      this.billing.plan.findMany({ orderBy: { sortOrder: "asc" } }),
      this.billing.subscription.groupBy({
        by: ["planId", "status"],
        _sum: { activeSeats: true },
        _count: { _all: true },
      }),
    ]);
    const priceByPlan = new Map(plans.map((p) => [p.id, p.pricePerSeat]));
    const paying = (s: string) => s === "ACTIVE" || s === "PAST_DUE";

    // Plan distribution (orgs/seats/MRR per plan, MRR in whole dollars).
    const planDist: AdminPlanDist[] = plans.map((p) => {
      const rows = subAgg.filter((r) => r.planId === p.id);
      const orgs = rows.reduce((sum, r) => sum + r._count._all, 0);
      const seats = rows.reduce((sum, r) => sum + (r._sum.activeSeats ?? 0), 0);
      const payingSeats = rows.filter((r) => paying(r.status)).reduce((sum, r) => sum + (r._sum.activeSeats ?? 0), 0);
      return { plan: p.id, name: p.name, orgs, seats, mrr: Math.round((payingSeats * p.pricePerSeat) / 100), color: p.color };
    });

    const payingRows = subAgg.filter((r) => paying(r.status));
    const mrr = Math.round(payingRows.reduce((sum, r) => sum + (r._sum.activeSeats ?? 0) * (priceByPlan.get(r.planId) ?? 0), 0) / 100);
    const payingOrgs = payingRows.reduce((sum, r) => sum + r._count._all, 0);
    const totalSeats = payingRows.reduce((sum, r) => sum + (r._sum.activeSeats ?? 0), 0);
    const totalOrgs = subAgg.reduce((sum, r) => sum + r._count._all, 0);

    // 12-month trend: SUM PAID invoices by month in SQL, not in Node.
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - 11);
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
    const trendRows = await this.billing.$queryRaw<{ m: Date; total: bigint }[]>`
      SELECT date_trunc('month', "periodStart") AS m, SUM("totalAmount")::bigint AS total
      FROM "Invoice" WHERE status = 'PAID' AND "periodStart" >= ${since}
      GROUP BY 1`;
    const byMonth = new Map<string, number>();
    for (const r of trendRows) {
      byMonth.set(r.m.toISOString().slice(0, 7), Number(r.total));
    }
    const trend: AdminMrrPoint[] = [];
    for (let m = 11; m >= 0; m -= 1) {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() - m);
      const monthMrr = Math.round((byMonth.get(d.toISOString().slice(0, 7)) ?? 0) / 100);
      const prevMrr = trend.at(-1)?.mrr ?? 0;
      const delta = monthMrr - prevMrr;
      trend.push({
        month: d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
        mrr: monthMrr,
        newMrr: trend.length === 0 ? monthMrr : Math.max(0, delta),
        churnedMrr: trend.length === 0 ? 0 : Math.max(0, -delta),
      });
    }

    const last = trend.at(-1);
    const prev = trend.at(-2);
    const growthRatePct = prev && prev.mrr > 0 ? (((last?.mrr ?? 0) - prev.mrr) / prev.mrr) * 100 : 0;
    const churnRatePct = prev && prev.mrr > 0 ? ((last?.churnedMrr ?? 0) / prev.mrr) * 100 : 0;
    const round1 = (n: number) => Math.round(n * 10) / 10;

    const revenue: AdminRevenue = {
      mrr,
      arr: mrr * 12,
      arpa: payingOrgs > 0 ? Math.round(mrr / payingOrgs) : 0,
      churnRatePct: round1(churnRatePct),
      growthRatePct: round1(growthRatePct),
      netRevenueRetentionPct: round1(100 + growthRatePct - churnRatePct),
      payingOrgs,
      totalOrgs,
      totalSeats,
    };

    // Top paying customers — per-org MRR (paying subs), ranked. Org count is
    // small, so loading the paying subs + joining names is cheap.
    const planNameById = new Map(plans.map((p) => [p.id, p.name]));
    const paidSubs = await this.billing.subscription.findMany({
      where: { status: { in: ["ACTIVE", "PAST_DUE"] } },
      select: { orgId: true, planId: true, activeSeats: true },
    });
    const ranked = paidSubs
      .map((s) => ({
        orgId: s.orgId,
        plan: planNameById.get(s.planId) ?? s.planId,
        seats: s.activeSeats,
        mrr: Math.round((s.activeSeats * (priceByPlan.get(s.planId) ?? 0)) / 100),
      }))
      .sort((a, b) => b.mrr - a.mrr)
      .slice(0, 10);
    const custOrgs = await this.prisma.organization.findMany({ where: { id: { in: ranked.map((r) => r.orgId) } }, select: { id: true, name: true } });
    const custName = new Map(custOrgs.map((o) => [o.id, o.name]));
    const topCustomers: AdminTopCustomer[] = ranked.map((r) => ({ orgId: r.orgId, orgName: custName.get(r.orgId) ?? "Unknown", plan: r.plan, seats: r.seats, mrr: r.mrr }));

    return { plans: planDist, revenue, trend, topCustomers };
  }

  usage(): Promise<AdminUsage> {
    return this.cached("usage", () => this.computeUsage());
  }

  subscriptions(): Promise<AdminSubscriptionsView> {
    return this.cached("subscriptions", () => this.computeSubscriptions());
  }

  /** Platform activity feed: org actions (identity-db) merged with billing events (billing-db). */
  async activity(query: { page: number; pageSize: number }): Promise<AdminActivityFeed> {
    const take = query.page * query.pageSize; // enough from each source to cover the page after merge
    const [orgEvents, billingEvents, orgTotal, billingTotal] = await Promise.all([
      this.prisma.platformEvent.findMany({ orderBy: { createdAt: "desc" }, take, select: { id: true, type: true, summary: true, orgId: true, createdAt: true } }),
      this.billing.billingEvent.findMany({ orderBy: { createdAt: "desc" }, take, select: { id: true, type: true, summary: true, orgId: true, createdAt: true } }),
      this.prisma.platformEvent.count(),
      this.billing.billingEvent.count(),
    ]);

    const orgIds = [...new Set([...orgEvents.map((e) => e.orgId), ...billingEvents.map((e) => e.orgId)].filter((x): x is string => Boolean(x)))];
    const orgs = await this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
    const nameById = new Map(orgs.map((o) => [o.id, o.name]));

    const merged: AdminActivityItem[] = [
      ...orgEvents.map((e) => ({ id: e.id, source: "org" as const, type: e.type, summary: e.summary, orgId: e.orgId, orgName: e.orgId ? (nameById.get(e.orgId) ?? null) : null, createdAt: e.createdAt.toISOString() })),
      ...billingEvents.map((e) => ({ id: e.id, source: "billing" as const, type: e.type, summary: e.summary, orgId: e.orgId, orgName: nameById.get(e.orgId) ?? null, createdAt: e.createdAt.toISOString() })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const start = (query.page - 1) * query.pageSize;
    return { items: merged.slice(start, start + query.pageSize), total: orgTotal + billingTotal, page: query.page, pageSize: query.pageSize };
  }

  /**
   * Audit & compliance log. Merges login logs (tenant + super-admin sessions),
   * organization activities (PlatformEvent), and subscription/plan changes
   * (BillingEvent) into one filterable, paginated stream with actor + IP.
   */
  async auditLogs(query: { category: AuditCategory | "all"; page: number; pageSize: number }): Promise<AdminAuditPage> {
    const { category, page, pageSize } = query;
    const take = page * pageSize; // enough from each source to cover the page after merge
    const want = (c: AuditCategory) => category === "all" || category === c;

    const [sessions, adminSessions, orgEvents, billingEvents, sCount, aCount, oCount, bSubCount, bPlanCount] = await Promise.all([
      want("login")
        ? this.prisma.session.findMany({ orderBy: { createdAt: "desc" }, take, select: { id: true, createdAt: true, orgId: true, ipAddress: true, user: { select: { email: true } } } })
        : Promise.resolve([]),
      want("login")
        ? this.prisma.platformAdminSession.findMany({ orderBy: { createdAt: "desc" }, take, select: { id: true, createdAt: true, ipAddress: true, admin: { select: { email: true } } } })
        : Promise.resolve([]),
      want("organization")
        ? this.prisma.platformEvent.findMany({ orderBy: { createdAt: "desc" }, take, select: { id: true, type: true, summary: true, orgId: true, actorUserId: true, createdAt: true } })
        : Promise.resolve([]),
      want("subscription") || want("plan")
        ? this.billing.billingEvent.findMany({ orderBy: { createdAt: "desc" }, take, select: { id: true, type: true, summary: true, orgId: true, createdAt: true } })
        : Promise.resolve([]),
      want("login") ? this.prisma.session.count() : Promise.resolve(0),
      want("login") ? this.prisma.platformAdminSession.count() : Promise.resolve(0),
      want("organization") ? this.prisma.platformEvent.count() : Promise.resolve(0),
      want("subscription") ? this.billing.billingEvent.count({ where: { type: { not: "subscription.plan_changed" } } }) : Promise.resolve(0),
      want("plan") ? this.billing.billingEvent.count({ where: { type: "subscription.plan_changed" } }) : Promise.resolve(0),
    ]);

    // Resolve actor emails (org events) + org names.
    const actorIds = [...new Set(orgEvents.map((e) => e.actorUserId).filter((x): x is string => Boolean(x)))];
    const orgIds = [...new Set([...sessions, ...orgEvents, ...billingEvents].map((e) => e.orgId).filter((x): x is string => Boolean(x)))];
    const [actors, orgs] = await Promise.all([
      actorIds.length ? this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } }) : Promise.resolve([]),
      orgIds.length ? this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const actorEmail = new Map(actors.map((a) => [a.id, a.email]));
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));

    const entries: AdminAuditEntry[] = [];
    for (const s of sessions) {
      entries.push({ id: `s_${s.id}`, category: "login", type: "auth.login", summary: `${s.user.email} signed in`, actor: s.user.email, orgId: s.orgId, orgName: s.orgId ? (orgName.get(s.orgId) ?? null) : null, ip: s.ipAddress, createdAt: s.createdAt.toISOString() });
    }
    for (const a of adminSessions) {
      entries.push({ id: `a_${a.id}`, category: "login", type: "auth.platform_login", summary: `${a.admin.email} (super-admin) signed in`, actor: a.admin.email, orgId: null, orgName: null, ip: a.ipAddress, createdAt: a.createdAt.toISOString() });
    }
    for (const e of orgEvents) {
      entries.push({ id: `o_${e.id}`, category: "organization", type: e.type, summary: e.summary, actor: e.actorUserId ? (actorEmail.get(e.actorUserId) ?? null) : null, orgId: e.orgId, orgName: e.orgId ? (orgName.get(e.orgId) ?? null) : null, ip: null, createdAt: e.createdAt.toISOString() });
    }
    for (const e of billingEvents) {
      const cat: AuditCategory = e.type === "subscription.plan_changed" ? "plan" : "subscription";
      if (!want(cat)) continue; // billing fetched for either; keep only the wanted slice
      entries.push({ id: `b_${e.id}`, category: cat, type: e.type, summary: e.summary, actor: null, orgId: e.orgId, orgName: orgName.get(e.orgId) ?? null, ip: null, createdAt: e.createdAt.toISOString() });
    }

    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = (page - 1) * pageSize;
    return { items: entries.slice(start, start + pageSize), total: sCount + aCount + oCount + bSubCount + bPlanCount, page, pageSize };
  }

  // ---- Platform health ----

  /** Peer services to probe. Overridable via PLATFORM_HEALTH_TARGETS (JSON). */
  private static readonly HEALTH_TARGETS: { name: string; url: string }[] = (() => {
    const raw = process.env.PLATFORM_HEALTH_TARGETS;
    if (raw) {
      try {
        return JSON.parse(raw) as { name: string; url: string }[];
      } catch {
        /* fall through to defaults */
      }
    }
    return [
      { name: "billing-service", url: "http://billing-service:3006/health/ready" },
      { name: "analytics-service", url: "http://analytics-service:3004/health/ready" },
      { name: "notifications-service", url: "http://notifications-service:3005/health/ready" },
      { name: "event-processor", url: "http://event-processor:3003/health/ready" },
      // activity-ingestion is a Nest app with the /v1 global prefix (not the raw ops-server).
      { name: "activity-ingestion", url: "http://activity-ingestion:3002/v1/health/ready" },
    ];
  })();

  /** Live system metrics: per-service probes, DB checks, queue, platform storage. Not cached — status should be fresh. */
  async systemHealth(): Promise<AdminSystemHealth> {
    const driver = process.env.BROKER_DRIVER ?? "redis";

    const probe = async (name: string, url: string): Promise<AdminServiceHealth> => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 2500);
      const start = Date.now();
      try {
        const res = await fetch(url, { signal: ac.signal });
        const latencyMs = Date.now() - start;
        const status: HealthStatus = res.ok ? "up" : res.status === 503 ? "degraded" : "down";
        return { name, status, latencyMs, detail: `HTTP ${res.status}` };
      } catch {
        return { name, status: "down", latencyMs: null, detail: ac.signal.aborted ? "timeout" : "unreachable" };
      } finally {
        clearTimeout(timer);
      }
    };

    const checkDb = async (name: string, client: { $queryRaw: PrismaService["$queryRaw"] }): Promise<AdminDbHealth> => {
      const start = Date.now();
      try {
        await client.$queryRaw`SELECT 1`;
        return { name, status: "up", latencyMs: Date.now() - start };
      } catch {
        return { name, status: "down", latencyMs: null };
      }
    };

    const checkQueue = async (): Promise<AdminQueueHealth> => {
      const start = Date.now();
      try {
        await this.broker.ping();
        return { driver, status: "up", latencyMs: Date.now() - start };
      } catch {
        return { driver, status: "down", latencyMs: null };
      }
    };

    const [peers, identityDb, billingDb, analyticsDb, notificationsDb, queue, storage] = await Promise.all([
      Promise.all(AdminService.HEALTH_TARGETS.map((t) => probe(t.name, t.url))),
      checkDb("identity-db", this.prisma),
      checkDb("billing-db", this.billing),
      checkDb("analytics-db", this.analytics),
      checkDb("notifications-db", this.notifications),
      checkQueue(),
      this.computeStorageTotals(),
    ]);

    // identity-service is answering this request, so it's up by definition.
    const services: AdminServiceHealth[] = [{ name: "identity-service", status: "up", latencyMs: 0, detail: "self" }, ...peers];
    const databases = [identityDb, billingDb, analyticsDb, notificationsDb];

    const anyDown = services.some((s) => s.status === "down") || databases.some((d) => d.status === "down") || queue.status === "down";
    const anyDegraded = services.some((s) => s.status === "degraded") || queue.status === "degraded";
    const api: HealthStatus = anyDown || anyDegraded ? "degraded" : "up";

    return { api, services, databases, queue, storage, checkedAt: new Date().toISOString() };
  }

  private async computeStorageTotals(): Promise<AdminStorageTotals> {
    const agg = await this.prisma.screenshotObject.aggregate({ _sum: { sizeBytes: true }, _count: { _all: true } });
    const orgRows = await this.prisma.screenshotObject.findMany({ distinct: ["orgId"], select: { orgId: true } });

    // Sum plan storage limits across live subscriptions; any unlimited plan makes the total unbounded.
    const [subs, plans] = await Promise.all([
      this.billing.subscription.findMany({ where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, select: { planId: true } }),
      this.billing.plan.findMany({ select: { id: true, storageLimitMb: true } }),
    ]);
    const limitByPlan = new Map(plans.map((p) => [p.id, p.storageLimitMb]));
    let limitBytes: number | null = 0;
    for (const s of subs) {
      const mb = limitByPlan.get(s.planId);
      if (mb == null) {
        limitBytes = null; // unlimited tier in the mix
        break;
      }
      if (limitBytes !== null) limitBytes += mb * 1024 * 1024;
    }

    return { usedBytes: Number(agg._sum.sizeBytes ?? 0n), objects: agg._count._all, orgs: orgRows.length, limitBytes };
  }

  usageAnalytics(): Promise<AdminUsageAnalytics> {
    return this.cached("usage-analytics", () => this.computeUsageAnalytics());
  }

  /** Product usage: DAU/WAU/MAU + login trend (sessions) + feature adoption. */
  private async computeUsageAnalytics(): Promise<AdminUsageAnalytics> {
    const now = Date.now();
    const startToday = startOfUtcDay();
    const since30 = new Date(now - 30 * DAY_MS);

    // Active users = distinct users with a session touched within the window.
    const distinctActive = async (sinceMs: number): Promise<number> => {
      const rows = await this.prisma.session.findMany({ where: { lastUsedAt: { gte: new Date(now - sinceMs) } }, distinct: ["userId"], select: { userId: true } });
      return rows.length;
    };

    const [dau, wau, mau, loginsToday, trendRows, featureUsage] = await Promise.all([
      distinctActive(DAY_MS),
      distinctActive(7 * DAY_MS),
      distinctActive(30 * DAY_MS),
      this.prisma.session.count({ where: { createdAt: { gte: startToday } } }),
      this.prisma.$queryRaw<{ d: Date; logins: bigint; users: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS d, count(*) AS logins, count(DISTINCT "userId") AS users
        FROM "Session" WHERE "createdAt" >= ${since30} GROUP BY 1 ORDER BY 1`,
      this.computeFeatureUsage(),
    ]);

    const byDay = new Map<string, { logins: number; users: number }>();
    for (const r of trendRows) byDay.set(r.d.toISOString().slice(0, 10), { logins: Number(r.logins), users: Number(r.users) });
    const loginTrend: AdminLoginPoint[] = [];
    for (let i = 29; i >= 0; i -= 1) {
      const key = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
      const hit = byDay.get(key);
      loginTrend.push({ date: key, logins: hit?.logins ?? 0, users: hit?.users ?? 0 });
    }

    return { dau, wau, mau, loginsToday, loginTrend, featureUsage };
  }

  private async computeFeatureUsage(): Promise<AdminFeatureUsage[]> {
    const distinctOrgs = (rows: { orgId: string }[]) => new Set(rows.map((r) => r.orgId)).size;
    const [attC, attO, ssC, ssO, prC, prO, tkC, tkO, tmC, tmO] = await Promise.all([
      this.prisma.attendanceRecord.count(),
      this.prisma.attendanceRecord.findMany({ distinct: ["orgId"], select: { orgId: true } }),
      this.prisma.screenshotObject.count(),
      this.prisma.screenshotObject.findMany({ distinct: ["orgId"], select: { orgId: true } }),
      this.prisma.project.count(),
      this.prisma.project.findMany({ distinct: ["orgId"], select: { orgId: true } }),
      this.prisma.task.count(),
      this.prisma.task.findMany({ distinct: ["orgId"], select: { orgId: true } }),
      this.analytics.employeeDayFact.count(),
      this.analytics.employeeDayFact.findMany({ distinct: ["orgId"], select: { orgId: true } }),
    ]);
    return [
      { feature: "Time tracking", orgs: distinctOrgs(tmO), events: tmC },
      { feature: "Attendance", orgs: distinctOrgs(attO), events: attC },
      { feature: "Screenshots", orgs: distinctOrgs(ssO), events: ssC },
      { feature: "Projects", orgs: distinctOrgs(prO), events: prC },
      { feature: "Tasks", orgs: distinctOrgs(tkO), events: tkC },
    ];
  }

  // ---- Customer success ----

  /** Summary + churn counts span ALL orgs; the org table is paginated (worst-first). */
  async customerSuccess(query: { page: number; pageSize: number }): Promise<AdminCustomerSuccess> {
    const full = await this.cached("customer-success", () => this.computeCustomerSuccess());
    const start = (query.page - 1) * query.pageSize;
    return {
      summary: full.summary,
      churn: full.churn,
      organizations: {
        items: full.organizations.slice(start, start + query.pageSize),
        total: full.organizations.length,
        page: query.page,
        pageSize: query.pageSize,
      },
    };
  }

  /**
   * Per-org health score + churn-risk flags, derived entirely from existing
   * signals. Weights 35% frequency / 35% utilization / 30% adoption; bands
   * healthy>=70 / attention 40-69 / at_risk<40; inactive>14d; renewal window 30d.
   */
  private async computeCustomerSuccess(): Promise<{
    summary: AdminCustomerSuccess["summary"];
    churn: AdminCustomerSuccess["churn"];
    organizations: AdminOrgHealth[];
  }> {
    const INACTIVE_DAYS = 14;
    const RENEWAL_DAYS = 30;
    const now = Date.now();
    const since = new Date(now - WINDOW_DAYS * DAY_MS);

    const orgs = await this.prisma.organization.findMany({
      where: { status: { not: "DELETED" } },
      select: { id: true, name: true, status: true },
    });
    const orgIds = orgs.map((o) => o.id);
    if (orgIds.length === 0) {
      return { summary: { total: 0, healthy: 0, attention: 0, atRisk: 0, avgHealthScore: 0 }, churn: { lowUsage: 0, inactive: 0, renewalRisk: 0 }, organizations: [] };
    }

    const [subs, plans, sessions, factRows, attO, ssO, prO, tkO, tmO] = await Promise.all([
      this.billing.subscription.findMany({
        where: { orgId: { in: orgIds } },
        select: { orgId: true, planId: true, status: true, seats: true, activeSeats: true, currentPeriodEnd: true, autoRenew: true },
      }),
      this.billing.plan.findMany({ select: { id: true, name: true } }),
      this.prisma.session.groupBy({ by: ["orgId"], where: { orgId: { in: orgIds } }, _max: { lastUsedAt: true } }),
      this.analytics.$queryRaw<{ orgId: string; active_days: bigint; active_emp: bigint; active_seconds: bigint; avg_prod: number | string | null }[]>`
        SELECT "orgId",
               count(DISTINCT "day") AS active_days,
               count(DISTINCT "employeeId") AS active_emp,
               COALESCE(sum("activeSeconds"), 0)::bigint AS active_seconds,
               avg("productivityScore") AS avg_prod
        FROM "EmployeeDayFact" WHERE "day" >= ${since} GROUP BY "orgId"`,
      this.prisma.attendanceRecord.findMany({ distinct: ["orgId"], select: { orgId: true } }),
      this.prisma.screenshotObject.findMany({ distinct: ["orgId"], select: { orgId: true } }),
      this.prisma.project.findMany({ distinct: ["orgId"], select: { orgId: true } }),
      this.prisma.task.findMany({ distinct: ["orgId"], select: { orgId: true } }),
      this.analytics.employeeDayFact.findMany({ distinct: ["orgId"], select: { orgId: true } }),
    ]);

    const planName = new Map(plans.map((p) => [p.id, p.name]));
    const subByOrg = new Map(subs.map((s) => [s.orgId, s]));
    const lastActive = new Map(sessions.filter((s) => s.orgId).map((s) => [s.orgId as string, s._max.lastUsedAt]));
    const fact = new Map(factRows.map((r) => [r.orgId, r]));
    const setOf = (rows: { orgId: string }[]) => new Set(rows.map((r) => r.orgId));
    const fAtt = setOf(attO);
    const fSs = setOf(ssO);
    const fPr = setOf(prO);
    const fTk = setOf(tkO);
    const fTm = setOf(tmO);

    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
    const recencyScore = (days: number | null): number => {
      if (days == null) return 0;
      if (days <= 1) return 100;
      if (days <= 3) return 90;
      if (days <= 7) return 70;
      if (days <= 14) return 45;
      if (days <= 30) return 20;
      return 0;
    };

    const organizations: AdminOrgHealth[] = orgs.map((o) => {
      const sub = subByOrg.get(o.id);
      const seats = sub?.seats ?? 0;
      const f = fact.get(o.id);
      const activeEmployees = f ? Number(f.active_emp) : 0;
      const activeDays = f ? Number(f.active_days) : 0;
      const activeHours = f ? Math.round(Number(f.active_seconds) / 3600) : 0;
      const avgProductivity = f && f.avg_prod != null ? Math.round(Number(f.avg_prod)) : 0;

      const last = lastActive.get(o.id) ?? null;
      const daysSinceActive = last ? Math.floor((now - last.getTime()) / DAY_MS) : null;

      let featuresUsed = 0;
      for (const used of [fTm.has(o.id), fAtt.has(o.id), fSs.has(o.id), fPr.has(o.id), fTk.has(o.id)]) if (used) featuresUsed += 1;
      const adoption = clamp((featuresUsed / 5) * 100);
      const frequency = clamp(0.5 * recencyScore(daysSinceActive) + 0.5 * (activeDays / WINDOW_DAYS) * 100);
      const seatUtil = seats > 0 ? (activeEmployees / seats) * 100 : 0;
      const utilization = clamp(0.5 * Math.min(100, seatUtil) + 0.5 * avgProductivity);
      const healthScore = clamp(0.35 * frequency + 0.35 * utilization + 0.3 * adoption);
      const band: HealthBand = healthScore >= 70 ? "healthy" : healthScore >= 40 ? "attention" : "at_risk";

      const renewsInDays = sub ? Math.ceil((sub.currentPeriodEnd.getTime() - now) / DAY_MS) : null;
      const autoRenew = sub?.autoRenew ?? false;
      const subStatus = sub?.status ?? null;

      const risks: ChurnReason[] = [];
      if (seats > 0 && seatUtil < 30) risks.push("low_usage");
      if (daysSinceActive == null || daysSinceActive > INACTIVE_DAYS) risks.push("inactive");
      const renewalSoon = renewsInDays != null && renewsInDays <= RENEWAL_DAYS;
      if ((renewalSoon && (healthScore < 70 || !autoRenew)) || subStatus === "PAST_DUE" || subStatus === "SUSPENDED") risks.push("renewal_risk");

      return {
        orgId: o.id,
        name: o.name,
        plan: sub ? (planName.get(sub.planId) ?? sub.planId) : null,
        status: o.status,
        adoption,
        frequency,
        utilization,
        healthScore,
        band,
        featuresUsed,
        seats,
        activeEmployees,
        activeHours,
        avgProductivity,
        daysSinceActive,
        renewsInDays,
        autoRenew,
        risks,
      };
    });

    organizations.sort((a, b) => a.healthScore - b.healthScore); // worst first — the orgs that need attention

    const summary = {
      total: organizations.length,
      healthy: organizations.filter((r) => r.band === "healthy").length,
      attention: organizations.filter((r) => r.band === "attention").length,
      atRisk: organizations.filter((r) => r.band === "at_risk").length,
      avgHealthScore: organizations.length ? Math.round(organizations.reduce((s, r) => s + r.healthScore, 0) / organizations.length) : 0,
    };
    const churn = {
      lowUsage: organizations.filter((r) => r.risks.includes("low_usage")).length,
      inactive: organizations.filter((r) => r.risks.includes("inactive")).length,
      renewalRisk: organizations.filter((r) => r.risks.includes("renewal_risk")).length,
    };

    return { summary, churn, organizations };
  }

  /** Subscription lifecycle: status counts + upcoming renewals/expirations + failed payments. */
  private async computeSubscriptions(): Promise<AdminSubscriptionsView> {
    const now = new Date();
    const soon = new Date(now.getTime() + 14 * DAY_MS);
    const [statusGroups, upcomingSubs, failedSubs] = await Promise.all([
      this.billing.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
      this.billing.subscription.findMany({
        where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] }, currentPeriodEnd: { lte: soon } },
        include: { plan: { select: { name: true } } },
        orderBy: { currentPeriodEnd: "asc" },
        take: 50,
      }),
      this.billing.subscription.findMany({
        where: { status: { in: ["PAST_DUE", "SUSPENDED"] } },
        include: { plan: { select: { name: true } }, invoices: { where: { status: "OPEN" }, orderBy: { dueAt: "asc" }, take: 1 } },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
    ]);

    const count = (s: string) => statusGroups.find((g) => g.status === s)?._count._all ?? 0;

    const orgIds = [...new Set([...upcomingSubs, ...failedSubs].map((s) => s.orgId))];
    const orgs = await this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
    const nameById = new Map(orgs.map((o) => [o.id, o.name]));

    const upcoming: AdminSubLifecycleRow[] = upcomingSubs.map((s) => ({
      orgId: s.orgId,
      orgName: nameById.get(s.orgId) ?? "Unknown",
      plan: s.plan.name,
      status: s.status,
      autoRenew: s.autoRenew,
      currentPeriodEnd: s.currentPeriodEnd.toISOString(),
      daysLeft: Math.ceil((s.currentPeriodEnd.getTime() - now.getTime()) / DAY_MS),
    }));

    const failed: AdminFailedPaymentRow[] = failedSubs.map((s) => {
      const inv = s.invoices[0];
      return {
        orgId: s.orgId,
        orgName: nameById.get(s.orgId) ?? "Unknown",
        plan: s.plan.name,
        status: s.status,
        amountDue: inv?.amountDue ?? 0,
        dueAt: inv?.dueAt ? inv.dueAt.toISOString() : null,
        daysOverdue: inv ? Math.max(0, Math.floor((now.getTime() - inv.dueAt.getTime()) / DAY_MS)) : 0,
      };
    });

    const expiringSoon = upcomingSubs.filter((s) => s.status !== "PAST_DUE").length;
    return {
      counts: { active: count("ACTIVE"), trialing: count("TRIALING"), pastDue: count("PAST_DUE"), suspended: count("SUSPENDED"), canceled: count("CANCELED"), expiringSoon },
      upcoming,
      failed,
    };
  }

  private async computeUsage(): Promise<AdminUsage> {
    const since = this.windowStart();
    const [dayGroups, orgGroups, orgs] = await Promise.all([
      this.analytics.employeeDayFact.groupBy({
        by: ["day"],
        where: { day: { gte: since } },
        _sum: { activeSeconds: true, idleSeconds: true, productiveSeconds: true },
        _avg: { productivityScore: true },
      }),
      this.analytics.employeeDayFact.groupBy({
        by: ["orgId"],
        where: { day: { gte: since } },
        _sum: { activeSeconds: true },
        _avg: { productivityScore: true },
      }),
      this.prisma.organization.findMany({ select: { id: true, name: true } }),
    ]);

    const byDay = new Map(dayGroups.map((g) => [g.day.toISOString().slice(0, 10), g]));
    // Dense 30-day skeleton so the chart has a continuous axis even when sparse.
    const series: AdminUsagePoint[] = [];
    for (let d = WINDOW_DAYS - 1; d >= 0; d -= 1) {
      const date = new Date(Date.now() - d * DAY_MS).toISOString().slice(0, 10);
      const g = byDay.get(date);
      series.push({
        date,
        activeHours: hours(g?._sum.activeSeconds),
        idleHours: hours(g?._sum.idleSeconds),
        productiveHours: hours(g?._sum.productiveSeconds),
        avgProductivity: score(g?._avg.productivityScore),
      });
    }

    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const topOrgs = [...orgGroups]
      .sort((a, b) => (b._sum.activeSeconds ?? 0) - (a._sum.activeSeconds ?? 0))
      .slice(0, 8)
      .map((g) => ({
        id: g.orgId,
        name: orgName.get(g.orgId) ?? "Unknown org",
        activeHours: hours(g._sum.activeSeconds),
        avgProductivity: score(g._avg.productivityScore),
      }));

    const totals = series.reduce(
      (acc, p) => {
        acc.activeHours += p.activeHours;
        acc.idleHours += p.idleHours;
        acc.productiveHours += p.productiveHours;
        return acc;
      },
      { activeHours: 0, idleHours: 0, productiveHours: 0 },
    );
    const avgProductivity =
      series.filter((p) => p.avgProductivity > 0).reduce((s, p, _i, arr) => s + p.avgProductivity / arr.length, 0) || 0;

    return { series, topOrgs, totals: { ...totals, avgProductivity: Math.round(avgProductivity) } };
  }
}
