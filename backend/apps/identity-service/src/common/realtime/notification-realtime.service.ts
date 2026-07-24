import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { loadConfig } from "@retainiq/config";
import {
  ORG_BROADCAST_PATTERN,
  PLATFORM_BROADCAST_CHANNEL,
  RedisRealtimeBus,
  USER_NOTIFICATION_PATTERN,
  type RealtimeBus,
} from "@retainiq/messaging";
import { logger } from "../observability/observability.js";
import { SseHub } from "./sse-hub.js";

const config = loadConfig();

/**
 * Subscribes (once per process) to the realtime bus and routes each message to
 * the matching live SSE connections. One subscriber covers three fan-out scopes,
 * routed by the channel's prefix:
 *   - notifications:user:<id> → that user's connections
 *   - realtime:org:<id>       → every connection in a tenant
 *   - realtime:broadcast      → every connection on this pod (platform-wide)
 */
@Injectable()
export class NotificationRealtimeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly bus: RealtimeBus = new RedisRealtimeBus(config.REDIS_URL, logger);

  constructor(private readonly hub: SseHub) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.bus.subscribePattern(
      [USER_NOTIFICATION_PATTERN, ORG_BROADCAST_PATTERN, PLATFORM_BROADCAST_CHANNEL],
      (channel, message) => this.route(channel, message),
    );
  }

  private route(channel: string, message: Record<string, unknown>): void {
    if (channel === PLATFORM_BROADCAST_CHANNEL) {
      this.hub.publishToAll(message);
      return;
    }
    const id = channel.slice(channel.lastIndexOf(":") + 1);
    if (!id) return;
    if (channel.startsWith("realtime:org:")) this.hub.publishToOrg(id, message);
    else this.hub.publishToUser(id, message); // notifications:user:<id>
  }

  async onApplicationShutdown(): Promise<void> {
    await this.bus.close();
  }
}
