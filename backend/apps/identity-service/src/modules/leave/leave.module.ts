import { Module } from "@nestjs/common";
import { LeaveController } from "./leave.controller.js";
import { LeaveService } from "./leave.service.js";
import { LeaveAttachmentService } from "./leave-attachment.service.js";
import { CompOffService } from "./comp-off.service.js";

@Module({
  controllers: [LeaveController],
  providers: [LeaveService, LeaveAttachmentService, CompOffService],
  exports: [CompOffService], // payroll lock() converts approved OT → comp-off
})
export class LeaveModule {}
