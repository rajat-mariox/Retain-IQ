import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { AccessTokenClaims } from "@retainiq/contracts";
import { TokenDenylist } from "@retainiq/platform";

type IngestRequest = {
  headers: Record<string, string | undefined>;
  orgId?: string;
};

/**
 * Verifies the same access JWT issued by identity-service (shared secret) and attaches
 * the caller's orgId to the request. The ingestion service trusts identity-service as
 * the identity authority; it performs no DB lookups of its own.
 */
@Injectable()
export class IngestAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly denylist: TokenDenylist,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IngestRequest>();
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

    // Honour logout revocation from identity-service via the shared Redis denylist.
    if (await this.denylist.isRevoked(claims.jti, claims.sub, claims.iat)) {
      throw new UnauthorizedException("Session has been logged out.");
    }

    request.orgId = claims.orgId;
    return true;
  }
}

export const OrgId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<IngestRequest>();
  return request.orgId ?? "";
});

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
