import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
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
  providers: [IngestAuthGuard, IngestionService, BrokerService],
})
export class AppModule {}
