import { Module } from "@nestjs/common";
import { InsightsController } from "./insights.controller.js";
import { InsightsService } from "./insights.service.js";

// AnalyticsReadPrismaService is a global singleton (DatabaseModule).
@Module({
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
