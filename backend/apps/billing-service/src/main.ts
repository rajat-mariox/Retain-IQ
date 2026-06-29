import "@retainiq/config/env"; // load .env for host/dev runs (no-op in prod) — must be first
import { parseKafkaBrokers } from "@retainiq/config";
import { PrismaClient } from "@retainiq/database/billing";
import { createBroker, STREAMS, type StreamMessage } from "@retainiq/messaging";
import {
  createLogger,
  createMetrics,
  installProcessErrorHandlers,
  startOpsServer,
} from "@retainiq/observability";
import { loadBillingConfig } from "./config.js";
import { PLAN_CATALOG } from "./plan-catalog.js";
import { startPlanApi } from "./plan-api.js";
import { runBillingCycle } from "./lifecycle.js";

const DAY_MS = 86_400_000;
const config = loadBillingConfig();
const logger = createLogger("billing-service", config.LOG_LEVEL);
const metrics = createMetrics("billing-service");
const subsCreated = metrics.counter("billing_subscriptions_created_total", "Subscriptions provisioned from events.");
const eventsSkipped = metrics.counter("billing_events_skipped_total", "Domain events ignored or duplicate.", ["reason"]);

const prisma = new PrismaClient();
const broker = createBroker({
  driver: config.BROKER_DRIVER,
  clientId: "billing-service",
  redisUrl: config.REDIS_URL,
  kafkaBrokers: parseKafkaBrokers(config.KAFKA_BROKERS),
  logger,
});

installProcessErrorHandlers(logger);

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

function startOfUtcMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Bootstrap the default plans on a fresh DB. CREATE-ONLY: plans are now
 * admin-managed (see plan-api), so we never overwrite an existing (possibly
 * edited) plan — the catalog is only the initial default set.
 */
async function seedPlans(): Promise<void> {
  for (const p of PLAN_CATALOG) {
    await prisma.plan.upsert({ where: { id: p.id }, create: p, update: {} });
  }
  logger.info({ catalog: PLAN_CATALOG.length }, "Ensured default plans exist");
}

/** Provisions a subscription (+ first invoice) when identity emits org.created. */
async function handleOrganizationCreated(event: Record<string, unknown>): Promise<void> {
  const orgId = typeof event.orgId === "string" ? event.orgId : null;
  const payload = (event.payload as Record<string, unknown> | undefined) ?? {};
  const planId = typeof payload.planId === "string" ? payload.planId : null;
  const seats = typeof payload.seats === "number" ? payload.seats : 10;
  const billingEmail = typeof payload.billingEmail === "string" ? payload.billingEmail : null;

  if (!orgId || !planId) {
    eventsSkipped.inc({ reason: "missing_fields" });
    return;
  }
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    logger.warn({ orgId, planId }, "org.created references unknown plan — skipping");
    eventsSkipped.inc({ reason: "unknown_plan" });
    return;
  }

  const now = new Date();
  const periodStart = startOfUtcMonth(now);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  const status = plan.pricePerSeat === 0 ? "ACTIVE" : "TRIALING";

  // Idempotent: orgId is unique, so a redelivered event leaves the sub unchanged.
  const sub = await prisma.subscription.upsert({
    where: { orgId },
    create: {
      orgId,
      planId,
      status,
      seats,
      activeSeats: 1,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialEndsAt: status === "TRIALING" ? new Date(Date.now() + 14 * DAY_MS) : null,
      autoRenew: true,
      billingEmail,
    },
    update: {},
  });

  // First invoice (idempotent on invoiceNumber).
  const amount = 1 * plan.pricePerSeat;
  const invoiceNumber = `INV-${periodStart.toISOString().slice(0, 7).replace("-", "")}-${orgId.replace(/-/g, "").slice(0, 8)}`;
  try {
    await prisma.invoice.create({
      data: {
        orgId,
        subscriptionId: sub.id,
        invoiceNumber,
        status: amount > 0 ? "OPEN" : "PAID",
        issuedAt: now,
        dueAt: new Date(now.getTime() + 7 * DAY_MS),
        paidAt: amount > 0 ? null : now,
        periodStart,
        periodEnd,
        subtotal: amount,
        totalAmount: amount,
        amountDue: amount > 0 ? amount : 0,
        currency: "USD",
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  await prisma.billingEvent.create({
    data: { orgId, type: "subscription.created", summary: `Subscribed to ${plan.name} (${seats} seats)`, planId, amountCents: amount },
  });

  subsCreated.inc();
  logger.info({ orgId, planId, status }, "Provisioned subscription from org.created");
}

/**
 * Reconcile activeSeats from identity's authoritative active-employee headcount.
 * identity owns Employee data and emits the count; we only update our own column,
 * capped at the licensed seat quantity. activeSeats drives MRR.
 */
async function handleOrganizationHeadcount(event: Record<string, unknown>): Promise<void> {
  const orgId = typeof event.orgId === "string" ? event.orgId : null;
  const payload = (event.payload as Record<string, unknown> | undefined) ?? {};
  const activeEmployees = typeof payload.activeEmployees === "number" ? payload.activeEmployees : null;
  if (!orgId || activeEmployees == null) {
    eventsSkipped.inc({ reason: "missing_fields" });
    return;
  }
  const sub = await prisma.subscription.findUnique({ where: { orgId }, select: { seats: true, activeSeats: true } });
  if (!sub) {
    eventsSkipped.inc({ reason: "no_subscription" });
    return;
  }
  const next = Math.min(activeEmployees, sub.seats); // active seats never exceed the licensed count
  if (next === sub.activeSeats) return; // already in sync — no write, no churn
  await prisma.subscription.update({ where: { orgId }, data: { activeSeats: next } });
  logger.info({ orgId, activeSeats: next }, "Reconciled active seats from headcount");
}

function handler(message: StreamMessage): Promise<void> {
  const event = message.event;
  const eventType = typeof event.eventType === "string" ? event.eventType : "unknown";
  if (eventType === "organization.created") {
    return handleOrganizationCreated(event);
  }
  if (eventType === "organization.headcount") {
    return handleOrganizationHeadcount(event);
  }
  eventsSkipped.inc({ reason: "irrelevant" });
  return Promise.resolve();
}

async function main(): Promise<void> {
  await prisma.$connect();
  await seedPlans();
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

  // Platform-admin plan-CRUD HTTP API (billing-service owns the Plan table).
  const planApi = await startPlanApi({ prisma, port: config.API_PORT, jwtSecret: config.PLATFORM_JWT_SECRET, logger });

  // Recurring-billing lifecycle: run on boot, then on an interval.
  const billingCycle = () =>
    runBillingCycle({ prisma, logger, paymentFailureRate: config.PAYMENT_FAILURE_RATE }).catch((err) =>
      logger.error({ err: String(err) }, "billing lifecycle cycle failed"),
    );
  await billingCycle();
  const lifecycleTimer = setInterval(() => void billingCycle(), config.LIFECYCLE_INTERVAL_MS);

  const runPromise = consumer.run(handler);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down billing-service");
    clearInterval(lifecycleTimer);
    consumer.stop();
    opsServer.close();
    void planApi.close();
    void Promise.race([runPromise, delay(8000)])
      .then(() => broker.close())
      .then(() => prisma.$disconnect())
      .finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info({ stream: STREAMS.domainEvents, group: config.CONSUMER_GROUP, healthPort: config.HEALTH_PORT, apiPort: config.API_PORT, broker: config.BROKER_DRIVER }, "billing-service started");
  await runPromise;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  logger.error({ err: String(error) }, "billing-service crashed");
  process.exit(1);
});
