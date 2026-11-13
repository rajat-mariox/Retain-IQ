import { Module } from "@nestjs/common";
import { OrgActivityController } from "./org-activity.controller.js";
import { OrgActivityService } from "./org-activity.service.js";

@Module({
  controllers: [OrgActivityController],
  providers: [OrgActivityService],
})
export class OrgActivityModule {}
