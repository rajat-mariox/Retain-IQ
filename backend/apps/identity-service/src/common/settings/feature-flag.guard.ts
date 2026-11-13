import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { AccessTokenClaims } from "@retainiq/contracts";
import { FEATURE_FLAG_KEY } from "./require-feature.decorator.js";
import { PlatformSettingsService } from "./platform-settings.service.js";

/**
 * Feature gate for @RequireFeature(flag) routes. Resolves in two layers:
 *
 *   1. global OFF → 403 for everyone (emergency kill switch)
 *   2. global ON  → the caller's org override decides; no override inherits ON
 *
 * This is an APP_GUARD, so it runs BEFORE the route's AuthGuard — the request
 * context has no orgId yet. We therefore decode the bearer token here purely to
 * learn which org is asking. That is NOT authentication: a missing or invalid
 * token yields no org (global rules apply) and AuthGuard rejects it moments
 * later. Verifying twice is cheap next to a DB round-trip, and it keeps the gate
 * in one place instead of scattering flag checks through every controller.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: PlatformSettingsService,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flag = this.reflector.getAllAndOverride<string | undefined>(FEATURE_FLAG_KEY, [context.getHandler(), context.getClass()]);
    if (!flag) return true; // not a gated route

    const orgId = await this.callerOrgId(context);
    if (await this.settings.isFeatureEnabled(flag, orgId)) return true;

    // Deliberately the same message whether the global switch or an org override
    // closed it — a tenant shouldn't learn how the platform is configured.
    throw new ForbiddenException(`The "${flag}" feature is not available.`);
  }

  /** The org from the bearer token, or null if there isn't a usable one. */
  private async callerOrgId(context: ExecutionContext): Promise<string | null> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const header = request.headers?.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    try {
      const claims = await this.jwtService.verifyAsync<AccessTokenClaims>(header.slice(7).trim());
      return claims.orgId ?? null;
    } catch {
      return null; // AuthGuard will reject it; here it just means "no org context"
    }
  }
}
