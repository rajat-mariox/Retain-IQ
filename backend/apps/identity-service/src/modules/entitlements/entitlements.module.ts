import { Module } from "@nestjs/common";
import { EntitlementsController } from "./entitlements.controller.js";

// EntitlementService comes from the global EntitlementModule.
@Module({
  controllers: [EntitlementsController],
})
export class EntitlementsModule {}
