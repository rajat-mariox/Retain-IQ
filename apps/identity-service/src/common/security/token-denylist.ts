import type { Redis } from "ioredis";

const JTI_PREFIX = "deny:jti:";
const USER_PREFIX = "deny:user:";

/**
 * Redis-backed denylist that lets logout revoke still-valid access JWTs before
 * they expire. Two mechanisms:
 *
 *  - per-token (`deny:jti:<jti>`): set on single-session logout.
 *  - per-user cutoff (`deny:user:<userId>` = an epoch in seconds): set on
 *    logout-everywhere. Any access token issued (`iat`) before the cutoff is
 *    rejected, which catches every outstanding token in one key.
 *
 * Both keys carry a TTL equal to the access-token lifetime, so they self-expire
 * once no token they could match is still valid — the denylist never grows
 * unbounded.
 *
 * **Fails open**, mirroring {@link RedisPermissionCache}: if Redis is
 * unreachable, an authenticated request proceeds rather than 401-ing the whole
 * service. The trade-off is that a logged-out token may survive a Redis outage
 * until its short TTL elapses.
 */
export class TokenDenylist {
  constructor(
    private readonly redis: Redis,
    private readonly accessTtlSeconds: number,
  ) {}

  /** Revoke a single access token by its jti for the remainder of its life. */
  async denyJti(jti: string): Promise<void> {
    try {
      await this.redis.set(JTI_PREFIX + jti, "1", "EX", this.accessTtlSeconds);
    } catch {
      // Non-fatal: revocation is best-effort under a Redis outage.
    }
  }

  /** Revoke every access token issued to a user before `cutoffSeconds` (logout-all). */
  async denyUserBefore(userId: string, cutoffSeconds: number): Promise<void> {
    try {
      await this.redis.set(USER_PREFIX + userId, String(cutoffSeconds), "EX", this.accessTtlSeconds);
    } catch {
      // Non-fatal.
    }
  }

  /**
   * True if this access token has been revoked — either its jti is denylisted or
   * it was issued before the user's logout-all cutoff. Fails open (returns false)
   * on any Redis error.
   */
  async isRevoked(jti: string | undefined, userId: string, issuedAtSeconds: number | undefined): Promise<boolean> {
    try {
      if (jti) {
        const hit = await this.redis.get(JTI_PREFIX + jti);
        if (hit) {
          return true;
        }
      }
      if (issuedAtSeconds !== undefined) {
        const cutoff = await this.redis.get(USER_PREFIX + userId);
        // `<=`: fail closed at the cutoff second. A token issued in the same
        // second as a logout-all is revoked (JWT `iat` only has 1s resolution);
        // the cost is that an immediate same-second re-login is rejected, which
        // self-heals on the next second and is the safe trade-off for a "log me
        // out everywhere" security action.
        if (cutoff && issuedAtSeconds <= Number(cutoff)) {
          return true;
        }
      }
      return false;
    } catch {
      return false; // fail open
    }
  }
}
