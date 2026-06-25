import "@retainiq/config/env"; // load .env for host/dev runs (no-op in prod) — must be first
import { parseKafkaBrokers } from "@retainiq/config";
import { PrismaClient } from "@retainiq/database/inbox";
import type { Prisma } from "@retainiq/database/inbox";
import { createBroker, STREAMS, type StreamMessage, type StreamName } from "@retainiq/messaging";
import {
  createLogger,
  createMetrics,
  installProcessErrorHandlers,
  startOpsServer,
} from "@retainiq/observability";
import { loadWorkerConfig } from "./config.js";

const config = loadWorkerConfig();
const logger = createLogger("events-worker", config.LOG_LEVEL);
const metrics = createMetrics("events-worker");
const eventsConsumed = metrics.counter("worker_events_consumed_total", "Events consumed.", ["stream"]);
const eventsDuplicate = metrics.counter("worker_events_duplicate_total", "Duplicate (already-consumed) events skipped.", ["stream"]);

const prisma = new PrismaClient();
const SUBSCRIBED_STREAMS: StreamName[] = [STREAMS.domainEvents, STREAMS.activity];

const broker = createBroker({
  driver: config.BROKER_DRIVER,
  clientId: "events-worker",
  redisUrl: config.REDIS_URL,
  kafkaBrokers: parseKafkaBrokers(config.KAFKA_BROKERS),
  logger,
});

installProcessErrorHandlers(logger);

function buildHandler(stream: StreamName) {
  return async (message: StreamMessage): Promise<void> => {
    const event = message.event;
    const eventId = typeof event.eventId === "string" ? event.eventId : null;
    if (!eventId) {
      logger.warn({ stream, id: message.id }, "Dropping event without eventId");
      return; // ack: unprocessable but not retryable
    }

    const eventType = typeof event.eventType === "string" ? event.eventType : "unknown";
    const orgId = typeof event.orgId === "string" ? event.orgId : null;

    try {
      await prisma.consumedEvent.create({
        data: {
          eventId,
          consumer: config.CONSUMER_GROUP,
          stream,
          eventType,
          orgId,
          payload: event as Prisma.InputJsonValue,
        },
      });
      eventsConsumed.inc({ stream });
      logger.info({ stream, eventId, eventType, orgId }, "Event consumed");
    } catch (error) {
      if (isUniqueViolation(error)) {
        eventsDuplicate.inc({ stream });
        return; // idempotent skip + ack
      }
      throw error; // real failure: stay pending -> reclaim -> DLQ after maxDeliveries
    }
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

async function main(): Promise<void> {
  await prisma.$connect();

  await broker.init();

  const consumers = SUBSCRIBED_STREAMS.map((stream) =>
    broker.consumer({
      stream,
      group: config.CONSUMER_GROUP,
      consumer: config.CONSUMER_NAME,
      maxDeliveries: config.MAX_DELIVERIES,
      reclaimMinIdleMs: config.RECLAIM_MIN_IDLE_MS,
      logger,
    }),
  );

  const opsServer = startOpsServer({
    port: config.HEALTH_PORT,
    logger,
    metrics,
    readiness: async () => {
      await prisma.$queryRaw`SELECT 1`;
      await broker.ping();
      return true;
    },
  });

  const runPromises = consumers.map((c, i) => c.run(buildHandler(SUBSCRIBED_STREAMS[i]!)));

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down events-worker");
    for (const consumer of consumers) {
      consumer.stop();
    }
    opsServer.close();
    // Let in-flight consumer loops finish (bounded), then close cleanly.
    void Promise.race([Promise.allSettled(runPromises), delay(8000)])
      .then(() => broker.close())
      .then(() => prisma.$disconnect())
      .finally(() => process.exit(0));
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info(
    { streams: SUBSCRIBED_STREAMS, group: config.CONSUMER_GROUP, healthPort: config.HEALTH_PORT, broker: config.BROKER_DRIVER },
    "events-worker started",
  );

  await Promise.all(runPromises);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  logger.error({ err: String(error) }, "events-worker crashed");
  process.exit(1);
});
