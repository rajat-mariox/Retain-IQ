import { Module } from "@nestjs/common";
import { NotificationsReadPrismaService } from "../../common/database/notifications-prisma.service.js";
import { NotificationRealtimeService } from "../../common/realtime/notification-realtime.service.js";
import { SseHub } from "../../common/realtime/sse-hub.js";
import { NotificationsController } from "./notifications.controller.js";

@Module({
  controllers: [NotificationsController],
  providers: [SseHub, NotificationRealtimeService, NotificationsReadPrismaService],
})
export class NotificationsModule {}
