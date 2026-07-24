import { Redis } from "ioredis";
import type { MessagingLogger } from "./types.js";

/** Per-user real-time channel for live notification fan-out. */
export function userNotificationChannel(userId: string): string {
  return `notifications:user:${userId}`;
}

export const USER_NOTIFICATION_PATTERN = "notifications:user:*";

/**
 * Per-org real-time channel. Carries events that concern a whole tenant rather
 * than one user — e.g. a feature flag flipped for the org. Every pod subscribes
 * the pattern and fans a message out to that org's live SSE connections.
 */
export function orgBroadcastChannel(orgId: string): string {
  return `realtime:org:${orgId}`;
}

export const ORG_BROADCAST_PATTERN = "realtime:org:*";

/**
 * Platform-wide channel. Carries events that affect every tenant at once — e.g.
 * a global feature kill switch. Every pod forwards it to all connected clients.
 */
export const PLATFORM_BROADCAST_CHANNEL = "realtime:broadcast";

/**
 * Ephemeral pub/sub bus for the real-time last hop (SSE/WebSocket fan-out).
 * This is intentionally separate from the durable Broker: the authoritative
 * copy already lives in Postgres, so live delivery is fire-and-forget. Redis
 * Pub/Sub fans a message to every API instance; the one holding the user's
 * connection forwards it. Use a pattern-subscriber per instance (not per client).
 */
export interface RealtimeBus {
  publish(channel: string, message: Record<string, unknown>): Promise<void>;
  /**
   * Subscribe one or more glob patterns on a single Redis connection. May be
   * called more than once; each call opens its own subscriber and all are closed
   * by close(). An exact channel name (no wildcard) is a valid pattern too.
   */
  subscribePattern(
    pattern: string | string[],
    handler: (channel: string, message: Record<string, unknown>) => void,
  ): Promise<void>;
  close(): Promise<void>;
}

export class RedisRealtimeBus implements RealtimeBus {
  private readonly pub: Redis;
  private readonly subs: Redis[] = [];

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
    pattern: string | string[],
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
    await sub.psubscribe(...(Array.isArray(pattern) ? pattern : [pattern]));
    this.subs.push(sub);
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.pub.quit(), ...this.subs.map((s) => s.quit())]);
  }
}
