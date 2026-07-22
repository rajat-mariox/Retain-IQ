import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import type { FeatureFlags, GlobalNotification, MaintenanceMode, PlatformBranding, PlatformSettings } from "../../modules/platform-admin/admin.dto.js";

const SECTIONS = ["branding", "notification", "featureFlags", "maintenance"] as const;
const CACHE_TTL_MS = 15_000; // guards read this per-request — cache to spare the DB
const ORG_CACHE_TTL_MS = 15_000; // per-org overrides, same hot path as the guard

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

/** One feature's state for one org, plus where the decision came from. */
export interface ResolvedFlag {
  enabled: boolean;
  /** "global" = inherited; "org" = an override decided it; "kill_switch" = global OFF wins. */
  source: "global" | "org" | "kill_switch";
}

@Injectable()
export class PlatformSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private cache: { at: number; value: PlatformSettings } | null = null;
  /** Per-org overrides, keyed by orgId. Invalidated on write — never left to expire. */
  private orgCache = new Map<string, { at: number; value: Record<string, boolean> }>();

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

  /** updatedAt of the global-notification row — timestamps the inbox announcement. */
  async notificationStamp(): Promise<Date | null> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: "notification" }, select: { updatedAt: true } });
    return row?.updatedAt ?? null;
  }

  /** Cached read for hot paths (guards). Refreshed every 15s; busted on write. */
  async getSettingsCached(): Promise<PlatformSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.value;
    const value = await this.getSettings();
    this.cache = { at: Date.now(), value };
    return value;
  }

  // ---- Org-level feature flags --------------------------------------------

  /** The canonical feature list — what an admin may override, and nothing else. */
  featureKeys(): string[] {
    return Object.keys(DEFAULTS.featureFlags);
  }

  isKnownFeature(feature: string): boolean {
    return feature in DEFAULTS.featureFlags;
  }

  /** An org's raw overrides (only features that diverge from global). Cached. */
  private async orgOverrides(orgId: string): Promise<Record<string, boolean>> {
    const hit = this.orgCache.get(orgId);
    if (hit && Date.now() - hit.at < ORG_CACHE_TTL_MS) return hit.value;

    const rows = await this.prisma.orgFeatureFlag.findMany({ where: { orgId }, select: { feature: true, enabled: true } });
    const value: Record<string, boolean> = {};
    for (const r of rows) value[r.feature] = r.enabled;
    this.orgCache.set(orgId, { at: Date.now(), value });
    return value;
  }

  /**
   * Resolve every feature for one org.
   *
   *   global OFF → off for everyone. An org override CANNOT re-enable it; this
   *                is the emergency kill switch and outranks everything.
   *   global ON  → the org's override decides; no override means inherit ON.
   */
  async resolveFeatureFlags(orgId: string): Promise<Record<string, ResolvedFlag>> {
    const [{ featureFlags }, overrides] = await Promise.all([this.getSettingsCached(), this.orgOverrides(orgId)]);
    const out: Record<string, ResolvedFlag> = {};
    for (const [feature, globalOn] of Object.entries(featureFlags)) {
      if (globalOn === false) {
        out[feature] = { enabled: false, source: "kill_switch" };
        continue;
      }
      const override = overrides[feature];
      out[feature] = override === undefined ? { enabled: true, source: "global" } : { enabled: override, source: "org" };
    }
    return out;
  }

  /** Flat map for clients that just need on/off (session payload, nav gating). */
  async resolveFeatureFlagsFlat(orgId: string): Promise<Record<string, boolean>> {
    const resolved = await this.resolveFeatureFlags(orgId);
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(resolved)) out[k] = v.enabled;
    return out;
  }

  /** Single-feature check — the guard's hot path. */
  async isFeatureEnabled(feature: string, orgId: string | null): Promise<boolean> {
    const { featureFlags } = await this.getSettingsCached();
    if (featureFlags[feature] === false) return false; // kill switch
    if (!orgId) return true; // no tenant context — global decides
    const overrides = await this.orgOverrides(orgId);
    return overrides[feature] ?? true;
  }

  /** Set (or clear) one org's override. Passing null removes it → inherit global. */
  async setOrgFeature(input: { orgId: string; feature: string; enabled: boolean | null; reason?: string; updatedBy?: string }) {
    if (!this.isKnownFeature(input.feature)) {
      throw new Error(`Unknown feature "${input.feature}".`);
    }
    if (input.enabled === null) {
      await this.prisma.orgFeatureFlag.deleteMany({ where: { orgId: input.orgId, feature: input.feature } });
    } else {
      await this.prisma.orgFeatureFlag.upsert({
        where: { orgId_feature: { orgId: input.orgId, feature: input.feature } },
        create: { orgId: input.orgId, feature: input.feature, enabled: input.enabled, reason: input.reason ?? null, updatedBy: input.updatedBy ?? null },
        update: { enabled: input.enabled, reason: input.reason ?? null, updatedBy: input.updatedBy ?? null },
      });
    }
    // Invalidate immediately: a flag change must take effect on the next request,
    // not after a TTL. (The permission cache's TTL-only invalidation is a known
    // trap — an admin toggling a flag and seeing nothing happen would be worse.)
    this.orgCache.delete(input.orgId);
  }

  /** Drop cached overrides for an org (or all orgs). */
  invalidateOrg(orgId?: string): void {
    if (orgId) this.orgCache.delete(orgId);
    else this.orgCache.clear();
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
