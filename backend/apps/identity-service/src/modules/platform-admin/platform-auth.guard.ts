import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { PlatformTokenService } from "./platform-token.service.js";

interface PlatformRequest {
  headers: Record<string, string | undefined>;
  platformAdmin?: { id: string; role: string; name: string };
}

/**
 * Authenticates platform (super-admin) requests via a Bearer access JWT signed
 * with the platform secret. Rejects org tokens (wrong secret/scope) and tokens
 * revoked by logout.
 */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(private readonly tokens: PlatformTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException("Authentication is required.");
    }

    const claims = await this.tokens.verify(token);
    request.platformAdmin = { id: claims.sub, role: claims.role, name: claims.name };
    return true;
  }
}

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { id: string; role: string; name: string } => {
    const request = ctx.switchToHttp().getRequest<PlatformRequest>();
    return request.platformAdmin ?? { id: "", role: "", name: "" };
  },
);

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
