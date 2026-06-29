import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FEATURE_FLAG_KEY } from "./require-feature.decorator.js";
import { PlatformSettingsService } from "./platform-settings.service.js";

/**
 * Global feature-flag gate. Only acts on handlers/controllers marked with
 * @RequireFeature(flag); rejects with 403 when that platform flag is off — so a
 * disabled feature can't be reached by calling the API directly.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly settings: PlatformSettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const flag = this.reflector.getAllAndOverride<string | undefined>(FEATURE_FLAG_KEY, [context.getHandler(), context.getClass()]);
    if (!flag) return true; // not a gated route

    const { featureFlags } = await this.settings.getSettingsCached();
    if (featureFlags[flag] === false) {
      throw new ForbiddenException(`The "${flag}" feature is currently disabled.`);
    }
    return true;
  }
}
