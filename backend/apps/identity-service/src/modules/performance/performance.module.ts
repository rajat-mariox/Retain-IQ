import { Module } from "@nestjs/common";
import { PerformanceController } from "./performance.controller.js";
import { PerformanceService } from "./performance.service.js";

@Module({
  controllers: [PerformanceController],
  providers: [PerformanceService],
})
export class PerformanceModule {}
