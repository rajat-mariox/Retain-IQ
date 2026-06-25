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
   * principal identifiers it was bound to. Reuse of an already-consumed token
   * signals theft and revokes the whole user family. The caller reloads fresh
   * role/permissions before issuing new tokens via {@link issue}.
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

    if (session.status !== "ACTIVE" || session.expiresAt <= new Date()) {
      // Reuse of a consumed token signals theft — invalidate the family.
      await this.prisma.session.updateMany({
        where: { userId: session.userId, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
      throw new UnauthorizedException("Refresh token is no longer valid.");
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { status: "ROTATED", rotatedAt: new Date() },
    });

    return {
      userId: session.userId,
      membershipId: session.membershipId,
      orgId: session.orgId,
    };
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
