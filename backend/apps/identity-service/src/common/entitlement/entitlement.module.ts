import { Global, Module } from "@nestjs/common";
import { EntitlementService } from "./entitlement.service.js";

// Global so `EntitlementService.can()/getLimit()` is injectable in any module
// without re-importing. Its deps (PlatformSettingsService, BillingReadPrismaService)
// are provided by the global SettingsModule / DatabaseModule.
@Global()
@Module({
  providers: [EntitlementService],
  exports: [EntitlementService],
})
export class EntitlementModule {}
