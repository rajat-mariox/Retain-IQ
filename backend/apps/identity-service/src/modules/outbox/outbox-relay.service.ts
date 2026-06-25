import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { Prisma } from "@retainiq/database/identity";
import { BrokerService } from "../../common/messaging/broker.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { metrics } from "../../common/observability/observability.js";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2000;

type OutboxRow = { id: string; topic: string; payload: unknown; attempts: number };

/**
 * Transactional outbox relay. Each tick atomically claims a batch of PENDING
 * rows with `FOR UPDATE SKIP LOCKED` (so multiple identity-service replicas never grab
 * the same rows), publishes them to the broker, and marks them PUBLISHED —
 * all in one transaction. Failures retry with backoff and park as FAILED after
 * MAX_ATTEMPTS. Delivery is at-least-once; consumers are idempotent.
 */
@Injectable()
export class OutboxRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly pendingGauge = metrics.gauge("outbox_pending_events", "Outbox events awaiting publish.");
  private readonly publishedCounter = metrics.counter("outbox_published_total", "Outbox events published.");
  private running = false;
  private destroyed = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly broker: BrokerService,
  ) {}

  onModuleDestroy(): void {
    this.destroyed = true;
  }

  @Interval(2000)
  async flush(): Promise<void> {
    if (this.running || this.destroyed) {
      return; // Avoid overlapping runs / publishing during shutdown.
    }
    this.running = true;
    try {
      await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, topic, payload, attempts
          FROM "OutboxEvent"
          WHERE status = 'PENDING' AND "nextRunAt" <= now()
          ORDER BY "createdAt" ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED`;

        for (const row of rows) {
          await this.publishOne(tx, row);
        }
      });

      await this.updatePendingGauge();
    } catch (error) {
      this.logger.warn(`Outbox flush failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async publishOne(tx: Prisma.TransactionClient, row: OutboxRow): Promise<void> {
    try {
      await this.broker.publish(row.topic, row.payload as Record<string, unknown>);
      await tx.outboxEvent.update({
        where: { id: row.id },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      });
      this.publishedCounter.inc();
    } catch (error) {
      const attempts = row.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      this.logger.warn(`Outbox publish failed for ${row.id} (attempt ${attempts}): ${String(error)}`);
      await tx.outboxEvent.update({
        where: { id: row.id },
        data: failed
          ? { status: "FAILED", attempts }
          : { attempts, nextRunAt: new Date(Date.now() + BASE_BACKOFF_MS * attempts) },
      });
    }
  }

  private async updatePendingGauge(): Promise<void> {
    try {
      const pending = await this.prisma.outboxEvent.count({ where: { status: "PENDING" } });
      this.pendingGauge.set(pending);
    } catch {
      // Metrics must never break the relay.
    }
  }
}
