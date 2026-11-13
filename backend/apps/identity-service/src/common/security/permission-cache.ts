import { Injectable } from "@nestjs/common";
import type { PermissionBundle } from "@retainiq/authz";

/**
 * Cache seam for resolved permission bundles. Async so a network-backed
 * implementation (Redis) can satisfy the same contract as the in-memory one.
 * Bundles are short-lived (TTL) and can be invalidated explicitly when a role
 * changes; the DB remains the source of truth.
 */
export abstract class PermissionCache {
  abstract get(key: string): Promise<PermissionBundle | undefined>;
  abstract set(key: string, bundle: PermissionBundle): Promise<void>;
  abstract invalidate(key: string): Promise<void>;
}

type Entry = { bundle: PermissionBundle; expiresAt: number };

/** Correct for a single instance. Use the Redis cache for multi-instance deployments. */
@Injectable()
export class InMemoryPermissionCache extends PermissionCache {
  private readonly store = new Map<string, Entry>();
  private readonly ttlMs = 60_000;

  get(key: string): Promise<PermissionBundle | undefined> {
    const entry = this.store.get(key);
    if (!entry) {
      return Promise.resolve(undefined);
    }
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(entry.bundle);
  }

  set(key: string, bundle: PermissionBundle): Promise<void> {
    this.store.set(key, { bundle, expiresAt: Date.now() + this.ttlMs });
    return Promise.resolve();
  }

  invalidate(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }
}
