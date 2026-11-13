import { Injectable } from "@nestjs/common";
import { BillingReadPrismaService } from "../database/billing-prisma.service.js";
import { PlatformSettingsService } from "../settings/platform-settings.service.js";

/** A resolved feature limit: the ceiling and how it's metered. */
export interface FeatureLimit {
  /** Numeric ceiling; null = the feature is granted but unmetered (unlimited). */
  limitValue: number | null;
  /** "monthly" | "daily" | "total" | "concurrent" | null (when unmetered). */
  limitType: string | null;
}

const LIMIT_CACHE_TTL_MS = 15_000;

/**
 * The single place the app asks "is this org allowed to use X, and how much of it?".
 *
 * Access (boolean) still resolves through the existing plan-feature layer
 * (PlatformSettingsService, backed by Plan.features[] + kill-switch + org
 * overrides) — so the 18 @RequireFeature gates keep working unchanged and there's
 * no second source of truth for whether a feature is ON.
 *
 * Limits (quotas) are the new dimension: read from the PlanFeature table in
 * billing-db (per plan, per feature code), cached briefly. `can()` and `getLimit()`
 * are the spec's centralized entitlement API — call these instead of scattering
 * plan-name checks through the codebase.
 */
@Injectable()
export class EntitlementService {
  private limitCache = new Map<string, { at: number; value: Map<string, FeatureLimit> }>();

  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly billing: BillingReadPrismaService,
  ) {}

  /**
   * Can this org use a feature right now? Delegates to the resolved feature flags
   * (kill-switch → plan → org override), so it agrees with the @RequireFeature
   * guard. `featureFlag` is a flag key (e.g. "aiInsights"), not a plan-catalog code.
   */
  async can(orgId: string, featureFlag: string): Promise<boolean> {
    return this.settings.isFeatureEnabled(featureFlag, orgId);
  }

  /**
   * The org's limit for a feature CODE (the plan-catalog code, e.g. "api_calls"),
   * or null when the plan sets no limit (unmetered / unlimited). Does NOT check
   * access — pair with `can()` when you need both. Reads the org's plan, then that
   * plan's PlanFeature row for the code.
   */
  async getLimit(orgId: string, featureCode: string): Promise<FeatureLimit | null> {
    const limits = await this.planLimits(orgId);
    return limits.get(featureCode) ?? null;
  }

  /**
   * Convenience: is the org within a limit given its current usage? Returns true
   * when unmetered/unlimited or usage < limit; false when usage would meet/exceed
   * the ceiling. `atOrAbove` mirrors seat-limit semantics (>= limit blocks).
   */
  async withinLimit(orgId: string, featureCode: string, currentUsage: number): Promise<boolean> {
    const limit = await this.getLimit(orgId, featureCode);
    if (!limit || limit.limitValue == null) return true; // unmetered
    return currentUsage < limit.limitValue;
  }

  /**
   * The org's full entitlement picture: every resolved feature flag (on/off +
   * where the decision came from) plus any per-feature limits. This is what a
   * `GET /entitlements` endpoint returns — one call for the whole client to know
   * what it may show and how much of each metered feature is allowed.
   */
  async getEntitlements(orgId: string): Promise<{
    features: Record<string, { enabled: boolean; source: string }>;
    limits: Record<string, FeatureLimit>;
  }> {
    const [features, limitMap] = await Promise.all([
      this.settings.resolveFeatureFlags(orgId),
      this.planLimits(orgId),
    ]);
    return { features, limits: Object.fromEntries(limitMap) };
  }

  /** Drop cached limits for an org (or all). Called on plan/subscription change. */
  invalidate(orgId?: string): void {
    if (orgId) this.limitCache.delete(orgId);
    else this.limitCache.clear();
  }

  /**
   * All limits for the org's current plan, code → FeatureLimit, cached briefly.
   * Fail-safe: on a billing-db error serve last-known-good, else empty (no limits
   * = unlimited) so an outage never wrongly blocks a feature the org has access to.
   */
  private async planLimits(orgId: string): Promise<Map<string, FeatureLimit>> {
    const hit = this.limitCache.get(orgId);
    if (hit && Date.now() - hit.at < LIMIT_CACHE_TTL_MS) return hit.value;

    try {
      const sub = await this.billing.subscription.findUnique({
        where: { orgId },
        select: { planId: true },
      });
      const value = new Map<string, FeatureLimit>();
      if (sub) {
        const rows = await this.billing.planFeature.findMany({
          where: { planId: sub.planId },
          select: { featureCode: true, limitValue: true, limitType: true },
        });
        for (const r of rows) value.set(r.featureCode, { limitValue: r.limitValue, limitType: r.limitType });
      }
      this.limitCache.set(orgId, { at: Date.now(), value });
      return value;
    } catch {
      if (hit) return hit.value;
      return new Map<string, FeatureLimit>();
    }
  }
}
