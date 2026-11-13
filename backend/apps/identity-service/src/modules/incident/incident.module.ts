import { Module } from "@nestjs/common";
import { EscalationPromoteController, IncidentController } from "./incident.controller.js";
import { IncidentService } from "./incident.service.js";
import { IncidentEvidenceService } from "./incident-evidence.service.js";

@Module({
  controllers: [IncidentController, EscalationPromoteController],
  providers: [IncidentService, IncidentEvidenceService],
  exports: [IncidentService],
})
export class IncidentModule {}
