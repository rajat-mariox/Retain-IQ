import "@retainiq/config/env"; // load .env for host/dev runs (no-op in prod) — must be first
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { parseKafkaBrokers } from "@retainiq/config";
import { PrismaClient } from "@retainiq/database/analytics";
import type { Prisma } from "@retainiq/database/analytics";
import { createBroker, STREAMS, type StreamMessage } from "@retainiq/messaging";
import { createLogger, createMetrics, installProcessErrorHandlers, startOpsServer } from "@retainiq/observability";
import { Piscina } from "piscina";
import { loadAnalyticsConfig } from "./config.js";
import { deriveDelta, type ScoreInput, type ScoreOutput } from "./scoring.js";
import { persistDetail } from "./readmodel.js";

const config = loadAnalyticsConfig();
const logger = createLogger("analytics-worker", config.LOG_LEVEL);
const metrics = createMetrics("analytics-worker");
const factsUpdated = metrics.counter("analytics_facts_updated_total", "Employee day-facts upserted.");
const duplicates = metrics.counter("analytics_events_duplicate_total", "Duplicate activity events skipped.");
const scoringSeconds = metrics.gauge("analytics_last_scoring_seconds", "Duration of the last scoring task.");

const prisma = new PrismaClient();

const broker = createBroker({
  driver: config.BROKER_DRIVER,
  clientId: "analytics-worker",
  redisUrl: config.REDIS_URL,
  kafkaBrokers: parseKafkaBrokers(config.KAFKA_BROKERS),
  logger,
});

installProcessErrorHandlers(logger);

// worker_threads pool for CPU-bound scoring (keeps the consumer loop unblocked).
const pool = new Piscina({
  filename: fileURLToPath(new URL("./score.task.js", import.meta.url)),
  maxThreads: config.SCORING_THREADS ?? Math.max(1, cpus().length - 1),
});

async function handle(message: StreamMessage): Promise<void> {
  const event = message.event;
  const eventId = asString(event.eventId);
  const orgId = asString(event.orgId);
  const employeeId = asString(event.employeeId);
  // Activity not attributed to an employee can't be scored — ack and skip.
  if (!eventId || !orgId || !employeeId) {
    return;
  }

  const eventType = asString(event.eventType) ?? "unknown";
  const occurredAt = asString(event.occurredAt) ?? new Date().toISOString();
  const day = new Date(occurredAt.slice(0, 10));
  const payload = isRecord(event.payload) ? event.payload : {};
  const delta = deriveDelta(eventType, payload);

  // Idempotent apply: record the event in the inbox AND increment counters in
  // one transaction. A redelivered event hits the unique (eventId, consumer)
  // constraint, the tx rolls back, and counters are not double-applied.
  let totals;
  try {
    totals = await prisma.$transaction(async (tx) => {
      await tx.consumedEvent.create({
        data: {
          eventId,
          consumer: config.CONSUMER_GROUP,
          stream: STREAMS.activity,
          eventType,
          orgId,
          payload: event as Prisma.InputJsonValue,
        },
      });
      const fact = await tx.employeeDayFact.upsert({
        where: { orgId_employeeId_day: { orgId, employeeId, day } },
        create: { orgId, employeeId, day, ...delta },
        update: {
          activeSeconds: { increment: delta.activeSeconds },
          idleSeconds: { increment: delta.idleSeconds },
          productiveSeconds: { increment: delta.productiveSeconds },
          eventCount: { increment: delta.eventCount },
        },
      });

      // Persist the monitoring detail (sessions, app/site usage, timeline) in the
      // same idempotent transaction so it can't diverge from the day-fact.
      if (eventType.startsWith("activity.")) {
        await persistDetail(tx, {
          orgId,
          employeeId,
          day,
          occurredAt: new Date(occurredAt),
          eventType,
          sourceEventId: asString(event.sourceEventId),
          payload,
        });
      }

      return fact;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      duplicates.inc();
      return; // already applied
    }
    throw error; // real failure -> stays pending -> reclaim/DLQ
  }

  // Offload scoring to the thread pool, then persist the scores.
  const started = process.hrtime.bigint();
  const scores = (await pool.run({
    activeSeconds: totals.activeSeconds,
    idleSeconds: totals.idleSeconds,
    productiveSeconds: totals.productiveSeconds,
    eventCount: totals.eventCount,
  } satisfies ScoreInput)) as ScoreOutput;
  scoringSeconds.set(Number(process.hrtime.bigint() - started) / 1e9);

  await prisma.employeeDayFact.update({
    where: { orgId_employeeId_day: { orgId, employeeId, day } },
    data: { productivityScore: scores.productivityScore, focusScore: scores.focusScore },
  });
  factsUpdated.inc();
  logger.info(
    { orgId, employeeId, day: occurredAt.slice(0, 10), ...scores },
    "employee day-fact scored",
  );
}

async function main(): Promise<void> {
  await prisma.$connect();
  await broker.init();

  const consumer = broker.consumer({
    stream: STREAMS.activity,
    group: config.CONSUMER_GROUP,
    consumer: config.CONSUMER_NAME,
    maxDeliveries: config.MAX_DELIVERIES,
    reclaimMinIdleMs: config.RECLAIM_MIN_IDLE_MS,
    logger,
  });

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

  const runPromise = consumer.run(handle);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down analytics-worker");
    consumer.stop();
    opsServer.close();
    void Promise.race([runPromise, delay(8000)])
      .then(() => pool.destroy())
      .then(() => broker.close())
      .then(() => prisma.$disconnect())
      .finally(() => process.exit(0));
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info(
    { stream: STREAMS.activity, group: config.CONSUMER_GROUP, threads: pool.threads.length, healthPort: config.HEALTH_PORT, broker: config.BROKER_DRIVER },
    "analytics-worker started",
  );

  await runPromise;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  logger.error({ err: String(error) }, "analytics-worker crashed");
  process.exit(1);
});
