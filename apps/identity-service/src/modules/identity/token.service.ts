import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { loadConfig } from "@retainiq/config";
import type { AccessTokenClaims, AuthTokens } from "@retainiq/contracts";
import { generateRefreshToken, hashRefreshToken } from "../../common/crypto/refresh-token.util.js";
import { getRequestContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

const config = loadConfig();
const REFRESH_TTL_MS = config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Mints access JWTs and manages refresh sessions (rotation + reuse detection).
 * Refresh tokens are opaque and stored only as keyed hashes.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /** Issues an access token plus a brand-new refresh session for a principal. */
  async issue(claims: AccessTokenClaims): Promise<AuthTokens> {
    const accessToken = await this.jwtService.signAsync(claims);
    const refreshToken = await this.createSession(claims);
    return { accessToken, refreshToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS };
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

  /** Revokes the session backing a refresh token (logout). Idempotent. */
  async revoke(rawRefreshToken: string): Promise<void> {
    const hash = hashRefreshToken(rawRefreshToken, config.JWT_REFRESH_SECRET);
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: hash, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
  }

  private async createSession(claims: AccessTokenClaims): Promise<string> {
    const ctx = getRequestContext();
    const rawRefreshToken = generateRefreshToken();

    await this.prisma.session.create({
      data: {
        userId: claims.sub,
        membershipId: claims.membershipId,
        orgId: claims.orgId,
        refreshTokenHash: hashRefreshToken(rawRefreshToken, config.JWT_REFRESH_SECRET),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });

    return rawRefreshToken;
  }
}
