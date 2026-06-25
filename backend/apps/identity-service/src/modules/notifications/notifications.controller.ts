import { Controller, Get, Query, Sse, UseGuards, type MessageEvent } from "@nestjs/common";
import { offsetPaginationQuerySchema, type OffsetPaginationQuery } from "@retainiq/contracts";
import { Observable, Subject } from "rxjs";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { NotificationsReadPrismaService } from "../../common/database/notifications-prisma.service.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { SseHub } from "../../common/realtime/sse-hub.js";

const PING_INTERVAL_MS = 25_000;

@Controller("notifications")
@UseGuards(AuthGuard, TenantGuard)
export class NotificationsController {
  constructor(
    private readonly prisma: NotificationsReadPrismaService,
    private readonly hub: SseHub,
  ) {}

  /** The caller's in-app inbox (paginated history; live updates arrive via SSE). */
  @Get()
  async listInbox(@Query(new ZodValidationPipe(offsetPaginationQuerySchema)) query: OffsetPaginationQuery) {
    const ctx = requireTenantContext();
    const where = { orgId: ctx.orgId, recipientUserId: ctx.userId, channel: "IN_APP" as const };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { id: true, type: true, title: true, body: true, status: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
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
