import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { STREAMS, type EventConsumer } from "@retainiq/messaging";
import { PlatformSettingsService } from "../../common/settings/platform-settings.service.js";
import { EntitlementService } from "../../common/entitlement/entitlement.service.js";
import { BrokerService } from "../../common/messaging/broker.service.js";

/**
 * Subscribes to the cross-service domain-event stream and busts identity's
 * cached plan features when a subscription/plan changes in billing-service — so
 * a plan upgrade/downgrade takes effect within moments rather than after the
 * plan-cache TTL. Plan changes originate in billing (a different service), so
 * this event consumer is identity's only prompt signal that entitlements moved.
 *
 * Best-effort: cache invalidation is idempotent and non-critical (the TTL
 * self-heals anyway), so delivery is fire-and-forget — we never park/DLQ.
 */
@Injectable()
export class PlanCacheSyncService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PlanCacheSyncService.name);
  private consumer?: EventConsumer;

  // Events that change what an org's plan grants (or whether it's billable).
  private static readonly PLAN_EVENTS = new Set([
    "subscription.plan_changed",
    "subscription.seats_changed",
    "subscription.created",
    "organization.suspended",
    "organization.reactivated",
    "organization.deleted",
  ]);

  constructor(
    private readonly broker: BrokerService,
    private readonly settings: PlatformSettingsService,
    private readonly entitlements: EntitlementService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.consumer = this.broker.consumer({
      stream: STREAMS.domainEvents,
      group: "identity-plan-cache",
      consumer: "identity-plan-cache-1",
    });
    // Run in the background; don't block bootstrap on the consumer loop.
    void this.consumer.run(async ({ event }) => {
      const type = typeof event.eventType === "string" ? event.eventType : "";
      if (!PlanCacheSyncService.PLAN_EVENTS.has(type)) return;
      const orgId =
        typeof event.orgId === "string"
          ? event.orgId
          : typeof (event.payload as { orgId?: unknown })?.orgId === "string"
            ? (event.payload as { orgId: string }).orgId
            : null;
      if (!orgId) return;
      this.settings.invalidatePlan(orgId);
      this.entitlements.invalidate(orgId);
      this.logger.debug(`Busted plan + entitlement cache for org ${orgId} (${type})`);
    }).catch((err) => this.logger.error(`plan-cache consumer failed: ${String(err)}`));
  }

  async onApplicationShutdown(): Promise<void> {
    this.consumer?.stop();
  }
}
