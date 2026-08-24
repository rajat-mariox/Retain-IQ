import { Module } from "@nestjs/common";
import { ReportJobsController } from "./report-jobs.controller.js";
import { ReportJobsService } from "./report-jobs.service.js";
import { ReportJobsCron } from "./report-jobs.cron.js";
import { AttendanceModule } from "../attendance/attendance.module.js";

@Module({
  imports: [AttendanceModule],
  controllers: [ReportJobsController],
  providers: [ReportJobsService, ReportJobsCron],
})
export class ReportsModule {}
