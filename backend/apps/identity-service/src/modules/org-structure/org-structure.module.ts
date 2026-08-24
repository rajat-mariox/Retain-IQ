import { Module } from "@nestjs/common";
import { OrgStructureController } from "./org-structure.controller.js";
import { OrgStructureService } from "./org-structure.service.js";
import { ShiftRotationService } from "./shift-rotation.service.js";

@Module({
  controllers: [OrgStructureController],
  providers: [OrgStructureService, ShiftRotationService],
  exports: [OrgStructureService, ShiftRotationService],
})
export class OrgStructureModule {}
