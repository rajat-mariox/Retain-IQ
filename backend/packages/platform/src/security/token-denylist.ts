import type { Redis } from "ioredis";

const JTI_PREFIX = "deny:jti:";
const USER_PREFIX = "deny:user:";

/**
 * Redis-backed denylist that lets logout revoke still-valid access JWTs before
 * they expire. The key format is a cross-service contract: identity-service
 * writes (`denyJti`/`denyUserBefore` on logout) and every access-token verifier
 * reads (`isRevoked`), so it lives in @retainiq/platform to keep both sides on
 * the same keys.
 *
 *  - per-token (`deny:jti:<jti>`): set on single-session logout.
 *  - per-user cutoff (`deny:user:<userId>` = an epoch in seconds): set on
 *    logout-everywhere. Any access token issued at or before the cutoff is
 *    rejected, which catches every outstanding token in one key.
 *
 * Both keys carry a TTL equal to the access-token lifetime, so they self-expire
 * once no token they could match is still valid — the denylist never grows
 * unbounded.
 *
 * **Fails open**, mirroring the permission cache: if Redis is unreachable (or a
 * service has no Redis configured, `redis: null`), an authenticated request
 * proceeds rather than 401-ing the whole service. The trade-off is that a
 * logged-out token may survive a Redis outage until its short TTL elapses.
 */
export class TokenDenylist {
  constructor(
    private readonly redis: Redis | null,
    private readonly accessTtlSeconds = 900,
  ) {}

  /** Revoke a single access token by its jti for the remainder of its life. */
  async denyJti(jti: string): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.set(JTI_PREFIX + jti, "1", "EX", this.accessTtlSeconds);
    } catch {
      // Non-fatal: revocation is best-effort under a Redis outage.
    }
  }

  /** Revoke every access token issued to a user before `cutoffSeconds` (logout-all). */
  async denyUserBefore(userId: string, cutoffSeconds: number): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.set(USER_PREFIX + userId, String(cutoffSeconds), "EX", this.accessTtlSeconds);
    } catch {
      // Non-fatal.
    }
  }

  /**
   * True if this access token has been revoked — either its jti is denylisted or
   * it was issued at/before the user's logout-all cutoff. Fails open (returns
   * false) when Redis is absent or errors.
   */
  async isRevoked(jti: string | undefined, userId: string, issuedAtSeconds: number | undefined): Promise<boolean> {
    if (!this.redis) {
      return false;
    }
    try {
      // One round-trip for both checks (jti denylist + per-user cutoff).
      const jtiKey = jti ? JTI_PREFIX + jti : null;
      const values = await this.redis.mget(...(jtiKey ? [jtiKey, USER_PREFIX + userId] : [USER_PREFIX + userId]));
      const jtiHit = jtiKey ? values[0] : null;
      const cutoff = jtiKey ? values[1] : values[0];

      if (jtiHit) {
        return true;
      }
      // `<=`: fail closed at the cutoff second. A token issued in the same
      // second as a logout-all is revoked (JWT `iat` only has 1s resolution);
      // the cost is that an immediate same-second re-login is rejected, which
      // self-heals on the next second and is the safe trade-off for a "log me
      // out everywhere" security action.
      if (issuedAtSeconds !== undefined && cutoff && issuedAtSeconds <= Number(cutoff)) {
        return true;
      }
      return false;
    } catch {
      return false; // fail open
    }
  }
}
