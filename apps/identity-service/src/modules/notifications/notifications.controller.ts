import { Controller, Get, Sse, UseGuards, type MessageEvent } from "@nestjs/common";
import { Observable, Subject } from "rxjs";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { NotificationsReadPrismaService } from "../../common/database/notifications-prisma.service.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { SseHub } from "../../common/realtime/sse-hub.js";

const PING_INTERVAL_MS = 25_000;

@Controller("notifications")
@UseGuards(AuthGuard, TenantGuard)
export class NotificationsController {
  constructor(
    private readonly prisma: NotificationsReadPrismaService,
    private readonly hub: SseHub,
  ) {}

  /** The caller's recent in-app inbox (load history, then stream live updates). */
  @Get()
  listInbox() {
    const ctx = requireTenantContext();
    return this.prisma.notification.findMany({
      where: { orgId: ctx.orgId, recipientUserId: ctx.userId, channel: "IN_APP" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, title: true, body: true, status: true, readAt: true, createdAt: true },
    });
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
