import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { loadConfig } from "@retainiq/config";
import { TokenDenylist } from "@retainiq/platform";
import { getRequestContext } from "../../common/context/request-context.store.js";
import { generateRefreshToken, hashRefreshToken } from "../../common/crypto/refresh-token.util.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { PLATFORM_DENYLIST, type PlatformClaims, type PlatformPrincipal, type PlatformTokens } from "./dto.js";

const config = loadConfig();
const REFRESH_TTL_MS = config.PLATFORM_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Mints and validates platform (super-admin) tokens. Mirrors the org TokenService
 * but signs with PLATFORM_JWT_SECRET and a `scope: "platform"` claim, so org and
 * platform tokens are cryptographically and semantically distinct. Refresh
 * sessions are opaque, stored only as keyed hashes, and rotated on use.
 */
@Injectable()
export class PlatformTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    @Inject(PLATFORM_DENYLIST) private readonly denylist: TokenDenylist,
  ) {}

  /** Issues an access JWT + a fresh refresh session for a platform admin. */
  async issue(admin: PlatformPrincipal): Promise<PlatformTokens> {
    const jti = randomUUID();
    const ctx = getRequestContext();
    const rawRefreshToken = generateRefreshToken();

    await this.prisma.platformAdminSession.create({
      data: {
        adminId: admin.id,
        refreshTokenHash: hashRefreshToken(rawRefreshToken, config.PLATFORM_JWT_SECRET),
        accessTokenId: jti,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });

    const claims: PlatformClaims = { sub: admin.id, scope: "platform", role: admin.role, name: admin.name, jti };
    const accessToken = await this.jwtService.signAsync(claims, {
      secret: config.PLATFORM_JWT_SECRET,
      expiresIn: config.PLATFORM_ACCESS_TTL_SECONDS,
    });

    return { accessToken, refreshToken: rawRefreshToken, expiresIn: config.PLATFORM_ACCESS_TTL_SECONDS };
  }

  /** Verifies a platform access token: signature, scope, and logout denylist. */
  async verify(token: string): Promise<PlatformClaims & { iat?: number }> {
    let claims: PlatformClaims & { iat?: number };
    try {
      claims = await this.jwtService.verifyAsync(token, { secret: config.PLATFORM_JWT_SECRET });
    } catch {
      throw new UnauthorizedException("Invalid or expired session.");
    }
    if (claims.scope !== "platform") {
      throw new UnauthorizedException("Not a platform session.");
    }
    if (await this.denylist.isRevoked(claims.jti, claims.sub, claims.iat)) {
      throw new UnauthorizedException("Session has been logged out.");
    }
    return claims;
  }

  /** Rotates a refresh token (with reuse detection), returning fresh tokens. */
  async rotate(rawRefreshToken: string): Promise<PlatformTokens> {
    const hash = hashRefreshToken(rawRefreshToken, config.PLATFORM_JWT_SECRET);
    const session = await this.prisma.platformAdminSession.findUnique({ where: { refreshTokenHash: hash } });
    if (!session) {
      throw new UnauthorizedException("Invalid refresh token.");
    }
    if (session.status !== "ACTIVE" || session.expiresAt <= new Date()) {
      // Reuse of a consumed/expired token signals theft — kill the family.
      await this.prisma.platformAdminSession.updateMany({
        where: { adminId: session.adminId, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
      throw new UnauthorizedException("Refresh token is no longer valid.");
    }

    await this.prisma.platformAdminSession.update({
      where: { id: session.id },
      data: { status: "ROTATED", rotatedAt: new Date() },
    });

    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: session.adminId } });
    if (!admin || admin.status !== "ACTIVE") {
      throw new UnauthorizedException("Account is no longer active.");
    }
    return this.issue({ id: admin.id, role: admin.role, name: admin.name });
  }

  /** Revokes the session behind a refresh token and denylists its access token. */
  async revoke(rawRefreshToken: string): Promise<void> {
    const hash = hashRefreshToken(rawRefreshToken, config.PLATFORM_JWT_SECRET);
    const session = await this.prisma.platformAdminSession.findUnique({ where: { refreshTokenHash: hash } });
    if (!session || session.status !== "ACTIVE") {
      return; // idempotent
    }
    await this.prisma.platformAdminSession.update({
      where: { id: session.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    if (session.accessTokenId) {
      await this.denylist.denyJti(session.accessTokenId);
    }
  }
}
