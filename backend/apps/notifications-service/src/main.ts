import "@retainiq/config/env"; // load .env for host/dev runs (no-op in prod) — must be first
import { parseKafkaBrokers } from "@retainiq/config";
import { PrismaClient } from "@retainiq/database/notifications";
import {
  createBroker,
  RedisRealtimeBus,
  STREAMS,
  userNotificationChannel,
  type RealtimeBus,
  type StreamMessage,
} from "@retainiq/messaging";
import { createLogger, createMetrics, installProcessErrorHandlers, startOpsServer } from "@retainiq/observability";
import { dispatch } from "./channels.js";
import { loadNotificationsConfig } from "./config.js";
import { resolveRecipients } from "./recipients.js";
import { rulesFor, type Channel } from "./rules.js";

const config = loadNotificationsConfig();
const logger = createLogger("notifications-service", config.LOG_LEVEL);
const metrics = createMetrics("notifications-service");
const created = metrics.counter("notifications_created_total", "Notifications created.", ["channel"]);
const deferred = metrics.counter("notifications_deferred_total", "Notifications deferred (quiet hours).", ["channel"]);

const prisma = new PrismaClient();

const broker = createBroker({
  driver: config.BROKER_DRIVER,
  clientId: "notifications-service",
  redisUrl: config.REDIS_URL,
  kafkaBrokers: parseKafkaBrokers(config.KAFKA_BROKERS),
  logger,
});

// Real-time fan-out bus (Redis Pub/Sub) for live SSE delivery. Best-effort:
// if REDIS_URL is unset, in-app rows are still persisted, just not pushed live.
const realtime: RealtimeBus | null = config.REDIS_URL
  ? new RedisRealtimeBus(config.REDIS_URL, logger)
  : null;

installProcessErrorHandlers(logger);

async function handle(message: StreamMessage): Promise<void> {
  const event = message.event;
  const eventId = asString(event.eventId);
  const eventType = asString(event.eventType);
  const orgId = asString(event.orgId);
  if (!eventId || !eventType || !orgId) {
    return;
  }

  // Maintain the local recipient read model from identity membership events.
  if (eventType === "org.member.upserted") {
    await projectMember(orgId, isRecord(event.payload) ? event.payload : {});
    return; // projection only -> ack
  }

  const specs = rulesFor(eventType);
  if (specs.length === 0) {
    return; // no rule -> ack and ignore
  }

  const payload = isRecord(event.payload) ? event.payload : {};
  const quietHours = { start: config.QUIET_HOURS_START, end: config.QUIET_HOURS_END, now: new Date().getHours() };

  for (const spec of specs) {
    const recipients = await resolveRecipients(prisma, orgId, spec.audience, payload);
    for (const recipientUserId of recipients) {
      for (const channel of spec.channels) {
        await deliver({
          eventId,
          orgId,
          recipientUserId,
          channel,
          spec: { type: spec.type, title: spec.title(payload), body: spec.body(payload) },
          quietHours,
        });
      }
    }
  }
}

/**
 * Upserts the local OrgRecipient read model from an `org.member.upserted` event.
 * Idempotent on (orgId, userId); a redelivery just rewrites the same row.
 */
async function projectMember(orgId: string, payload: Record<string, unknown>): Promise<void> {
  const userId = asString(payload.userId);
  const roleName = asString(payload.roleName);
  const status = asString(payload.status) ?? "ACTIVE";
  if (!userId || !roleName) {
    return;
  }

  await prisma.orgRecipient.upsert({
    where: { orgId_userId: { orgId, userId } },
    create: { orgId, userId, roleName, status },
    update: { roleName, status, updatedAt: new Date() },
  });
}

async function deliver(args: {
  eventId: string;
  orgId: string;
  recipientUserId: string;
  channel: Channel;
  spec: { type: string; title: string; body: string };
  quietHours: { start: number; end: number; now: number };
}): Promise<void> {
  const dedupeKey = `${args.eventId}:${args.spec.type}:${args.recipientUserId}:${args.channel}`;

  // Idempotent: find-or-create the delivery row, retry only if still PENDING.
  let notification = await prisma.notification.findUnique({ where: { dedupeKey } });
  if (!notification) {
    try {
      notification = await prisma.notification.create({
        data: {
          orgId: args.orgId,
          recipientUserId: args.recipientUserId,
          channel: args.channel,
          type: args.spec.type,
          title: args.spec.title,
          body: args.spec.body,
          dedupeKey,
          sourceEventId: args.eventId,
        },
      });
      created.inc({ channel: args.channel });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      notification = await prisma.notification.findUnique({ where: { dedupeKey } });
    }
  }
  if (!notification || notification.status !== "PENDING") {
    return; // already delivered/deferred-handled
  }

  const outcome = dispatch({
    channel: args.channel,
    recipientUserId: args.recipientUserId,
    title: args.spec.title,
    body: args.spec.body,
    logger,
    quietHours: args.quietHours,
  });
  if (outcome.status === "DEFERRED") {
    deferred.inc({ channel: args.channel });
  }

  await prisma.notification.update({
    where: { id: notification.id },
    data: { status: outcome.status, sentAt: outcome.sentAt },
  });

  // Push IN_APP notifications to any live SSE/WebSocket clients (best-effort).
  if (args.channel === "IN_APP" && outcome.status === "SENT" && realtime) {
    await realtime.publish(userNotificationChannel(args.recipientUserId), {
      id: notification.id,
      type: args.spec.type,
      title: args.spec.title,
      body: args.spec.body,
      createdAt: notification.createdAt.toISOString(),
    });
  }
}

async function main(): Promise<void> {
  await prisma.$connect();
  await broker.init();

  const consumer = broker.consumer({
    stream: STREAMS.domainEvents,
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
    logger.info({ signal }, "Shutting down notifications-service...");
    consumer.stop();
    opsServer.close();
    void Promise.race([runPromise, delay(8000)])
      .then(() => broker.close())
      .then(() => realtime?.close())
      .then(() => prisma.$disconnect())
      .finally(() => process.exit(0));
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info(
    { stream: STREAMS.domainEvents, group: config.CONSUMER_GROUP, healthPort: config.HEALTH_PORT, broker: config.BROKER_DRIVER },
    "notifications-service started",
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
  logger.error({ err: String(error) }, "notifications-service crashed");
  process.exit(1);
});
