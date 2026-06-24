import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { AccessTokenClaims } from "@retainiq/contracts";
import { requestContextStorage } from "../context/request-context.store.js";
import { TokenDenylist } from "../security/token-denylist.js";

/**
 * Authenticates requests via a Bearer access JWT and populates the request
 * context with the principal. Authorization (permission checks) happens later
 * in PermissionGuard against the database, not from these claims.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly denylist: TokenDenylist,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
    }>();

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException("Authentication is required.");
    }

    let claims: AccessTokenClaims & { iat?: number };
    try {
      claims = await this.jwtService.verifyAsync<AccessTokenClaims & { iat?: number }>(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired access token.");
    }

    // Reject tokens revoked by logout before their natural expiry.
    if (await this.denylist.isRevoked(claims.jti, claims.sub, claims.iat)) {
      throw new UnauthorizedException("Session has been logged out.");
    }

    const store = requestContextStorage.getStore();
    if (store) {
      store.userId = claims.sub;
      store.orgId = claims.orgId;
      store.membershipId = claims.membershipId;
      store.role = claims.role;
      store.permissionsVersion = claims.permissionsVersion;
    }

    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) {
    return null;
  }
  return value.trim();
}
