import { Module } from "@nestjs/common";
import { OrgStructureController } from "./org-structure.controller.js";
import { OrgStructureService } from "./org-structure.service.js";

@Module({
  controllers: [OrgStructureController],
  providers: [OrgStructureService],
  exports: [OrgStructureService],
})
export class OrgStructureModule {}
