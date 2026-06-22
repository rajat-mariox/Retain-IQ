import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { loadConfig } from "@retainiq/config";
import { RedisRealtimeBus, USER_NOTIFICATION_PATTERN, type RealtimeBus } from "@retainiq/messaging";
import { logger } from "../observability/observability.js";
import { SseHub } from "./sse-hub.js";

const config = loadConfig();

/**
 * Subscribes (once per process) to the per-user notification channels on the
 * realtime bus and routes each message to the matching live SSE connections.
 */
@Injectable()
export class NotificationRealtimeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly bus: RealtimeBus = new RedisRealtimeBus(config.REDIS_URL, logger);

  constructor(private readonly hub: SseHub) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.bus.subscribePattern(USER_NOTIFICATION_PATTERN, (channel, message) => {
      const userId = channel.slice(channel.lastIndexOf(":") + 1);
      if (userId) {
        this.hub.publishToUser(userId, message);
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.bus.close();
  }
}
