import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { loadConfig } from "@retainiq/config";
import { RedisRealtimeBus, userNotificationChannel, type RealtimeBus } from "@retainiq/messaging";
import { logger } from "../observability/observability.js";

const config = loadConfig();

/**
 * Publishes live events to a user's realtime channel.
 *
 * Goes through the Redis bus rather than the in-process SseHub so a message
 * reaches that user's connections on *every* pod — the desktop agent and a
 * browser tab are usually served by different instances. NotificationRealtimeService
 * is the subscriber that fans these back out to SSE clients.
 */
@Injectable()
export class RealtimePublisher implements OnApplicationShutdown {
  private readonly bus: RealtimeBus = new RedisRealtimeBus(config.REDIS_URL, logger);

  async publishToUser(userId: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.bus.publish(userNotificationChannel(userId), payload);
    } catch (error) {
      // Live delivery is a nudge on top of persisted state — never fatal.
      logger.warn({ userId, err: String(error) }, "realtime publish failed");
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.bus.close();
  }
}
