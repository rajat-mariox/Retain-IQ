import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { OffsetPage, PlanPricing } from "@retainiq/contracts";
import { computePrice, effectivePricing, planPricingOf } from "@retainiq/contracts";
import { AnalyticsReadPrismaService } from "../../common/database/analytics-prisma.service.js";
import { BillingReadPrismaService } from "../../common/database/billing-prisma.service.js";
import { NotificationsReadPrismaService } from "../../common/database/notifications-prisma.service.js";
import { BrokerService } from "../../common/messaging/broker.service.js";
import { hashPassword } from "../../common/crypto/password.util.js";
import { generateTempPassword } from "../../common/crypto/temp-password.util.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { PlatformSettingsService } from "../../common/settings/platform-settings.service.js";
import { RealtimePublisher } from "../../common/realtime/realtime-publisher.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { ensureSystemRoles } from "../../common/security/roles.util.js";
import { OrgStatusService } from "../../common/security/org-status.service.js";
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
  AdminGrowth,
  AdminGrowthPoint,
  AdminSeatPoint,
  AdminStoragePoint,
  AdminUsagePoint,
  ChurnReason,
  HealthBand,
  HealthStatus,
} from "./admin.dto.js";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
/** Seats a new org gets when the admin doesn't say. Low on purpose — raising seats is easy, refunding isn't. */
const DEFAULT_SEATS = 10;
// Platform-wide rollups change slowly; a short cache spares a full recompute on
// every dashboard load. Mutations (create-org) clear it.
const CACHE_TTL_MS = 30_000;

// Audit/activity feeds fetch `page * pageSize` rows from ~4 sources, then merge +
// sort in memory before slicing the page. That cost grows linearly with the page
// number, so deep offset paging pulls thousands of rows per request. Until the
// deferred keyset/cursor rewrite lands, cap the effective offset depth and steer
// admins to narrow with filters / a date range instead of paging into the tail.
const MAX_OFFSET_DEPTH = 1000;

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * The org-local calendar date of an instant, keyed as a UTC-midnight Date so it
 * matches how AttendanceRecord.day is bucketed (tz-aware, in the org timezone).
 * Falls back to UTC-day if the timezone is unusable.
 */
function attendanceDayFor(instant: Date, tz: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
    const y = Number(parts.find((p) => p.type === "year")?.value);
    const m = Number(parts.find((p) => p.type === "month")?.value);
    const d = Number(parts.find((p) => p.type === "day")?.value);
    if (!y || !m || !d) return startOfUtcDay(instant);
    return new Date(Date.UTC(y, m - 1, d));
  } catch {
    return startOfUtcDay(instant);
  }
}

/**
 * Seconds → hours, to one decimal. NOT whole hours: rounding 840s (14 min) to
 * "0 h" reads as "did nothing", and any caller testing `hours > 0` would then
 * silently drop that person.
 */
