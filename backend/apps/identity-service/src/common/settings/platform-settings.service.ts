import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { BillingReadPrismaService } from "../database/billing-prisma.service.js";
import type { FeatureFlags, GlobalNotification, MaintenanceMode, PlatformBranding, PlatformSettings } from "../../modules/platform-admin/admin.dto.js";

const SECTIONS = ["branding", "notification", "featureFlags", "maintenance"] as const;
const CACHE_TTL_MS = 15_000; // guards read this per-request — cache to spare the DB
const ORG_CACHE_TTL_MS = 15_000; // per-org overrides, same hot path as the guard
const PLAN_CACHE_TTL_MS = 15_000; // an org's plan features — same hot path

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
    // Super-admin console modules — global-only, not per-tenant.
    customerSuccess: true,
    platformHealth: true,
    // Tenant product features — a super-admin can turn these on/off per org.
    activityFeed: true,
    timeTracking: true,
    attendance: true,
    leave: true,
    projects: true,
    screenshots: true,
    payroll: true,
    monitoring: true,
    recruitment: true,
    aiInsights: true,
    billing: true,
  },
  maintenance: { enabled: false, message: "We're performing scheduled maintenance. Please check back shortly." },
};

/**
 * What each feature is and where it applies.
 *
 *  scope — "tenant" features are toggled per-org; "adminConsole" ones are
 *          super-admin modules, global-only. The per-org "Feature access"
 *          screen shows only tenant ones.
 *  tier  — "baseline" features are included in every plan; "premium" ones are
 *          unlocked by the org's subscription plan. `planFeature` is the key the
 *          plan catalog uses for that premium feature (the plan and the flag are
 *          named differently, so this is the bridge between the two).
 *
 * A premium feature is available to an org only if its plan lists the matching
 * planFeature — that's how the subscription actually gates access.
 */
export type FeatureScope = "tenant" | "adminConsole";
export type FeatureTier = "baseline" | "premium";
export const FEATURE_META: Record<string, { scope: FeatureScope; label: string; tier: FeatureTier; planFeature?: string }> = {
  customerSuccess: { scope: "adminConsole", label: "Customer Success", tier: "baseline" },
  platformHealth: { scope: "adminConsole", label: "Platform Health", tier: "baseline" },
  activityFeed: { scope: "tenant", label: "Activity Feed", tier: "baseline" },
  attendance: { scope: "tenant", label: "Attendance", tier: "baseline" },
  leave: { scope: "tenant", label: "Leave", tier: "baseline" },
  projects: { scope: "tenant", label: "Projects & Teams", tier: "baseline" },
  screenshots: { scope: "tenant", label: "Screenshots", tier: "baseline" },
  payroll: { scope: "tenant", label: "Payroll", tier: "baseline" },
  billing: { scope: "tenant", label: "Billing", tier: "baseline" },
  // Premium — unlocked by the subscription plan (plan-catalog keys on the right).
  timeTracking: { scope: "tenant", label: "Time Tracking", tier: "premium", planFeature: "time_tracking" },
  aiInsights: { scope: "tenant", label: "AI Insights", tier: "premium", planFeature: "ai_analytics" },
  monitoring: { scope: "tenant", label: "Employee Monitoring", tier: "premium", planFeature: "monitoring" },
  // One flag for the whole premium HR suite: hiring/ATS, onboarding, performance
  // and HR analytics. Only the core Employees directory stays outside it.
  recruitment: { scope: "tenant", label: "HR Suite (Hiring, Onboarding, Performance)", tier: "premium", planFeature: "recruitment" },
};

/** One feature's state for one org, plus where the decision came from. */
export interface ResolvedFlag {
  enabled: boolean;
  /**
   * Why the feature is in this state:
   *  "global"      — inherited from the platform default
   *  "org"         — a per-org override decided it
   *  "kill_switch" — global OFF, outranks everything
   *  "plan"        — off because the org's subscription plan doesn't include it
   */
  source: "global" | "org" | "kill_switch" | "plan";
}

