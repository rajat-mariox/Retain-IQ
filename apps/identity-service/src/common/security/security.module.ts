import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import { loadConfig } from "@retainiq/config";
import { Redis } from "ioredis";
import { AuditService } from "../audit/audit.service.js";
import { AuthGuard } from "../guards/auth.guard.js";
import { PermissionGuard } from "../guards/permission.guard.js";
import { TenantGuard } from "../guards/tenant.guard.js";
import { PermissionBundleService } from "./permission-bundle.service.js";
import { InMemoryPermissionCache, PermissionCache } from "./permission-cache.js";
import { RedisPermissionCache } from "./redis-permission-cache.js";

const config = loadConfig();

/**
 * Cross-cutting security primitives shared by every module: JWT signing/verify,
 * the auth/tenant/permission guards, RBAC bundle resolution, and auth rate
 * limiting. Global so controllers can @UseGuards(...) without re-importing.
 */
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: config.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: config.ACCESS_TOKEN_TTL_SECONDS },
    }),
    ThrottlerModule.forRoot([
      { ttl: config.AUTH_RATE_TTL_SECONDS * 1000, limit: config.AUTH_RATE_LIMIT },
    ]),
  ],
  providers: [
    AuthGuard,
    TenantGuard,
    PermissionGuard,
    PermissionBundleService,
    AuditService,
    {
      provide: PermissionCache,
      useFactory: (): PermissionCache => {
        if (config.PERMISSION_CACHE_DRIVER === "redis") {
          const redis = new Redis(config.REDIS_URL, {
            maxRetriesPerRequest: 2,
            lazyConnect: true,
          });
          // Connect in the background; the cache fails open until it is ready.
          void redis.connect().catch(() => undefined);
          return new RedisPermissionCache(redis);
        }
        return new InMemoryPermissionCache();
      },
    },
  ],
  exports: [
    JwtModule,
    ThrottlerModule,
    AuthGuard,
    TenantGuard,
    PermissionGuard,
    PermissionBundleService,
    AuditService,
  ],
})
export class SecurityModule {}
