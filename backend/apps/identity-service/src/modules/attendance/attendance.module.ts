import { Module } from "@nestjs/common";
import { AttendanceAlertsService } from "./attendance-alerts.service.js";
import { AttendanceCorrectionService } from "./attendance-correction.service.js";
import { AttendanceInsightsService } from "./attendance-insights.service.js";
import { ReportScheduleService } from "./report-schedule.service.js";
import { AttendanceAutoCloseService } from "./attendance-autoclose.service.js";
import { AttendancePolicyService } from "./attendance-policy.service.js";
import { AttendanceRecomputeService } from "./attendance-recompute.service.js";
import { AttendanceController } from "./attendance.controller.js";
import { AttendanceService } from "./attendance.service.js";
import { ObservationModule } from "../observation/observation.module.js";

import { RealtimePublisher } from "../../common/realtime/realtime-publisher.service.js";

@Module({
  imports: [ObservationModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceAlertsService, AttendanceAutoCloseService, RealtimePublisher, AttendancePolicyService, AttendanceRecomputeService, AttendanceCorrectionService, AttendanceInsightsService, ReportScheduleService],
  exports: [AttendancePolicyService, AttendanceService, AttendanceInsightsService],
})
export class AttendanceModule {}
