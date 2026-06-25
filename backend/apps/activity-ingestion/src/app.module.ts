import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { TokenDenylist } from "@retainiq/platform";
import { Redis } from "ioredis";
import { loadIngestionConfig } from "./config.js";
import { BrokerService } from "./broker.service.js";
import { HealthController } from "./health.controller.js";
import { IngestAuthGuard } from "./auth.guard.js";
import { IngestionController } from "./ingestion.controller.js";
import { IngestionService } from "./ingestion.service.js";
import { ObservabilityModule } from "./observability.module.js";

const config = loadIngestionConfig();

@Module({
  imports: [ObservabilityModule, JwtModule.register({ secret: config.JWT_ACCESS_SECRET })],
  controllers: [HealthController, IngestionController],
  providers: [
    IngestAuthGuard,
    IngestionService,
    BrokerService,
    {
      // Reads the same Redis denylist identity-service writes on logout, so a
      // revoked access token is rejected here too. Disabled (fails open) when
      // no REDIS_URL is configured — ingestion only reads, never writes.
      provide: TokenDenylist,
      useFactory: (): TokenDenylist => {
        if (!config.REDIS_URL) {
          return new TokenDenylist(null);
        }
        const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
        void redis.connect().catch(() => undefined);
        return new TokenDenylist(redis);
      },
    },
  ],
})
export class AppModule {}
