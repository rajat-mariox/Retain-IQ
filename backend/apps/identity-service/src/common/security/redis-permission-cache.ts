import type { PermissionBundle } from "@retainiq/authz";
import type { Redis } from "ioredis";
import { PermissionCache } from "./permission-cache.js";

const KEY_PREFIX = "perm:";

/**
 * Redis-backed permission bundle cache for multi-instance deployments.
 * Fails open: any Redis error degrades to a cache miss so authorization falls
 * back to the database rather than failing the request.
 */
export class RedisPermissionCache extends PermissionCache {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds = 60,
  ) {
    super();
  }

  async get(key: string): Promise<PermissionBundle | undefined> {
    try {
      const raw = await this.redis.get(KEY_PREFIX + key);
      return raw ? (JSON.parse(raw) as PermissionBundle) : undefined;
    } catch {
      return undefined;
    }
  }

  async set(key: string, bundle: PermissionBundle): Promise<void> {
    try {
      await this.redis.set(KEY_PREFIX + key, JSON.stringify(bundle), "EX", this.ttlSeconds);
    } catch {
      // Non-fatal: a missing cache entry just means a DB read next time.
    }
  }

  async invalidate(key: string): Promise<void> {
    try {
      await this.redis.del(KEY_PREFIX + key);
    } catch {
      // Non-fatal.
    }
  }
}
