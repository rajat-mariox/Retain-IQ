import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { loadConfig } from "@retainiq/config";
import type { AccessTokenClaims, AuthTokens } from "@retainiq/contracts";
import { TokenDenylist } from "@retainiq/platform";
import { generateRefreshToken, hashRefreshToken } from "../../common/crypto/refresh-token.util.js";
import { getRequestContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

const config = loadConfig();
const REFRESH_TTL_MS = config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * A just-rotated refresh token presented again within this window is treated as
 * a concurrent request from the same client (e.g. a Next.js page render and its
 * prefetch both renewing an expired access token at once), not as theft. Reuse
 * AFTER the window still revokes the user's whole session family.
 */
const REFRESH_REUSE_GRACE_MS = 30_000;

/** The principal fields the service layer builds; jti/sid are stamped at issue. */
type PrincipalClaims = Omit<AccessTokenClaims, "jti" | "sid">;

/** Identifiers a revoked session was bound to, for auditing. */
export type RevokedSession = { userId: string; orgId: string | null };

/**
 * Mints access JWTs and manages refresh sessions (rotation + reuse detection).
 * Refresh tokens are opaque and stored only as keyed hashes.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly denylist: TokenDenylist,
  ) {}

  /**
   * Issues an access token plus a brand-new refresh session for a principal.
   * The session is created first so its id can be embedded as `sid`, and the
   * access token's `jti` is recorded on the session so logout can denylist it.
   */
  async issue(claims: PrincipalClaims): Promise<AuthTokens> {
    const jti = randomUUID();
    const session = await this.createSession(claims, jti);
    const accessToken = await this.jwtService.signAsync({ ...claims, jti, sid: session.id });
    return { accessToken, refreshToken: session.refreshToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS };
  }

  /**
   * Validates a presented refresh token and marks it rotated, returning the
   * principal identifiers it was bound to. The caller reloads fresh
   * role/permissions before issuing new tokens via {@link issue}.
   *
   * - ACTIVE: consumed atomically, so only one concurrent request can rotate it.
   * - ROTATED within REFRESH_REUSE_GRACE_MS: a duplicate from the same client —
   *   allowed (the caller issues a fresh session), nothing is revoked.
   * - ROTATED after the grace window: reuse signals theft — the whole user
   *   family is revoked.
   * - Expired or REVOKED (e.g. after logout): refused, nothing else revoked.
   */
  async verifyAndConsume(rawRefreshToken: string): Promise<{
    userId: string;
    membershipId: string | null;
    orgId: string | null;
  }> {
    const hash = hashRefreshToken(rawRefreshToken, config.JWT_REFRESH_SECRET);
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash } });

    if (!session) {
      throw new UnauthorizedException("Invalid refresh token.");
    }

    const now = new Date();
    const principal = { userId: session.userId, membershipId: session.membershipId, orgId: session.orgId };

    if (session.expiresAt <= now || session.status === "REVOKED") {
      throw new UnauthorizedException("Refresh token is no longer valid.");
    }

    if (session.status === "ROTATED") {
      const sinceRotation = session.rotatedAt ? now.getTime() - session.rotatedAt.getTime() : Number.POSITIVE_INFINITY;
      if (sinceRotation <= REFRESH_REUSE_GRACE_MS) {
        return principal; // concurrent duplicate from the same client
      }
      // Reuse of a consumed token outside the grace window signals theft.
      await this.revokeFamily(session.userId);
      throw new UnauthorizedException("Refresh token is no longer valid.");
    }

    // Atomic consume: the status guard means only one concurrent request flips
    // ACTIVE → ROTATED. A request that loses this race was a few ms behind the
    // winner — the same duplicate case as above, so it is allowed too.
    await this.prisma.session.updateMany({
      where: { id: session.id, status: "ACTIVE" },
      data: { status: "ROTATED", rotatedAt: now, lastUsedAt: now },
    });

    return principal;
  }

  /** Revoke every active session for a user (refresh-token reuse detected). */
  private async revokeFamily(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
  }

  /**
   * Revokes the session backing a refresh token (single-session logout) and
   * denylists its access token so the still-valid JWT is rejected immediately.
   * Idempotent: returns the principal it was bound to, or null if there was no
   * active session for this token.
   */
  async revoke(rawRefreshToken: string): Promise<RevokedSession | null> {
    const hash = hashRefreshToken(rawRefreshToken, config.JWT_REFRESH_SECRET);
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash } });
    if (!session || session.status !== "ACTIVE") {
      return null;
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    if (session.accessTokenId) {
      await this.denylist.denyJti(session.accessTokenId);
    }

    return { userId: session.userId, orgId: session.orgId };
  }

  /**
   * Revokes every active session for a user (logout everywhere) and sets a
   * per-user denylist cutoff so all outstanding access tokens are rejected.
   * Returns the number of sessions revoked.
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { userId, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await this.denylist.denyUserBefore(userId, Math.floor(Date.now() / 1000));
    return count;
  }

  private async createSession(claims: PrincipalClaims, jti: string): Promise<{ id: string; refreshToken: string }> {
    const ctx = getRequestContext();
    const rawRefreshToken = generateRefreshToken();

    const session = await this.prisma.session.create({
      data: {
        userId: claims.sub,
        membershipId: claims.membershipId,
        orgId: claims.orgId,
        refreshTokenHash: hashRefreshToken(rawRefreshToken, config.JWT_REFRESH_SECRET),
        accessTokenId: jti,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });

    return { id: session.id, refreshToken: rawRefreshToken };
  }
}
