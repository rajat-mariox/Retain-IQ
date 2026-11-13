import { Injectable, type MessageEvent } from "@nestjs/common";
import type { Subject } from "rxjs";

/**
 * In-memory registry of live SSE connections. One instance per identity-service
 * process; the RealtimeService feeds it from single Redis pattern subscribers,
 * so we hold one broker subscription per pod regardless of how many clients are
 * connected.
 *
 * Connections are indexed two ways off the same Subject:
 *   - by userId, for per-user fan-out (a notification for one person), and
 *   - by orgId,  for tenant-wide fan-out (a feature flag flipped for the org).
 * A connection registers its org once; publishToOrg then reaches every live tab
 * in that tenant, and publishToAll reaches everyone (a global kill switch).
 */
@Injectable()
export class SseHub {
  private readonly byUser = new Map<string, Set<Subject<MessageEvent>>>();
  private readonly byOrg = new Map<string, Set<Subject<MessageEvent>>>();

  private static add(index: Map<string, Set<Subject<MessageEvent>>>, key: string, channel: Subject<MessageEvent>): void {
    let set = index.get(key);
    if (!set) {
      set = new Set();
      index.set(key, set);
    }
    set.add(channel);
  }

  private static remove(index: Map<string, Set<Subject<MessageEvent>>>, key: string, channel: Subject<MessageEvent>): void {
    const set = index.get(key);
    if (!set) return;
    set.delete(channel);
    if (set.size === 0) index.delete(key);
  }

  /** Register a connection for both per-user and per-org fan-out. */
  register(userId: string, orgId: string | null, channel: Subject<MessageEvent>): void {
    SseHub.add(this.byUser, userId, channel);
    if (orgId) SseHub.add(this.byOrg, orgId, channel);
  }

  unregister(userId: string, orgId: string | null, channel: Subject<MessageEvent>): void {
    SseHub.remove(this.byUser, userId, channel);
    if (orgId) SseHub.remove(this.byOrg, orgId, channel);
  }

  /** Pushes a payload to all of a user's live connections (no-op if none). */
  publishToUser(userId: string, data: Record<string, unknown>): void {
    const set = this.byUser.get(userId);
    if (!set) return;
    for (const channel of set) channel.next({ data });
  }

  /** Pushes a payload to every live connection in an org (no-op if none). */
  publishToOrg(orgId: string, data: Record<string, unknown>): void {
    const set = this.byOrg.get(orgId);
    if (!set) return;
    for (const channel of set) channel.next({ data });
  }

  /** Pushes a payload to every live connection on this pod (platform-wide). */
  publishToAll(data: Record<string, unknown>): void {
    for (const set of this.byUser.values()) {
      for (const channel of set) channel.next({ data });
    }
  }
}
