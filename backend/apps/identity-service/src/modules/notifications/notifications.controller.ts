import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Sse, UseGuards, type MessageEvent } from "@nestjs/common";
import { offsetPaginationQuerySchema } from "@retainiq/contracts";
import { permissions } from "@retainiq/authz";
import { Observable, Subject } from "rxjs";
import { z } from "zod";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { NotificationsReadPrismaService } from "../../common/database/notifications-prisma.service.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { SseHub } from "../../common/realtime/sse-hub.js";
import { PlatformSettingsService } from "../../common/settings/platform-settings.service.js";

const PING_INTERVAL_MS = 25_000;

interface InboxItem {
  id: string;
  type: string;
  title: string;
  body: string;
  category: string;
  priority: string;
  link: string | null;
  status: string;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}

const CATEGORIES = ["ATTENDANCE", "PRODUCTIVITY", "PROJECT", "AI", "SYSTEM"] as const;
const inboxQuerySchema = offsetPaginationQuerySchema.extend({
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(),
  unread: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
  q: z.string().max(120).optional(),
});
const pushSubSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
  userAgent: z.string().max(300).optional(),
});
const prefsSchema = z.object({
  preferences: z
    .array(z.object({ category: z.enum(CATEGORIES), inApp: z.boolean(), email: z.boolean(), push: z.boolean() }))
    .max(10)
    .optional(),
  settings: z
    .object({
      quietHoursEnabled: z.boolean(),
      quietStart: z.coerce.number().int().min(0).max(23),
      quietEnd: z.coerce.number().int().min(0).max(23),
      timezone: z.string().max(64),
      digest: z.enum(["OFF", "DAILY", "WEEKLY"]),
      digestHour: z.coerce.number().int().min(0).max(23),
    })
    .partial()
    .optional(),
});

