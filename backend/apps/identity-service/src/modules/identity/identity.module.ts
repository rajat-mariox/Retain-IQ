import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";
import { TokenService } from "./token.service.js";

@Module({
  controllers: [IdentityController],
  providers: [IdentityService, TokenService],
})
export class IdentityModule {}