@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingReadPrismaService,
  ) {}

  private cache: { at: number; value: PlatformSettings } | null = null;
  /** Per-org overrides, keyed by orgId. Invalidated on write — never left to expire. */
  private orgCache = new Map<string, { at: number; value: Record<string, boolean> }>();
  /** An org's plan feature keys (from its subscription), keyed by orgId. */
  private planCache = new Map<string, { at: number; value: Set<string> }>();

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

  /** The canonical feature list. */
  featureKeys(): string[] {
    return Object.keys(DEFAULTS.featureFlags);
  }

  /** Only the features that make sense to toggle per organization. */
  tenantFeatureKeys(): string[] {
    return this.featureKeys().filter((f) => FEATURE_META[f]?.scope === "tenant");
  }

  isKnownFeature(feature: string): boolean {
    return feature in DEFAULTS.featureFlags;
  }

  /** True only for features that may be overridden for a single org. */
  isTenantFeature(feature: string): boolean {
    return FEATURE_META[feature]?.scope === "tenant";
  }

  /**
   * The plan-feature keys an org's subscription includes (e.g. "time_tracking",
   * "ai_analytics"). Empty when the org has no subscription — then only baseline
   * features are available. Read-only from billing-db, cached. On a billing-db
   * error it fails OPEN by returning EVERY known plan feature, so a transient
   * outage never strips premium modules an org has paid for.
   */
  private async orgPlanFeatures(orgId: string): Promise<Set<string>> {
    const hit = this.planCache.get(orgId);
    if (hit && Date.now() - hit.at < PLAN_CACHE_TTL_MS) return hit.value;

    let value = new Set<string>();
    try {
      const sub = await this.billing.subscription.findUnique({
        where: { orgId },
        select: { plan: { select: { features: true } } },
      });
      value = new Set(sub?.plan?.features ?? []);
    } catch {
      // billing-db unreachable — don't strip premium features on a transient error.
      value = new Set(Object.values(FEATURE_META).map((m) => m.planFeature).filter((x): x is string => Boolean(x)));
    }
    this.planCache.set(orgId, { at: Date.now(), value });
    return value;
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
   * Resolve every feature for one org. Precedence, highest first:
   *
   *   global OFF   → off for everyone (emergency kill switch); nothing re-enables it.
   *   plan         → a PREMIUM feature the org's plan doesn't include is off, and
   *                  a per-org override can't re-enable it — you can't turn on
   *                  what the subscription doesn't grant. Baseline features skip
   *                  this check (every plan has them).
   *   org override → within what's allowed, the per-org toggle decides.
   *   global ON    → no override means inherit ON.
   */
  async resolveFeatureFlags(orgId: string): Promise<Record<string, ResolvedFlag>> {
    const [{ featureFlags }, overrides, planFeatures] = await Promise.all([
      this.getSettingsCached(),
      this.orgOverrides(orgId),
      this.orgPlanFeatures(orgId),
    ]);
    const out: Record<string, ResolvedFlag> = {};
    for (const [feature, globalOn] of Object.entries(featureFlags)) {
      if (globalOn === false) {
        out[feature] = { enabled: false, source: "kill_switch" };
        continue;
      }
      // Premium features need the plan to include them; the plan gate outranks
      // an org override so a super-admin can't hand out an unpurchased feature.
      const meta = FEATURE_META[feature];
      if (meta?.tier === "premium" && meta.planFeature && !planFeatures.has(meta.planFeature)) {
        out[feature] = { enabled: false, source: "plan" };
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
    // A premium feature the org's plan doesn't include stays off regardless of
    // any override — same rule as resolveFeatureFlags, kept here for the guard's
    // hot path.
    const meta = FEATURE_META[feature];
    if (meta?.tier === "premium" && meta.planFeature) {
      const planFeatures = await this.orgPlanFeatures(orgId);
      if (!planFeatures.has(meta.planFeature)) return false;
    }
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
