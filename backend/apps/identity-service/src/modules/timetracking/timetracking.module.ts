import { Module } from "@nestjs/common";
import { TimeTrackingController } from "./timetracking.controller.js";
import { TimeTrackingService } from "./timetracking.service.js";
import { TimeAutoSyncService } from "./time-auto-sync.service.js";

@Module({
  controllers: [TimeTrackingController],
  providers: [TimeTrackingService, TimeAutoSyncService],
})
export class TimeTrackingModule {}
