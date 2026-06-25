import { Injectable, type MessageEvent } from "@nestjs/common";
import type { Subject } from "rxjs";

/**
 * In-memory registry of live SSE connections, keyed by userId. One instance per
 * identity-service process; the RealtimeService feeds it from a single Redis pattern
 * subscriber, so we hold one broker subscription per pod regardless of how many
 * clients are connected.
 */
@Injectable()
export class SseHub {
  private readonly clients = new Map<string, Set<Subject<MessageEvent>>>();

  register(userId: string, channel: Subject<MessageEvent>): void {
    let set = this.clients.get(userId);
    if (!set) {
      set = new Set();
      this.clients.set(userId, set);
    }
    set.add(channel);
  }

  unregister(userId: string, channel: Subject<MessageEvent>): void {
    const set = this.clients.get(userId);
    if (!set) return;
    set.delete(channel);
    if (set.size === 0) {
      this.clients.delete(userId);
    }
  }

  /** Pushes a payload to all of a user's live connections (no-op if none). */
  publishToUser(userId: string, data: Record<string, unknown>): void {
    const set = this.clients.get(userId);
    if (!set) return;
    for (const channel of set) {
      channel.next({ data });
    }
  }
}
