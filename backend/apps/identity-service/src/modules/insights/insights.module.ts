import { Module } from "@nestjs/common";
import { InsightAlertsService } from "./insight-alerts.service.js";
import { InsightsController } from "./insights.controller.js";
import { InsightsService } from "./insights.service.js";

// AnalyticsReadPrismaService is a global singleton (DatabaseModule).
@Module({
  controllers: [InsightsController],
  providers: [InsightsService, InsightAlertsService],
})
export class InsightsModule {}
