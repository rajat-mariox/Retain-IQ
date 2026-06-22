import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { AccessTokenClaims } from "@retainiq/contracts";

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
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IngestRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException("Authentication is required.");
    }

    try {
      const claims = await this.jwtService.verifyAsync<AccessTokenClaims>(token);
      request.orgId = claims.orgId;
    } catch {
      throw new UnauthorizedException("Invalid or expired access token.");
    }

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
