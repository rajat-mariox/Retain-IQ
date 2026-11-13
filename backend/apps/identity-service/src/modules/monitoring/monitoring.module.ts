import { Module } from "@nestjs/common";
import { MonitoringController } from "./monitoring.controller.js";
import { MonitoringService } from "./monitoring.service.js";

@Module({
  controllers: [MonitoringController],
  providers: [MonitoringService],
})
export class MonitoringModule {}
