import { Module } from "@nestjs/common";
import { HrAnalyticsController } from "./hr-analytics.controller.js";
import { HrAnalyticsService } from "./hr-analytics.service.js";

@Module({
  controllers: [HrAnalyticsController],
  providers: [HrAnalyticsService],
})
export class HrAnalyticsModule {}
