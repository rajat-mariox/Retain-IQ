import { Module } from "@nestjs/common";
import { ObservationController } from "./observation.controller.js";
import { ObservationService } from "./observation.service.js";
import { ObservationEvidenceService } from "./observation-evidence.service.js";

@Module({
  controllers: [ObservationController],
  providers: [ObservationService, ObservationEvidenceService],
  exports: [ObservationService],
})
export class ObservationModule {}
