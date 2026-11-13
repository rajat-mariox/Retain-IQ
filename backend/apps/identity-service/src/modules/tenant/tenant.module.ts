import { Module } from "@nestjs/common";
import { TenantController } from "./tenant.controller.js";
import { TenantService } from "./tenant.service.js";

@Module({
  controllers: [TenantController],
  providers: [TenantService],
})
export class TenantModule {}
