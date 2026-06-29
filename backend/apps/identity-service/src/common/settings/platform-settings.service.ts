import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import type { FeatureFlags, GlobalNotification, MaintenanceMode, PlatformBranding, PlatformSettings } from "../../modules/platform-admin/admin.dto.js";

const SECTIONS = ["branding", "notification", "featureFlags", "maintenance"] as const;
const CACHE_TTL_MS = 15_000; // guards read this per-request — cache to spare the DB

/** A partial update — each section optional, and section fields themselves optional. */
export interface SettingsPatch {
  branding?: Partial<PlatformBranding>;
  notification?: Partial<GlobalNotification>;
  featureFlags?: FeatureFlags;
  maintenance?: Partial<MaintenanceMode>;
}

/** Defaults returned when nothing is stored yet — also the canonical feature-flag set. */
const DEFAULTS: PlatformSettings = {
  branding: { platformName: "RetainIQ", primaryColor: "#1f883d", supportEmail: "support@retainiq.com", logoUrl: "" },
  notification: { enabled: false, message: "", level: "info" },
  featureFlags: {
    // admin-web modules
    customerSuccess: true,
    platformHealth: true,
    activityFeed: true,
    // org-web (tenant) product features
    timeTracking: true,
    attendance: true,
    projects: true,
    screenshots: true,
    aiInsights: true,
    billing: true,
  },
  maintenance: { enabled: false, message: "We're performing scheduled maintenance. Please check back shortly." },
};

@Injectable()
export class PlatformSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private cache: { at: number; value: PlatformSettings } | null = null;

  async getSettings(): Promise<PlatformSettings> {
    const rows = await this.prisma.platformSetting.findMany();
    const get = <T>(key: string) => (rows.find((r) => r.key === key)?.value as T | undefined) ?? ({} as T);
    return {
      branding: { ...DEFAULTS.branding, ...get<Partial<PlatformBranding>>("branding") },
      notification: { ...DEFAULTS.notification, ...get<Partial<GlobalNotification>>("notification") },
      // Defaults first so newly-added flags appear even if an older record is stored.
      featureFlags: { ...DEFAULTS.featureFlags, ...get<FeatureFlags>("featureFlags") },
      maintenance: { ...DEFAULTS.maintenance, ...get<Partial<MaintenanceMode>>("maintenance") },
    };
  }

  /** Cached read for hot paths (guards). Refreshed every 15s; busted on write. */
  async getSettingsCached(): Promise<PlatformSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.value;
    const value = await this.getSettings();
    this.cache = { at: Date.now(), value };
    return value;
  }

  /** Merge + persist only the provided sections; returns the full merged settings. */
  async updateSettings(input: SettingsPatch): Promise<PlatformSettings> {
    const current = await this.getSettings();
    const next: PlatformSettings = {
      branding: { ...current.branding, ...(input.branding ?? {}) },
      notification: { ...current.notification, ...(input.notification ?? {}) },
      featureFlags: { ...current.featureFlags, ...(input.featureFlags ?? {}) },
      maintenance: { ...current.maintenance, ...(input.maintenance ?? {}) },
    };
    for (const key of SECTIONS) {
      if (input[key] !== undefined) {
        const value = next[key] as object;
        await this.prisma.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      }
    }
    this.cache = { at: Date.now(), value: next }; // keep guards in sync immediately
    return next;
  }
}
