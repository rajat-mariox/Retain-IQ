import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PlatformSettingsService } from "./platform-settings.service.js";
import { MaintenanceGuard } from "./maintenance.guard.js";
import { FeatureFlagGuard } from "./feature-flag.guard.js";

// Global so the settings service is injectable everywhere (controllers + guards),
// and so the two gates run on every request. DatabaseModule (which the service
// depends on) is also global.
@Global()
@Module({
  providers: [
    PlatformSettingsService,
    { provide: APP_GUARD, useClass: MaintenanceGuard }, // 503 platform-wide during maintenance
    { provide: APP_GUARD, useClass: FeatureFlagGuard }, // 403 for @RequireFeature routes when off
  ],
  exports: [PlatformSettingsService],
})
export class SettingsModule {}
