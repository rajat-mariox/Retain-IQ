import { Module } from "@nestjs/common";
import { AttendanceAlertsService } from "./attendance-alerts.service.js";
import { AttendanceCorrectionService } from "./attendance-correction.service.js";
import { AttendanceAutoCloseService } from "./attendance-autoclose.service.js";
import { AttendancePolicyService } from "./attendance-policy.service.js";
import { AttendanceController } from "./attendance.controller.js";
import { AttendanceService } from "./attendance.service.js";

import { RealtimePublisher } from "../../common/realtime/realtime-publisher.service.js";

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceAlertsService, AttendanceAutoCloseService, RealtimePublisher, AttendancePolicyService, AttendanceCorrectionService],
  exports: [AttendancePolicyService],
})
export class AttendanceModule {}
