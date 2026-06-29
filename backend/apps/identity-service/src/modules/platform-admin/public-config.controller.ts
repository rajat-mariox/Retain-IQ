import { Controller, Get } from "@nestjs/common";
import { PlatformSettingsService } from "../../common/settings/platform-settings.service.js";

/**
 * PUBLIC global config — branding, the global notification, maintenance mode and
 * feature flags. Unauthenticated by design so EVERY app (org-web tenants,
 * marketing, etc.) can read it to render banners, apply branding and gate
 * features. Returns only non-sensitive config (no per-org data).
 */
@Controller("config")
export class PublicConfigController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  config() {
    return this.settings.getSettings();
  }
}
