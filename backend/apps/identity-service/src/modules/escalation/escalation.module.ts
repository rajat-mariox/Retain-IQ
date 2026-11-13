import { Module } from "@nestjs/common";
import { EscalationController, ObservationEscalateController } from "./escalation.controller.js";
import { EscalationService } from "./escalation.service.js";
import { EscalationSlaService } from "./escalation-sla.service.js";

@Module({
  controllers: [EscalationController, ObservationEscalateController],
  providers: [EscalationService, EscalationSlaService],
  exports: [EscalationService],
})
export class EscalationModule {}
