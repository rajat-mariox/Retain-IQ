import { Module } from "@nestjs/common";
import { NotificationRealtimeService } from "../../common/realtime/notification-realtime.service.js";
import { SseHub } from "../../common/realtime/sse-hub.js";
import { NotificationsController } from "./notifications.controller.js";

// NotificationsReadPrismaService is a global singleton (DatabaseModule).
@Module({
  controllers: [NotificationsController],
  providers: [SseHub, NotificationRealtimeService],
})
export class NotificationsModule {}
