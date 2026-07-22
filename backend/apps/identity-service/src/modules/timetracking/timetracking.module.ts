import { Module } from "@nestjs/common";
import { TimeTrackingController } from "./timetracking.controller.js";
import { TimeTrackingService } from "./timetracking.service.js";

@Module({
  controllers: [TimeTrackingController],
  providers: [TimeTrackingService],
})
export class TimeTrackingModule {}
