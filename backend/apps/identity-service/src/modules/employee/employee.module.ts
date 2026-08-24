import { Module } from "@nestjs/common";
import { AttendanceModule } from "../attendance/attendance.module.js";
import { EmployeeController } from "./employee.controller.js";
import { EmployeeRepository } from "./employee.repository.js";
import { EmployeeService } from "./employee.service.js";
import { EmployeeDocumentsService } from "./employee-documents.service.js";
import { Employee360Service } from "./employee-360.service.js";
import { SkillsController } from "./skills.controller.js";
import { SkillsService } from "./skills.service.js";
import { CertificationsService } from "./certifications.service.js";
import { CertificationRemindersService } from "./certification-reminders.service.js";
import { ChangeRequestController } from "./change-request.controller.js";
import { ChangeRequestService } from "./change-request.service.js";
import { ChangeRequestCron } from "./change-request.cron.js";
import { ExitController } from "./exit.controller.js";
import { ExitService } from "./exit.service.js";
import { AlumniService } from "./alumni.service.js";
import { ProbationController } from "./probation.controller.js";
import { ProbationService } from "./probation.service.js";
import { ProbationRemindersService } from "./probation-reminders.service.js";
import { RemarkController } from "./remark.controller.js";
import { RemarkService } from "./remark.service.js";
import { RecommendationsService } from "./recommendations.service.js";

@Module({
  imports: [AttendanceModule], // RecommendationsService reuses AttendanceInsightsService
  controllers: [EmployeeController, SkillsController, ChangeRequestController, ExitController, ProbationController, RemarkController],
  providers: [EmployeeRepository, EmployeeService, EmployeeDocumentsService, Employee360Service, SkillsService, CertificationsService, CertificationRemindersService, ChangeRequestService, ChangeRequestCron, ExitService, AlumniService, ProbationService, ProbationRemindersService, RemarkService, RecommendationsService],
  exports: [EmployeeService],
})
export class EmployeeModule {}

