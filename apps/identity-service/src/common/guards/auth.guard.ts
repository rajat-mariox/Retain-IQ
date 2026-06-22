import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { AccessTokenClaims } from "@retainiq/contracts";
import { requestContextStorage } from "../context/request-context.store.js";

/**
 * Authenticates requests via a Bearer access JWT and populates the request
 * context with the principal. Authorization (permission checks) happens later
 * in PermissionGuard against the database, not from these claims.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
    }>();

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException("Authentication is required.");
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwtService.verifyAsync<AccessTokenClaims>(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired access token.");
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
