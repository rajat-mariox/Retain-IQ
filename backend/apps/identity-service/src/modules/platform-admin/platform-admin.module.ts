import { Module } from "@nestjs/common";
import { loadConfig } from "@retainiq/config";
import { TokenDenylist } from "@retainiq/platform";
import { Redis } from "ioredis";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { PlatformAdminController } from "./platform-admin.controller.js";
import { PlatformAdminService } from "./platform-admin.service.js";
import { PlatformTokenService } from "./platform-token.service.js";
import { PlatformAuthGuard } from "./platform-auth.guard.js";
import { PLATFORM_DENYLIST } from "./dto.js";

const config = loadConfig();

@Module({
  controllers: [PlatformAdminController, AdminController],
  providers: [
    PlatformAdminService,
    PlatformTokenService,
    PlatformAuthGuard,
    AdminService,
    {
      // Platform-scoped denylist keyed with the platform access TTL (8h), so a
      // logged-out admin token stays revoked for its full lifetime — separate
      // from the org denylist (15m TTL) in SecurityModule.
      provide: PLATFORM_DENYLIST,
      useFactory: (): TokenDenylist => {
        const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
        void redis.connect().catch(() => undefined);
        return new TokenDenylist(redis, config.PLATFORM_ACCESS_TTL_SECONDS);
      },
    },
  ],
})
export class PlatformAdminModule {}
