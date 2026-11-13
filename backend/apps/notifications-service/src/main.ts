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
import { runDigestSweep } from "./digest.js";
import { EmailSender } from "./email.js";
import { PushSender } from "./push.js";
import { hourInTimezone, resolvePreferences } from "./preferences.js";
import { resolveRecipients } from "./recipients.js";
import { rulesFor, type Category, type Channel, type Priority } from "./rules.js";

const config = loadNotificationsConfig();
const logger = createLogger("notifications-service", config.LOG_LEVEL);
const metrics = createMetrics("notifications-service");
const created = metrics.counter("notifications_created_total", "Notifications created.", ["channel"]);
const deferred = metrics.counter("notifications_deferred_total", "Notifications deferred (quiet hours).", ["channel"]);

const prisma = new PrismaClient();

const emailSender = new EmailSender(
  {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    user: config.SMTP_USER,
    pass: config.SMTP_PASS,
    from: config.MAIL_FROM,
    appUrl: config.APP_URL,
  },
  logger,
);
const pushSender = new PushSender(
  { publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, subject: config.VAPID_SUBJECT },
  prisma,
  logger,
);

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
  // A rule may carry a file attachment in its payload (e.g. a scheduled report's
  // CSV as { reportCsv: { filename, content } }). Only EMAIL uses it.
  const attachments = extractAttachments(payload);

  for (const spec of specs) {
    const recipients = await resolveRecipients(prisma, orgId, spec.audience, payload);
    for (const recipientUserId of recipients) {
      // Narrow the rule's channels by what this recipient actually opted into,
      // and evaluate quiet hours in *their* timezone (falling back to the
      // service-wide window when they've not configured one).
      const prefs = await resolvePreferences(prisma, orgId, recipientUserId, spec.category);
      const quietHours = prefs.quiet.enabled
        ? { start: prefs.quiet.start, end: prefs.quiet.end, now: hourInTimezone(prefs.quiet.timezone) }
        : { start: config.QUIET_HOURS_START, end: config.QUIET_HOURS_END, now: new Date().getUTCHours() };

      for (const channel of spec.channels) {
        if (!prefs.allowed.has(channel)) continue; // opted out of this channel
        await deliver({
          eventId,
          orgId,
          recipientUserId,
          channel,
          spec: {
            type: spec.type,
            title: spec.title(payload),
            body: spec.body(payload),
            category: spec.category,
            priority: spec.priority,
            link: spec.link ? spec.link(payload) : null,
          },
          quietHours,
          attachments,
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
  const email = asString(payload.email);
  const name = asString(payload.name);

  await prisma.orgRecipient.upsert({
    where: { orgId_userId: { orgId, userId } },
    create: { orgId, userId, roleName, status, email, name },
    // Don't blank an existing email if a later event omits it.
    update: { roleName, status, updatedAt: new Date(), ...(email ? { email } : {}), ...(name ? { name } : {}) },
  });
}

async function deliver(args: {
  eventId: string;
  orgId: string;
  recipientUserId: string;
  channel: Channel;
  spec: { type: string; title: string; body: string; category: Category; priority: Priority; link: string | null };
  quietHours: { start: number; end: number; now: number };
  attachments?: { filename: string; content: string; contentType?: string }[];
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
          category: args.spec.category,
          priority: args.spec.priority,
          link: args.spec.link,
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

  // EMAIL needs an address; read it from the local recipient projection only
  // when that channel is actually in play.
  let recipientEmail: string | null = null;
  if (args.channel === "EMAIL") {
    const rec = await prisma.orgRecipient.findUnique({
      where: { orgId_userId: { orgId: args.orgId, userId: args.recipientUserId } },
      select: { email: true },
    });
    recipientEmail = rec?.email ?? null;
  }

  const outcome = await dispatch({
    channel: args.channel,
    orgId: args.orgId,
    recipientUserId: args.recipientUserId,
    recipientEmail,
    title: args.spec.title,
    body: args.spec.body,
    link: args.spec.link,
    logger,
    quietHours: args.quietHours,
    email: emailSender,
    push: pushSender,
    attachments: args.channel === "EMAIL" ? args.attachments : undefined,
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
      category: args.spec.category,
      priority: args.spec.priority,
      link: args.spec.link,
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

  // Periodic digest sweep — rolls unread notifications into a daily/weekly email
  // for users who opted in. Failures are logged, never fatal to the consumer.
  const digestTimer = setInterval(() => {
    void runDigestSweep(prisma, emailSender, logger, config.APP_URL).catch((error) =>
      logger.error({ err: String(error) }, "digest sweep failed"),
    );
  }, config.DIGEST_INTERVAL_MS);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down notifications-service...");
    clearInterval(digestTimer);
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

/**
 * Pull email file attachments out of an event payload. A producer sends a report
 * as `{ reportCsv: { filename, content } }`; we surface it as an attachment so
 * scheduled reports arrive with the actual CSV, not just a text summary.
 */
function extractAttachments(payload: Record<string, unknown>): { filename: string; content: string; contentType?: string }[] | undefined {
  const raw = payload.reportCsv;
  if (!isRecord(raw)) return undefined;
  const filename = asString(raw.filename);
  const content = asString(raw.content);
  if (!filename || !content) return undefined;
  return [{ filename, content, contentType: "text/csv" }];
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
