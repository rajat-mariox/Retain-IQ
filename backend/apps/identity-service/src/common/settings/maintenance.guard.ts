import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PlatformSettingsService } from "./platform-settings.service.js";

// Paths that MUST keep working during maintenance: super-admin (to turn it off),
// health probes, and the public config (so apps can read the maintenance state).
const ALLOW_PREFIXES = ["/v1/platform", "/v1/health", "/v1/config"];

/**
 * Global maintenance gate. When maintenance mode is on, every tenant API request
 * is rejected with 503 — so a direct API call is blocked, not just the UI.
 * Super-admin, health and public-config routes stay open.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly settings: PlatformSettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (ALLOW_PREFIXES.some((p) => path.startsWith(p))) return true;

    const { maintenance } = await this.settings.getSettingsCached();
    if (!maintenance.enabled) return true;

    throw new ServiceUnavailableException(maintenance.message || "The platform is under maintenance. Please try again later.");
  }
}
