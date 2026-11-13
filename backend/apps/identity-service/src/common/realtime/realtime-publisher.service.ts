import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { loadConfig } from "@retainiq/config";
import {
  orgBroadcastChannel,
  PLATFORM_BROADCAST_CHANNEL,
  RedisRealtimeBus,
  userNotificationChannel,
  type RealtimeBus,
} from "@retainiq/messaging";
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

  /** Fan a payload out to every live connection in one tenant. */
  async publishToOrg(orgId: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.bus.publish(orgBroadcastChannel(orgId), payload);
    } catch (error) {
      logger.warn({ orgId, err: String(error) }, "realtime org publish failed");
    }
  }

  /** Fan a payload out to every live connection on the platform. */
  async publishToAll(payload: Record<string, unknown>): Promise<void> {
    try {
      await this.bus.publish(PLATFORM_BROADCAST_CHANNEL, payload);
    } catch (error) {
      logger.warn({ err: String(error) }, "realtime broadcast publish failed");
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.bus.close();
  }
}