@Controller("notifications")
@UseGuards(AuthGuard, TenantGuard)
export class NotificationsController {
  constructor(
    private readonly prisma: NotificationsReadPrismaService,
    private readonly hub: SseHub,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** The caller's in-app inbox (paginated history; live updates arrive via SSE). */
  @Get()
  async listInbox(@Query(new ZodValidationPipe(inboxQuerySchema)) query: z.infer<typeof inboxQuerySchema>) {
    const ctx = requireTenantContext();
    const where: Record<string, unknown> = {
      orgId: ctx.orgId,
      recipientUserId: ctx.userId,
      channel: "IN_APP" as const,
      // Archived items are hidden unless explicitly requested.
      archivedAt: query.archived ? { not: null } : null,
    };
    if (query.category) where.category = query.category;
    if (query.priority) where.priority = query.priority;
    if (query.unread) where.readAt = null;
    if (query.q?.trim()) {
      where.OR = [
        { title: { contains: query.q.trim(), mode: "insensitive" } },
        { body: { contains: query.q.trim(), mode: "insensitive" } },
      ];
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { id: true, type: true, title: true, body: true, category: true, priority: true, link: true, status: true, readAt: true, archivedAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where }),
    ]);
    const items: InboxItem[] = rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      category: n.category,
      priority: n.priority,
      link: n.link,
      status: n.status,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      archivedAt: n.archivedAt ? n.archivedAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    }));

    // Global notification, "quiet" delivery: when the platform banner is OFF but a
    // message is set, surface it in every member's inbox (pinned to the top of
    // page 1) so they see it later. When the banner is ON it shows there instead.
    const { notification } = await this.settings.getSettingsCached();
    if (!notification.enabled && notification.message.trim()) {
      const stamp = (await this.settings.notificationStamp()) ?? new Date();
      const announcement: InboxItem = {
        id: "platform-announcement",
        type: "platform.announcement",
        title: notification.level === "critical" ? "Important announcement" : "Platform announcement",
        body: notification.message,
        category: "SYSTEM",
        priority: notification.level === "critical" ? "CRITICAL" : "NORMAL",
        link: null,
        status: "SENT",
        readAt: null,
        archivedAt: null,
        createdAt: stamp.toISOString(),
      };
      return {
        items: query.page === 1 ? [announcement, ...items] : items,
        total: total + 1,
        page: query.page,
        pageSize: query.pageSize,
      };
    }

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** Count of the caller's unread in-app notifications (for the bell badge). */
  @Get("unread-count")
  async unreadCount() {
    const ctx = requireTenantContext();
    const count = await this.prisma.notification.count({
      where: { orgId: ctx.orgId, recipientUserId: ctx.userId, channel: "IN_APP", readAt: null },
    });
    return { count };
  }

  /**
   * Mark all of the caller's unread in-app notifications as read.
   * Read-receipts are the caller's own state, so identity (the inbox's read/API
   * layer) owns this small write to the notifications DB.
   */
  @Post("read-all")
  async readAll() {
    const ctx = requireTenantContext();
    const res = await this.prisma.notification.updateMany({
      where: { orgId: ctx.orgId, recipientUserId: ctx.userId, channel: "IN_APP", readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }

  /** Dashboard counters: totals, unread, critical and a per-category breakdown. */
  @Get("stats")
  async stats() {
    const ctx = requireTenantContext();
    const base = { orgId: ctx.orgId, recipientUserId: ctx.userId, channel: "IN_APP" as const };
    const [total, unread, critical, archived, byCategory] = await Promise.all([
      this.prisma.notification.count({ where: { ...base, archivedAt: null } }),
      this.prisma.notification.count({ where: { ...base, archivedAt: null, readAt: null } }),
      this.prisma.notification.count({ where: { ...base, archivedAt: null, priority: "CRITICAL" } }),
      this.prisma.notification.count({ where: { ...base, archivedAt: { not: null } } }),
      this.prisma.notification.groupBy({
        by: ["category"],
        where: { ...base, archivedAt: null },
        _count: { _all: true },
      }),
    ]);
    const categories = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<string, number>;
    for (const row of byCategory) categories[row.category] = row._count._all;
    return { total, unread, critical, archived, categories };
  }

  /** Archive (dismiss) a notification — hidden from the inbox but kept for history. */
  @Post(":id/archive")
  async archive(@Param("id", ParseUUIDPipe) id: string) {
    const ctx = requireTenantContext();
    const res = await this.prisma.notification.updateMany({
      where: { id, orgId: ctx.orgId, recipientUserId: ctx.userId, channel: "IN_APP" },
      // Archiving also marks it read: a dismissed item shouldn't keep the badge lit.
      data: { archivedAt: new Date(), readAt: new Date() },
    });
    return { updated: res.count };
  }

  @Post(":id/unarchive")
  async unarchive(@Param("id", ParseUUIDPipe) id: string) {
    const ctx = requireTenantContext();
    const res = await this.prisma.notification.updateMany({
      where: { id, orgId: ctx.orgId, recipientUserId: ctx.userId, channel: "IN_APP" },
      data: { archivedAt: null },
    });
    return { updated: res.count };
  }

  /** Archive every read notification in one go. */
  @Post("archive-read")
  async archiveRead() {
    const ctx = requireTenantContext();
    const res = await this.prisma.notification.updateMany({
      where: { orgId: ctx.orgId, recipientUserId: ctx.userId, channel: "IN_APP", archivedAt: null, readAt: { not: null } },
      data: { archivedAt: new Date() },
    });
    return { updated: res.count };
  }

  /** The caller's per-category channel preferences + global delivery settings. */
  @Get("preferences")
  async getPreferences() {
    const ctx = requireTenantContext();
    const [prefs, setting] = await Promise.all([
      this.prisma.notificationPreference.findMany({ where: { orgId: ctx.orgId, userId: ctx.userId } }),
      this.prisma.notificationSetting.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } } }),
    ]);
    const byCategory = new Map(prefs.map((p) => [p.category, p]));
    return {
      // Defaults mirror the worker's DEFAULTS so the UI shows what will actually happen.
      preferences: CATEGORIES.map((category) => {
        const row = byCategory.get(category);
        const fallback = category === "ATTENDANCE" || category === "SYSTEM";
        return {
          category,
          inApp: row?.inApp ?? true,
          email: row?.email ?? fallback,
          push: row?.push ?? false,
        };
      }),
      settings: {
        quietHoursEnabled: setting?.quietHoursEnabled ?? false,
        quietStart: setting?.quietStart ?? 22,
        quietEnd: setting?.quietEnd ?? 8,
        timezone: setting?.timezone ?? "UTC",
        digest: setting?.digest ?? "OFF",
        digestHour: setting?.digestHour ?? 9,
      },
    };
  }

  /** Upsert the caller's preferences and/or global delivery settings. */
  @Post("preferences")
  async savePreferences(@Body(new ZodValidationPipe(prefsSchema)) body: z.infer<typeof prefsSchema>) {
    const ctx = requireTenantContext();
    for (const p of body.preferences ?? []) {
      await this.prisma.notificationPreference.upsert({
        where: { orgId_userId_category: { orgId: ctx.orgId, userId: ctx.userId, category: p.category } },
        create: { orgId: ctx.orgId, userId: ctx.userId, category: p.category, inApp: p.inApp, email: p.email, push: p.push },
        update: { inApp: p.inApp, email: p.email, push: p.push },
      });
    }
    if (body.settings && Object.keys(body.settings).length > 0) {
      await this.prisma.notificationSetting.upsert({
        where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } },
        create: { orgId: ctx.orgId, userId: ctx.userId, ...body.settings },
        update: body.settings,
      });
    }
    return { ok: true };
  }

  /**
   * §9/§10 workspace feed: notifications across the whole org, not just the
   * caller's own inbox. Gated on employee.read (Owner / Manager / HR), so an
   * ordinary employee can never read their colleagues' alerts.
   */
  @Get("org-feed")
  @UseGuards(PermissionGuard)
  @RequirePermissions(permissions.employeeRead)
  async orgFeed(@Query(new ZodValidationPipe(inboxQuerySchema)) query: z.infer<typeof inboxQuerySchema>) {
    const ctx = requireTenantContext();
    const where: Record<string, unknown> = { orgId: ctx.orgId, channel: "IN_APP" as const };
    if (query.category) where.category = query.category;
    if (query.priority) where.priority = query.priority;
    if (query.q?.trim()) {
      where.OR = [
        { title: { contains: query.q.trim(), mode: "insensitive" } },
        { body: { contains: query.q.trim(), mode: "insensitive" } },
      ];
    }

    const [rows, total, byCategory, byPriority] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { id: true, type: true, title: true, body: true, category: true, priority: true, link: true, status: true, readAt: true, recipientUserId: true, createdAt: true },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.groupBy({ by: ["category"], where: { orgId: ctx.orgId, channel: "IN_APP" }, _count: { _all: true } }),
      this.prisma.notification.groupBy({ by: ["priority"], where: { orgId: ctx.orgId, channel: "IN_APP" }, _count: { _all: true } }),
    ]);

    // Resolve recipient names from the local projection so the feed reads as
    // "who was alerted", not a list of UUIDs.
    const userIds = [...new Set(rows.map((r) => r.recipientUserId))];
    const recipients = await this.prisma.orgRecipient.findMany({
      where: { orgId: ctx.orgId, userId: { in: userIds } },
      select: { userId: true, name: true, email: true, roleName: true },
    });
    const byUser = new Map(recipients.map((r) => [r.userId, r]));

    return {
      items: rows.map((n) => {
        const rec = byUser.get(n.recipientUserId);
        return {
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          category: n.category,
          priority: n.priority,
          link: n.link,
          status: n.status,
          read: n.readAt !== null,
          recipientName: rec?.name ?? rec?.email ?? "—",
          recipientRole: rec?.roleName ?? "—",
          createdAt: n.createdAt.toISOString(),
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
      summary: {
        categories: Object.fromEntries(byCategory.map((c) => [c.category, c._count._all])),
        priorities: Object.fromEntries(byPriority.map((p) => [p.priority, p._count._all])),
      },
    };
  }

  /**
   * VAPID public key for the browser's Push subscription. Public by design —
   * the private key never leaves the notifications service.
   */
  @Get("push/public-key")
  pushPublicKey() {
    return { publicKey: process.env.VAPID_PUBLIC_KEY ?? "" };
  }

  /** Register (or refresh) a browser push subscription for the caller. */
  @Post("push/subscribe")
  async pushSubscribe(@Body(new ZodValidationPipe(pushSubSchema)) body: z.infer<typeof pushSubSchema>) {
    const ctx = requireTenantContext();
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: { orgId: ctx.orgId, userId: ctx.userId, endpoint: body.endpoint, p256dh: body.p256dh, auth: body.auth, userAgent: body.userAgent ?? null },
      update: { orgId: ctx.orgId, userId: ctx.userId, p256dh: body.p256dh, auth: body.auth, lastUsedAt: new Date() },
    });
    return { ok: true };
  }

  /** Drop a browser push subscription (user disabled push on that device). */
  @Post("push/unsubscribe")
  async pushUnsubscribe(@Body(new ZodValidationPipe(z.object({ endpoint: z.string().min(1) }))) body: { endpoint: string }) {
    const ctx = requireTenantContext();
    const res = await this.prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, orgId: ctx.orgId, userId: ctx.userId } });
    return { removed: res.count };
  }

  /** Mark a single notification as read (scoped to the caller). */
  @Post(":id/read")
  async markRead(@Param("id", ParseUUIDPipe) id: string) {
    const ctx = requireTenantContext();
    const res = await this.prisma.notification.updateMany({
      where: { id, orgId: ctx.orgId, recipientUserId: ctx.userId, channel: "IN_APP", readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }

  /**
   * Live notification stream (Server-Sent Events). The connection registers
   * with the SseHub for the authenticated user; the RealtimeService pushes
   * notifications as the  emits them. A periodic ping keeps
   * the connection alive through idle proxies.
   */
  @Sse("stream")
  stream(): Observable<MessageEvent> {
    const ctx = requireTenantContext();
    const userId = ctx.userId;

    return new Observable<MessageEvent>((subscriber) => {
      const channel = new Subject<MessageEvent>();
      const subscription = channel.subscribe(subscriber);
      this.hub.register(userId, channel);

      subscriber.next({ data: { type: "connected" } });
      const ping = setInterval(() => subscriber.next({ data: { type: "ping" } }), PING_INTERVAL_MS);

      return () => {
        clearInterval(ping);
        subscription.unsubscribe();
        this.hub.unregister(userId, channel);
      };
    });
  }
}
