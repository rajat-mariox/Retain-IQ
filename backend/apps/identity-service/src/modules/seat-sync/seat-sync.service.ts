import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { STREAMS } from "@retainiq/messaging";
import { PrismaService } from "../../common/database/prisma.service.js";
import { BrokerService } from "../../common/messaging/broker.service.js";

const RECONCILE_INTERVAL_MS = 15 * 60 * 1000; // 15 min

/**
 * Keeps billing's Subscription.activeSeats in sync with reality. identity owns
 * the Employee data, so it counts active employees per org and emits an
 * `organization.headcount` event; billing-service consumes it and updates its
 * own activeSeats (capped at the licensed seats). Runs on boot + on an interval,
 * so it self-heals drift and covers orgs seeded before the feature existed.
 */
@Injectable()
export class SeatSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeatSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly broker: BrokerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.reconcile().catch((err) => this.logger.error(`seat reconcile (boot) failed: ${String(err)}`));
  }

  @Interval(RECONCILE_INTERVAL_MS)
  async scheduled(): Promise<void> {
    await this.reconcile().catch((err) => this.logger.error(`seat reconcile failed: ${String(err)}`));
  }

  /** Publish the live active-employee headcount for every org. */
  async reconcile(): Promise<void> {
    const orgs = await this.prisma.organization.findMany({ where: { status: { not: "DELETED" } }, select: { id: true } });
    if (orgs.length === 0) return;

    const counts = await this.prisma.employee.groupBy({ by: ["orgId"], where: { status: "ACTIVE" }, _count: { _all: true } });
    const byOrg = new Map(counts.map((c) => [c.orgId, c._count._all]));

    for (const o of orgs) {
      await this.broker.publish(STREAMS.domainEvents, {
        eventType: "organization.headcount",
        orgId: o.id,
        payload: { activeEmployees: byOrg.get(o.id) ?? 0 },
      });
    }
    this.logger.log(`Published active-employee headcount for ${orgs.length} orgs`);
  }
}