const hours = (seconds: number | null | undefined) => Math.round(((seconds ?? 0) / 3600) * 10) / 10;
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
    private readonly settings: PlatformSettingsService,
    private readonly realtime: RealtimePublisher,
    private readonly orgStatus: OrgStatusService,
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

    // One batched query per fact, scoped to this page's orgIds — never N+1.
    const [memberCounts, employeeCounts, lastSessions, factAgg, activeEmpRows, subs, plans, storageAgg] = await Promise.all([
      this.prisma.organizationMembership.groupBy({ by: ["orgId"], where: { orgId: { in: ids } }, _count: { _all: true } }),
      this.prisma.employee.groupBy({ by: ["orgId"], where: { orgId: { in: ids } }, _count: { _all: true } }),
      this.prisma.session.groupBy({ by: ["orgId"], where: { orgId: { in: ids } }, _max: { lastUsedAt: true } }),
      this.analytics.employeeDayFact.groupBy({
        by: ["orgId"],
        where: { orgId: { in: ids }, day: { gte: since } },
        _sum: { activeSeconds: true },
        _avg: { productivityScore: true },
      }),
      // Distinct employees with activity — groupBy can't COUNT(DISTINCT), so ask SQL.
      this.analytics.$queryRaw<{ orgId: string; active_emp: bigint }[]>`
        SELECT "orgId", count(DISTINCT "employeeId") AS active_emp
        FROM "EmployeeDayFact" WHERE "day" >= ${since} GROUP BY "orgId"`,
      this.billing.subscription.findMany({
        where: { orgId: { in: ids } },
        select: { orgId: true, planId: true, status: true, seats: true, currentPeriodEnd: true, trialEndsAt: true },
      }),
      this.billing.plan.findMany({ select: { id: true, name: true, storageLimitMb: true } }),
      this.prisma.screenshotObject.groupBy({ by: ["orgId"], where: { orgId: { in: ids } }, _sum: { sizeBytes: true } }),
    ]);

    const members = new Map(memberCounts.map((m) => [m.orgId, m._count._all]));
    const employees = new Map(employeeCounts.map((e) => [e.orgId, e._count._all]));
    const lastActive = new Map(lastSessions.filter((s) => s.orgId).map((s) => [s.orgId!, s._max.lastUsedAt]));
    const facts = new Map(factAgg.map((f) => [f.orgId, f]));
    const activeEmp = new Map(activeEmpRows.map((r) => [r.orgId, Number(r.active_emp)]));
    const subByOrg = new Map(subs.map((s) => [s.orgId, s]));
    const planById = new Map(plans.map((p) => [p.id, p]));
    const storageByOrg = new Map(storageAgg.map((s) => [s.orgId, s._sum.sizeBytes ? Number(s._sum.sizeBytes) : 0]));

    const items = orgs.map((o): AdminOrg => {
      const fact = facts.get(o.id);
      const last = lastActive.get(o.id) ?? null;
      const sub = subByOrg.get(o.id);
      const plan = sub ? planById.get(sub.planId) : undefined;
      return {
        id: o.id,
        name: o.name,
        slug: o.slug,
        billingEmail: null, // not needed in the list view; resolved on the detail page
        status: o.status,
        users: members.get(o.id) ?? 0,
        employees: employees.get(o.id) ?? 0,
        activeUsers: activeEmp.get(o.id) ?? 0,
        avgProductivity: score(fact?._avg.productivityScore),
        activeHours: hours(fact?._sum.activeSeconds),
        createdAt: o.createdAt.toISOString(),
        lastActiveAt: last ? last.toISOString() : null,
        plan: sub?.planId ?? null,
        planName: plan?.name ?? sub?.planId ?? null,
        subscriptionStatus: sub?.status ?? null,
        seats: sub?.seats ?? null,
        renewsAt: sub?.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
        // Only meaningful while trialing — a paying customer has no expiry.
        trialEndsAt: sub?.status === "TRIALING" && sub.trialEndsAt ? sub.trialEndsAt.toISOString() : null,
        storageUsedBytes: storageByOrg.get(o.id) ?? 0,
        storageLimitBytes: plan?.storageLimitMb != null ? plan.storageLimitMb * 1024 * 1024 : null,
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

    // Attendance days are bucketed in the org timezone, so "today" for this org's
    // attendance rollup must be the org-local calendar date, not UTC midnight.
    const today = attendanceDayFor(new Date(), org.timezone || "UTC");
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
      billingEmail: subscription?.billingEmail ?? null,
      status: org.status,
      users: memberCount,
      employees: employees.length,
      // Count from raw SECONDS, matching the org list's COUNT(DISTINCT employeeId).
      // Counting `activeHours > 0` instead would silently drop anyone under ~30
      // minutes, because hours() rounds 840s to 0 — the list and this page then
      // disagree about the same org.
      activeUsers: factByEmployee.filter((f) => (f._sum.activeSeconds ?? 0) > 0).length,
      avgProductivity,
      activeHours: employeeRows.reduce((s, e) => s + e.activeHours, 0),
      createdAt: org.createdAt.toISOString(),
      lastActiveAt: lastSession._max.lastUsedAt ? lastSession._max.lastUsedAt.toISOString() : null,
      plan: subscription?.planId ?? null,
      planName: subscription?.plan?.name ?? subscription?.planId ?? null,
      subscriptionStatus: subscription?.status ?? null,
      seats: subscription?.seats ?? null,
      renewsAt: subscription?.currentPeriodEnd ? subscription.currentPeriodEnd.toISOString() : null,
      trialEndsAt: subscription?.status === "TRIALING" && subscription.trialEndsAt ? subscription.trialEndsAt.toISOString() : null,
      storageUsedBytes: storageAgg._sum.sizeBytes ? Number(storageAgg._sum.sizeBytes) : 0,
      storageLimitBytes: subscription?.plan?.storageLimitMb != null ? subscription.plan.storageLimitMb * 1024 * 1024 : null,
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
          // Canonical MRR (cents): paying + live only; trials contribute $0 — same
          // helper the billing page uses, so the two surfaces agree on unit + trials.
          // Uses the subscription's LOCKED rate (falls back to live plan).
          mrr: this.billableMrrCents(
            subscription.status,
            subscription.activeSeats,
            effectivePricing(
              { basePrice: subscription.lockedBasePrice ?? undefined, includedSeats: subscription.lockedIncludedSeats ?? undefined, additionalSeatPrice: subscription.lockedAdditionalSeatPrice ?? undefined },
              planPricingOf(subscription.plan),
            ),
            true,
          ),
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
    attendancePolicy?: Record<string, unknown>;
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

    // Deliberately NOT plan.seatLimit: defaulting to the ceiling would bill a new
    // Basic org for 50 seats ($400/mo) nobody asked for. Start small — seats are
    // cheap to raise and awkward to refund. Capped so the default can't itself
    // exceed a smaller plan.
    const seats = input.seats ?? Math.min(DEFAULT_SEATS, plan.seatLimit ?? DEFAULT_SEATS);
    // billing-service enforces this on plan CHANGE (plan-api.ts) but nothing
    // enforced it on create — an org could be provisioned above its plan's limit.
    if (plan.seatLimit != null && seats > plan.seatLimit) {
      throw new BadRequestException(`${plan.name} allows at most ${plan.seatLimit} seats.`);
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    const slug = await this.uniqueSlug(input.orgName);

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
      // Attendance rules chosen at provisioning time. Omitted -> the org runs on
      // schema defaults (single session, no re-entry) until the platform edits it.
      if (input.attendancePolicy && Object.keys(input.attendancePolicy).length > 0) {
        await tx.attendancePolicy.create({ data: { orgId: created.id, ...input.attendancePolicy } });
      }
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

  /**
   * Attendance rules for one org. Returns the stored row, or the schema defaults
   * when the tenant has never been configured, so the console always has a
   * complete object to edit rather than a half-empty form.
   */
  async getAttendancePolicy(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
    if (!org) throw new NotFoundException("Organization not found.");
    const row = await this.prisma.attendancePolicy.findUnique({ where: { orgId } });
    return {
      orgId,
      orgName: org.name,
      configured: Boolean(row),
      policy: row ?? {
        allowMultipleSessions: false,
        allowReEntry: false,
        maxSessionsPerDay: 1,
        maxBreaksPerDay: 0,
        maxBreakMinutesPerDay: 0,
        maxSingleBreakMinutes: 0,
        paidBreakMinutesPerDay: 0,
        allowCheckOutOnBreak: false,
        minMinutesBeforeBreak: 0,
        minMinutesBeforeCheckOut: 0,
        graceMinutes: 10,
        autoCheckOutAtShiftEnd: false,
        autoCheckOutAfterMinutes: 120,
        idleCheckoutMinutes: 0,
        idleCheckoutWarnMinutes: 5,
        overtimeAfterMinutes: 0,
        minHoursForPresent: 240,
        workModel: "WFO",
        allowedLocations: ["OFFICE", "HOME", "CLIENT_SITE", "REMOTE"],
        requireLocation: false,
        allowManualCorrection: true,
      },
    };
  }

  /** Create or update the org's attendance rules. */
  async setAttendancePolicy(orgId: string, input: Record<string, unknown>) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
    if (!org) throw new NotFoundException("Organization not found.");

    // Keep the two switches coherent: capping sessions at 1 means no re-entry,
    // and allowing re-entry implies more than one session a day.
    const data = { ...input } as Record<string, unknown>;
    if (data.allowReEntry === true && data.allowMultipleSessions === undefined) data.allowMultipleSessions = true;
    if (data.allowMultipleSessions === false && data.allowReEntry === undefined) data.allowReEntry = false;

    const saved = await this.prisma.attendancePolicy.upsert({
      where: { orgId },
      create: { orgId, ...data },
      update: data,
    });
    this.recordEvent("org.attendance_policy", orgId, `Attendance policy updated for "${org.name}"`);
    return saved;
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
    const before = await this.prisma.organization.findUnique({ where: { id }, select: { status: true } });
    if (!before || before.status === "DELETED") {
      throw new NotFoundException("Organization not found.");
    }

    // Update the status and emit a lifecycle event atomically (transactional
    // outbox), so billing-service can cancel/suspend/reactivate the subscription.
    // Without this a deleted/suspended org keeps counting toward platform revenue.
    const org = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.organization.update({
        where: { id },
        data: { status },
        select: { id: true, status: true, name: true },
      });
      const eventType =
        status === "DELETED" ? "organization.deleted" : status === "SUSPENDED" ? "organization.suspended" : "organization.reactivated";
      await this.outbox.enqueue(tx, {
        eventType,
        aggregateType: "organization",
        aggregateId: id,
        orgId: id,
        payload: { orgId: id, previousStatus: before.status, newStatus: status },
      });
      return updated;
    });

    this.cache.clear();
    // Also drop cached org status so session lockout / re-activation is immediate.
    this.orgStatus.invalidate(id);
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

  /**
   * The set of orgIds whose subscriptions should count toward revenue/usage —
   * i.e. the org is still live in identity (ACTIVE or SUSPENDED, never DELETED).
   * billing-db can't know an org's identity lifecycle, so the rollups intersect
   * against this to avoid counting a soft-deleted org's stale subscription.
   */
  private async liveOrgIds(): Promise<Set<string>> {
    const rows = await this.prisma.organization.findMany({
      where: { status: { not: "DELETED" } },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Canonical monthly recurring revenue for one subscription, in CENTS.
   * Revenue is recognised only for a paying subscription (ACTIVE/PAST_DUE) whose
   * org is live; trials and non-live orgs contribute $0. Single source of truth
   * so the billing page and the org-detail page never disagree on unit or trials.
   */
  private billableMrrCents(status: string, activeSeats: number, pricing: PlanPricing, orgLive: boolean): number {
    const paying = status === "ACTIVE" || status === "PAST_DUE";
    return paying && orgLive ? computePrice(pricing, activeSeats).totalPrice : 0;
  }

  /**
   * Which live organizations are subscribed to a given plan (id + name + status),
   * for the "can't delete a plan that's in use" guard in the admin plan manager.
   * billing-db only knows orgIds, so we resolve names from identity. Soft-deleted
   * orgs are excluded — they don't block a delete.
   */
  async planUsage(planId: string): Promise<{ planId: string; orgs: { id: string; name: string; status: string }[] }> {
    const subs = await this.billing.subscription.findMany({
      where: { planId },
      select: { orgId: true, status: true },
    });
    if (subs.length === 0) return { planId, orgs: [] };
    const ids = subs.map((s) => s.orgId);
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: ids }, status: { not: "DELETED" } },
      select: { id: true, name: true },
    });
    const nameById = new Map(orgs.map((o) => [o.id, o.name]));
    const statusByOrg = new Map(subs.map((s) => [s.orgId, s.status]));
    return {
      planId,
      // Only orgs that still exist (name resolved) count as blocking the delete.
      orgs: orgs.map((o) => ({ id: o.id, name: nameById.get(o.id) ?? o.id, status: statusByOrg.get(o.id) ?? "" })),
    };
  }

  private async computeBilling(): Promise<AdminBilling> {
    // Load plans + every subscription (one row per org — small), then drop subs
    // whose org is soft-deleted in identity so a dead org never inflates revenue.
    const [plans, allSubs, live] = await Promise.all([
      this.billing.plan.findMany({ orderBy: { sortOrder: "asc" } }),
      this.billing.subscription.findMany({
        select: {
          orgId: true, planId: true, status: true, activeSeats: true,
          lockedBasePrice: true, lockedIncludedSeats: true, lockedAdditionalSeatPrice: true,
        },
      }),
      this.liveOrgIds(),
    ]);
    const subs = allSubs.filter((s) => live.has(s.orgId));
    const pricingByPlan = new Map(plans.map((p) => [p.id, planPricingOf(p)]));
    const paying = (s: string) => s === "ACTIVE" || s === "PAST_DUE";
    // Each sub bills at its own LOCKED rate; fall back to the live plan's model.
    const mrrCentsOf = (s: { status: string; activeSeats: number; planId: string; lockedBasePrice: number | null; lockedIncludedSeats: number | null; lockedAdditionalSeatPrice: number | null }) =>
      this.billableMrrCents(
        s.status,
        s.activeSeats,
        effectivePricing(
          { basePrice: s.lockedBasePrice ?? undefined, includedSeats: s.lockedIncludedSeats ?? undefined, additionalSeatPrice: s.lockedAdditionalSeatPrice ?? undefined },
          pricingByPlan.get(s.planId) ?? { basePrice: 0, includedSeats: 0, additionalSeatPrice: 0 },
        ),
        true,
      ); // already live-filtered

    // Plan distribution (orgs/seats/MRR per plan; MRR in whole dollars).
    const planDist: AdminPlanDist[] = plans.map((p) => {
      const rows = subs.filter((s) => s.planId === p.id);
      const orgs = rows.length;
      const seats = rows.reduce((sum, s) => sum + s.activeSeats, 0);
      const planMrrCents = rows.reduce((sum, s) => sum + mrrCentsOf(s), 0);
      return { plan: p.id, name: p.name, orgs, seats, mrr: Math.round(planMrrCents / 100), color: p.color };
    });

    const payingSubs = subs.filter((s) => paying(s.status));
    const mrr = Math.round(subs.reduce((sum, s) => sum + mrrCentsOf(s), 0) / 100);
    const payingOrgs = payingSubs.length;
    const totalSeats = payingSubs.reduce((sum, s) => sum + s.activeSeats, 0);
    const totalOrgs = subs.length;

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

    // Top paying customers — per-org MRR (paying + live subs), ranked. Reuse the
    // already-loaded, live-filtered subs so the same MRR definition applies.
    const planNameById = new Map(plans.map((p) => [p.id, p.name]));
    const ranked = payingSubs
      .map((s) => ({
        orgId: s.orgId,
        plan: planNameById.get(s.planId) ?? s.planId,
        seats: s.activeSeats,
        mrr: Math.round(mrrCentsOf(s) / 100),
      }))
      .sort((a, b) => b.mrr - a.mrr)
      .slice(0, 10);
    const custOrgs = await this.prisma.organization.findMany({ where: { id: { in: ranked.map((r) => r.orgId) } }, select: { id: true, name: true } });
    const custName = new Map(custOrgs.map((o) => [o.id, o.name]));
    const topCustomers: AdminTopCustomer[] = ranked.map((r) => ({ orgId: r.orgId, orgName: custName.get(r.orgId) ?? "Unknown", plan: r.plan, seats: r.seats, mrr: r.mrr }));

    return { plans: planDist, revenue, trend, topCustomers };
  }

  // ---- Org-level feature flags --------------------------------------------

  /**
   * Every feature for one org: the global default, this org's override (if any),
   * and the effective result. The admin UI needs all three to explain WHY a
   * feature is off — inherited, overridden, or killed globally.
   */
  async orgFeatures(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
    if (!org) throw new NotFoundException("Organization not found.");

    const [{ featureFlags: globals }, overrides, resolved] = await Promise.all([
      this.settings.getSettings(),
      this.prisma.orgFeatureFlag.findMany({ where: { orgId }, select: { feature: true, enabled: true, reason: true, updatedAt: true } }),
      this.settings.resolveFeatureFlags(orgId),
    ]);
    const overrideBy = new Map(overrides.map((o) => [o.feature, o]));

    return {
      orgId: org.id,
      orgName: org.name,
      // Only tenant product features — a super-admin console module (Customer
      // Success, Platform Health) is global-only and can't be toggled per org.
      features: this.settings.tenantFeatureKeys().map((feature) => {
        const o = overrideBy.get(feature);
        const r = resolved[feature];
        return {
          feature,
          globalEnabled: globals[feature] !== false,
          override: o ? o.enabled : null, // null = inheriting the global
          enabled: r?.enabled ?? false,
          source: r?.source ?? "global", // global | org | kill_switch
          reason: o?.reason ?? null,
          updatedAt: o?.updatedAt.toISOString() ?? null,
        };
      }),
    };
  }

  /** Set or clear one org's override. Emits a platform event so it lands in the audit trail. */
  async setOrgFeature(orgId: string, input: { feature: string; enabled: boolean | null; reason?: string }) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
    if (!org) throw new NotFoundException("Organization not found.");
    if (!this.settings.isKnownFeature(input.feature)) {
      throw new BadRequestException(`Unknown feature "${input.feature}". Known: ${this.settings.featureKeys().join(", ")}.`);
    }
    if (!this.settings.isTenantFeature(input.feature)) {
      throw new BadRequestException(`"${input.feature}" is a platform-console feature and can't be set per organization.`);
    }
    // Don't persist an inert "on" override for a premium feature the org's plan
    // doesn't include: the plan gate nullifies it now, but it would silently
    // switch the feature ON the moment the org upgraded. Reject up front.
    // (Disabling and resetting stay allowed — you can always turn something off.)
    if (input.enabled === true && this.settings.isPremiumFeature(input.feature)) {
      const granted = await this.settings.orgHasPlanFeature(orgId, input.feature);
      if (!granted) {
        throw new BadRequestException(
          `"${input.feature}" is a premium feature not included in ${org.name}'s current plan. Upgrade the plan to enable it.`,
        );
      }
    }

    await this.settings.setOrgFeature({ orgId, feature: input.feature, enabled: input.enabled, reason: input.reason });

    const action = input.enabled === null ? "reset to the global default" : input.enabled ? "enabled" : "disabled";
    await this.prisma.platformEvent.create({
      data: {
        type: input.enabled === null ? "feature.reset" : input.enabled ? "feature.enabled" : "feature.disabled",
        orgId,
        summary: `Feature "${input.feature}" ${action} for ${org.name}${input.reason ? ` — ${input.reason}` : ""}`,
      },
    });
    this.cache.delete("customer-success"); // adoption counts shift with flags

    // Nudge this org's live tabs to re-check their flags so a turned-off feature
    // disappears without a manual refresh. Best-effort — the guard already
    // enforces the change on the next request regardless.
    void this.realtime.publishToOrg(orgId, { type: "feature.changed", feature: input.feature });

    return this.orgFeatures(orgId);
  }

  /**
   * Persist a platform-settings patch. When the patch touches the global feature
   * flags, broadcast so every tenant's live tabs re-check — a global kill switch
   * must vanish everywhere, not just where someone happens to refresh.
   */
  async updateSettings(input: Parameters<PlatformSettingsService["updateSettings"]>[0]) {
    const result = await this.settings.updateSettings(input);
    if (input.featureFlags) {
      this.cache.delete("customer-success");
      void this.realtime.publishToAll({ type: "feature.changed", scope: "global" });
    }
    return result;
  }

  /** One feature across every org — answers "who really has this on?". */
  async featureMatrix(feature: string) {
    if (!this.settings.isKnownFeature(feature)) {
      throw new BadRequestException(`Unknown feature "${feature}".`);
    }
    const [{ featureFlags: globals }, orgs, overrides] = await Promise.all([
      this.settings.getSettings(),
      this.prisma.organization.findMany({ where: { status: { not: "DELETED" } }, select: { id: true, name: true, status: true }, orderBy: { name: "asc" } }),
      this.prisma.orgFeatureFlag.findMany({ where: { feature }, select: { orgId: true, enabled: true, reason: true } }),
    ]);
    const globalEnabled = globals[feature] !== false;
    const overrideBy = new Map(overrides.map((o) => [o.orgId, o]));

    // Premium features are gated by each org's subscription plan, exactly as the
    // runtime guard resolves them. Without this the matrix reports premium
    // features as ON for orgs whose plan doesn't include them. Batch the plan
    // lookup in one billing-db read to avoid an N+1 across orgs.
    const planFeature = this.settings.planFeatureFor(feature);
    const isPremium = this.settings.isPremiumFeature(feature);
    const planByOrg = isPremium ? await this.settings.orgsPlanFeatures(orgs.map((o) => o.id)) : null;

    return {
      feature,
      globalEnabled,
      organizations: orgs.map((o) => {
        const ov = overrideBy.get(o.id);
        // Precedence mirrors PlatformSettingsService.resolveFeatureFlags:
        //   kill switch > plan > org override > global.
        let enabled: boolean;
        let source: "kill_switch" | "plan" | "org" | "global";
        if (!globalEnabled) {
          enabled = false;
          source = "kill_switch";
        } else if (isPremium && planFeature && !(planByOrg?.get(o.id)?.has(planFeature) ?? false)) {
          enabled = false;
          source = "plan";
        } else if (ov !== undefined) {
          enabled = ov.enabled;
          source = "org";
        } else {
          enabled = true;
          source = "global";
        }
        return {
          orgId: o.id,
          orgName: o.name,
          status: o.status,
          override: ov ? ov.enabled : null,
          enabled,
          source,
          reason: ov?.reason ?? null,
        };
      }),
    };
  }

  usage(): Promise<AdminUsage> {
    return this.cached("usage", () => this.computeUsage());
  }

  subscriptions(): Promise<AdminSubscriptionsView> {
    return this.cached("subscriptions", () => this.computeSubscriptions());
  }

  /** Platform activity feed: org actions (identity-db) merged with billing events (billing-db). */
  /**
   * The platform activity feed: org lifecycle + user changes (PlatformEvent,
   * identity-db) merged with subscription/plan changes (BillingEvent, billing-db).
   *
   * Filters are applied in each DB before the merge, so paging stays correct —
   * filtering after the merge would page over rows that were about to be dropped.
   */
  async activity(query: { page: number; pageSize: number; orgId?: string; type?: string; from?: string; to?: string }): Promise<AdminActivityFeed> {
    const take = query.page * query.pageSize; // enough from each source to cover the page after merge
    // Deep offset paging pulls `take` rows from every source, then merges + sorts
    // in memory — cost grows with the page. Cap it (see MAX_OFFSET_DEPTH).
    if (take > MAX_OFFSET_DEPTH) {
      throw new BadRequestException("That page is too deep to load efficiently. Narrow the results with a filter or a from/to date range instead of paging further.");
    }

    const createdAt =
      query.from || query.to
        ? {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            // `to` is inclusive of the whole day the admin picked.
            ...(query.to ? { lt: new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}),
          }
        : undefined;
    const where = {
      ...(query.orgId ? { orgId: query.orgId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(createdAt ? { createdAt } : {}),
    };

    const [orgEvents, billingEvents, orgTotal, billingTotal] = await Promise.all([
      this.prisma.platformEvent.findMany({ where, orderBy: { createdAt: "desc" }, take, select: { id: true, type: true, summary: true, orgId: true, createdAt: true } }),
      this.billing.billingEvent.findMany({ where, orderBy: { createdAt: "desc" }, take, select: { id: true, type: true, summary: true, orgId: true, createdAt: true } }),
      this.prisma.platformEvent.count({ where }),
      this.billing.billingEvent.count({ where }),
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
   * Distinct event types + orgs present in the feed, for the filter dropdowns.
   * Derived from the data rather than a hardcoded list, so a type can never be
   * offered as a filter that would return nothing.
   */
  async activityFilters(): Promise<{ types: string[]; organizations: { id: string; name: string }[] }> {
    const [orgTypes, billingTypes, orgIdRows] = await Promise.all([
      this.prisma.platformEvent.findMany({ distinct: ["type"], select: { type: true } }),
      this.billing.billingEvent.findMany({ distinct: ["type"], select: { type: true } }),
      this.prisma.platformEvent.findMany({ distinct: ["orgId"], select: { orgId: true } }),
    ]);
    const types = [...new Set([...orgTypes, ...billingTypes].map((t) => t.type))].sort();
    const ids = orgIdRows.map((r) => r.orgId).filter((x): x is string => Boolean(x));
    const organizations = await this.prisma.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return { types, organizations };
  }

  /**
   * Org seat/plan change requests for the platform approval queue. Reads the request
   * rows from billing-db and joins identity-db for org names + billing-db plan names,
   * so the queue shows "Acme: Basic/10 → Pro/25" rather than raw ids.
   */
  async listChangeRequests(status?: string) {
    const valid = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
    const s = valid.find((v) => v === status);
    const rows = await this.billing.subscriptionChangeRequest.findMany({
      where: s ? { status: s } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const orgIds = [...new Set(rows.map((r) => r.orgId))];
    const planIds = [...new Set(rows.flatMap((r) => [r.fromPlanId, r.toPlanId]))];
    const [orgs, plans] = await Promise.all([
      this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }),
      this.billing.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true } }),
    ]);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const planName = new Map(plans.map((p) => [p.id, p.name]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        orgId: r.orgId,
        orgName: orgName.get(r.orgId) ?? null,
        fromPlanId: r.fromPlanId,
        fromPlanName: planName.get(r.fromPlanId) ?? r.fromPlanId,
        toPlanId: r.toPlanId,
        toPlanName: planName.get(r.toPlanId) ?? r.toPlanId,
        fromSeats: r.fromSeats,
        toSeats: r.toSeats,
        estimatedTotalPrice: r.estimatedTotalPrice,
        estimatedDeltaPrice: r.estimatedDeltaPrice,
        status: r.status,
        requestedByEmail: r.requestedByEmail,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
        decidedByName: r.decidedByName,
        decidedAt: r.decidedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Audit & compliance log. Merges login logs (tenant + super-admin sessions),
   * organization activities (PlatformEvent), and subscription/plan changes
   * (BillingEvent) into one filterable, paginated stream with actor + IP.
   */
  async auditLogs(query: { category: AuditCategory | "all"; page: number; pageSize: number }): Promise<AdminAuditPage> {
    const { category, page, pageSize } = query;
    const take = page * pageSize; // enough from each source to cover the page after merge
    // Deep offset paging pulls `take` rows from every source, then merges + sorts
    // in memory — cost grows with the page. Cap it (see MAX_OFFSET_DEPTH).
    if (take > MAX_OFFSET_DEPTH) {
      throw new BadRequestException("That page is too deep to load efficiently. Narrow the results with a category filter instead of paging further.");
    }
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

    // Sum plan storage limits across live subscriptions; any unlimited plan makes
    // the total unbounded. Exclude subs whose org is soft-deleted in identity.
    const [rawSubs, plans, live] = await Promise.all([
      this.billing.subscription.findMany({ where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, select: { orgId: true, planId: true } }),
      this.billing.plan.findMany({ select: { id: true, storageLimitMb: true } }),
      this.liveOrgIds(),
    ]);
    const subs = rawSubs.filter((s) => live.has(s.orgId));
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

  growth(): Promise<AdminGrowth> {
    return this.cached("growth", () => this.computeGrowth());
  }

  /**
   * Platform growth — the SaaS business, not the tenants' workforce. Answers
   * "are we adding customers, are they using what they bought, and what is it
   * costing us to store?".
   *
   * Everything is aggregated in SQL by month; nothing is loaded row-by-row.
   */
  private async computeGrowth(): Promise<AdminGrowth> {
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - 11);
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);

    const [orgRows, userRows, storageRows, subs, plans, totalOrgs, totalUsers, priorOrgs, priorUsers, priorStorage] = await Promise.all([
      this.prisma.$queryRaw<{ m: Date; n: bigint }[]>`
        SELECT date_trunc('month', "createdAt") AS m, count(*) AS n
        FROM "Organization" WHERE status <> 'DELETED' AND "createdAt" >= ${since} GROUP BY 1`,
      this.prisma.$queryRaw<{ m: Date; n: bigint }[]>`
        SELECT date_trunc('month', "createdAt") AS m, count(*) AS n
        FROM "User" WHERE "createdAt" >= ${since} GROUP BY 1`,
      this.prisma.$queryRaw<{ m: Date; b: bigint }[]>`
        SELECT date_trunc('month', "createdAt") AS m, COALESCE(sum("sizeBytes"), 0)::bigint AS b
        FROM "ScreenshotObject" WHERE "createdAt" >= ${since} GROUP BY 1`,
      this.billing.subscription.groupBy({ by: ["planId"], _sum: { seats: true, activeSeats: true }, _count: { _all: true } }),
      this.billing.plan.findMany({ select: { id: true, name: true, sortOrder: true }, orderBy: { sortOrder: "asc" } }),
      this.prisma.organization.count({ where: { status: { not: "DELETED" } } }),
      this.prisma.user.count(),
      // Counts BEFORE the window, so the first month's running total starts correctly.
      this.prisma.organization.count({ where: { status: { not: "DELETED" }, createdAt: { lt: since } } }),
      this.prisma.user.count({ where: { createdAt: { lt: since } } }),
      this.prisma.screenshotObject.aggregate({ where: { createdAt: { lt: since } }, _sum: { sizeBytes: true } }),
    ]);

    const key = (d: Date) => d.toISOString().slice(0, 7);
    const orgsBy = new Map(orgRows.map((r) => [key(r.m), Number(r.n)]));
    const usersBy = new Map(userRows.map((r) => [key(r.m), Number(r.n)]));
    const storageBy = new Map(storageRows.map((r) => [key(r.m), Number(r.b)]));

    let runOrgs = priorOrgs;
    let runUsers = priorUsers;
    let runBytes = priorStorage._sum.sizeBytes ? Number(priorStorage._sum.sizeBytes) : 0;
    const growth: AdminGrowthPoint[] = [];
    const storage: AdminStoragePoint[] = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() - i);
      const k = key(d);
      const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
      const newOrgs = orgsBy.get(k) ?? 0;
      const newUsers = usersBy.get(k) ?? 0;
      const addedBytes = storageBy.get(k) ?? 0;
      runOrgs += newOrgs;
      runUsers += newUsers;
      runBytes += addedBytes;
      growth.push({ month: label, orgs: newOrgs, users: newUsers, totalOrgs: runOrgs, totalUsers: runUsers });
      storage.push({ month: label, addedBytes, totalBytes: runBytes });
    }

    const planName = new Map(plans.map((p) => [p.id, p.name]));
    const seats: AdminSeatPoint[] = subs
      .map((s) => ({
        planName: planName.get(s.planId) ?? s.planId,
        seatsSold: s._sum.seats ?? 0,
        seatsUsed: s._sum.activeSeats ?? 0,
        orgs: s._count._all,
      }))
      .sort((a, b) => b.seatsSold - a.seatsSold);

    const last = growth.at(-1);
    const prev = growth.at(-2);
    const orgGrowthPct = prev && prev.orgs > 0 ? Math.round((((last?.orgs ?? 0) - prev.orgs) / prev.orgs) * 100) : null;

    // Biggest tenants by real usage — the one thing worth keeping from the old page.
    const topOrgList = await this.computeOrganizations({ page: 1, pageSize: 8 });
    const topOrgs = topOrgList.items
      .map((o) => ({ id: o.id, name: o.name, users: o.users, activeUsers: o.activeUsers, seats: o.seats }))
      .sort((a, b) => b.activeUsers - a.activeUsers || b.users - a.users);

    return {
      totals: {
        orgs: totalOrgs,
        users: totalUsers,
        newOrgsThisMonth: last?.orgs ?? 0,
        newUsersThisMonth: last?.users ?? 0,
        orgGrowthPct,
        seatsSold: seats.reduce((s, p) => s + p.seatsSold, 0),
        seatsUsed: seats.reduce((s, p) => s + p.seatsUsed, 0),
        storageBytes: runBytes,
      },
      growth,
      storage,
      seats,
      topOrgs,
    };
  }

  usageAnalytics(): Promise<AdminUsageAnalytics> {
    return this.cached("usage-analytics", () => this.computeUsageAnalytics());
  }

  /**
   * Product usage: DAU/WAU/MAU + daily active users + feature adoption.
   *
   * Sessions are the source, but a Session row is NOT a login. The desktop agent
   * mints one every 15 minutes when its access token expires, and (since the
   * silent-refresh fix) so does the web middleware. Counting rows produced "59
   * logins from 3 users" — a number nobody could act on.
   *
   * So: count only sessions from a real browser (a Mozilla-style user-agent, as
   * every browser sends), and report DISTINCT USERS per day rather than rows.
   * Machine sessions still count toward DAU/WAU/MAU — an agent running means that
   * tenant is genuinely using the product.
   */
  private async computeUsageAnalytics(): Promise<AdminUsageAnalytics> {
    const now = Date.now();
    const startToday = startOfUtcDay();
    const since30 = new Date(now - 30 * DAY_MS);

    // Active users = distinct users with a session touched within the window.
    const distinctActive = async (sinceMs: number): Promise<number> => {
      const rows = await this.prisma.session.findMany({ where: { lastUsedAt: { gte: new Date(now - sinceMs) } }, distinct: ["userId"], select: { userId: true } });
      return rows.length;
    };

    // Browsers all send "Mozilla/5.0 (…)"; the agent sends "node", our own
    // middleware "Next.js Middleware". Matching the browser is more robust than
    // blacklisting every machine client we might add later.
    const HUMAN_UA = "Mozilla/%";
    // The desktop agent runs on Node and identifies itself as "node".
    const AGENT_UA = "node%";

    // A browser mints a Session every ~15 min on silent refresh, so counting rows
    // over-reports "logins". Count DISTINCT users per day instead — one human = one
    // sign-in for the day — consistent with the `users` series below.
    const distinctSignInsSince = async (since: Date): Promise<number> => {
      const rows = await this.prisma.session.findMany({ where: { createdAt: { gte: since }, userAgent: { startsWith: "Mozilla/" } }, distinct: ["userId"], select: { userId: true } });
      return rows.length;
    };

    const [dau, wau, mau, signInsToday, trendRows, agentTrendRows, featureUsage] = await Promise.all([
      distinctActive(DAY_MS),
      distinctActive(7 * DAY_MS),
      distinctActive(30 * DAY_MS),
      distinctSignInsSince(startToday),
      this.prisma.$queryRaw<{ d: Date; logins: bigint; users: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS d, count(DISTINCT "userId") AS logins, count(DISTINCT "userId") AS users
        FROM "Session"
        WHERE "createdAt" >= ${since30} AND "userAgent" LIKE ${HUMAN_UA}
        GROUP BY 1 ORDER BY 1`,
      // Desktop agent, reported as DISTINCT USERS for the same reason as browsers:
      // it re-authenticates every ~15 minutes, so session rows are meaningless.
      // Matched explicitly (the agent sends "node") rather than "not a browser",
      // which would sweep in curl, our own middleware, and any future tooling.
      this.prisma.$queryRaw<{ d: Date; users: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS d, count(DISTINCT "userId") AS users
        FROM "Session"
        WHERE "createdAt" >= ${since30} AND "userAgent" LIKE ${AGENT_UA}
        GROUP BY 1 ORDER BY 1`,
      this.computeFeatureUsage(),
    ]);

    const byDay = new Map<string, { logins: number; users: number }>();
    for (const r of trendRows) byDay.set(r.d.toISOString().slice(0, 10), { logins: Number(r.logins), users: Number(r.users) });
    const agentByDay = new Map<string, number>();
    for (const r of agentTrendRows) agentByDay.set(r.d.toISOString().slice(0, 10), Number(r.users));

    const loginTrend: AdminLoginPoint[] = [];
    for (let i = 29; i >= 0; i -= 1) {
      const key = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
      const hit = byDay.get(key);
      loginTrend.push({
        date: key,
        logins: hit?.logins ?? 0,
        users: hit?.users ?? 0,
        agentUsers: agentByDay.get(key) ?? 0,
      });
    }

    return { dau, wau, mau, loginsToday: signInsToday, loginTrend, featureUsage };
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
      // How much of what they bought they actually use — a commercial signal.
      const seatUtil = seats > 0 ? (activeEmployees / seats) * 100 : 0;
      const seatUsage = clamp(Math.min(100, seatUtil));

      // Health deliberately EXCLUDES avgProductivity. That measures how hard the
      // customer's employees work — their metric, not a signal about the health
      // of our account with them. Blending it in also meant any org whose agent
      // isn't running (or whose scoring is broken) looked at-risk when it wasn't.
      // avgProductivity is still returned below, as its own column.
      const healthScore = clamp(0.4 * frequency + 0.35 * seatUsage + 0.25 * adoption);
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
        seatUsage,
        healthScore,
        band,
        featuresUsed,
        activeDays,
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

    // Only surface subscriptions whose org is still live in identity — a
    // soft-deleted org shouldn't appear in renewals/failed-payments queues.
    const orgIds = [...new Set([...upcomingSubs, ...failedSubs].map((s) => s.orgId))];
    const orgs = await this.prisma.organization.findMany({ where: { id: { in: orgIds }, status: { not: "DELETED" } }, select: { id: true, name: true } });
    const nameById = new Map(orgs.map((o) => [o.id, o.name]));
    const isLive = (orgId: string) => nameById.has(orgId);

    const upcoming: AdminSubLifecycleRow[] = upcomingSubs.filter((s) => isLive(s.orgId)).map((s) => ({
      orgId: s.orgId,
      orgName: nameById.get(s.orgId) ?? "Unknown",
      plan: s.plan.name,
      status: s.status,
      autoRenew: s.autoRenew,
      currentPeriodEnd: s.currentPeriodEnd.toISOString(),
      daysLeft: Math.ceil((s.currentPeriodEnd.getTime() - now.getTime()) / DAY_MS),
    }));

    const failed: AdminFailedPaymentRow[] = failedSubs.filter((s) => isLive(s.orgId)).map((s) => {
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
