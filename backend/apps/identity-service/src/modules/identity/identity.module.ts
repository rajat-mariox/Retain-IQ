import { Module } from "@nestjs/common";
import { RealtimePublisher } from "../../common/realtime/realtime-publisher.service.js";
import { AgentLinkController } from "./agent-link.controller.js";
import { AgentLinkService } from "./agent-link.service.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";
import { TokenService } from "./token.service.js";

@Module({
  controllers: [IdentityController, AgentLinkController],
  providers: [IdentityService, TokenService, AgentLinkService, RealtimePublisher],
})
export class IdentityModule {}
