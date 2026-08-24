import { Module } from "@nestjs/common";
import { InsightAlertsService } from "./insight-alerts.service.js";
import { InsightsController } from "./insights.controller.js";
import { InsightsService } from "./insights.service.js";
import { ObservationModule } from "../observation/observation.module.js";

// AnalyticsReadPrismaService is a global singleton (DatabaseModule).
@Module({
  imports: [ObservationModule],
  controllers: [InsightsController],
  providers: [InsightsService, InsightAlertsService],
})
export class InsightsModule {}
