import { Redis } from "ioredis";
import type { MessagingLogger } from "./types.js";

/** Per-user real-time channel for live notification fan-out. */
export function userNotificationChannel(userId: string): string {
  return `notifications:user:${userId}`;
}

export const USER_NOTIFICATION_PATTERN = "notifications:user:*";

/**
 * Ephemeral pub/sub bus for the real-time last hop (SSE/WebSocket fan-out).
 * This is intentionally separate from the durable Broker: the authoritative
 * copy already lives in Postgres, so live delivery is fire-and-forget. Redis
 * Pub/Sub fans a message to every API instance; the one holding the user's
 * connection forwards it. Use a pattern-subscriber per instance (not per client).
 */
export interface RealtimeBus {
  publish(channel: string, message: Record<string, unknown>): Promise<void>;
  subscribePattern(
    pattern: string,
    handler: (channel: string, message: Record<string, unknown>) => void,
  ): Promise<void>;
  close(): Promise<void>;
}

export class RedisRealtimeBus implements RealtimeBus {
  private readonly pub: Redis;
  private sub?: Redis;

  constructor(
    private readonly url: string,
    private readonly logger?: MessagingLogger,
  ) {
    this.pub = new Redis(url, { maxRetriesPerRequest: null });
    this.pub.on("error", (error: Error) => this.logger?.error({ err: error.message }, "realtime pub error"));
  }

  async publish(channel: string, message: Record<string, unknown>): Promise<void> {
    await this.pub.publish(channel, JSON.stringify(message));
  }

  async subscribePattern(
    pattern: string,
    handler: (channel: string, message: Record<string, unknown>) => void,
  ): Promise<void> {
    const sub = new Redis(this.url, { maxRetriesPerRequest: null });
    sub.on("error", (error: Error) => this.logger?.error({ err: error.message }, "realtime sub error"));
    sub.on("pmessage", (_pattern: string, channel: string, payload: string) => {
      try {
        handler(channel, JSON.parse(payload) as Record<string, unknown>);
      } catch {
        // Ignore malformed payloads — realtime is best-effort.
      }
    });
    await sub.psubscribe(pattern);
    this.sub = sub;
  }

  async close(): Promise<void> {
    const closing = [this.pub.quit()];
    if (this.sub) {
      closing.push(this.sub.quit());
    }
    await Promise.allSettled(closing);
  }
}
