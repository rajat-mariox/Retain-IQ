import "@retainiq/config/env"; // load .env for host/dev runs (no-op in prod) — must be first
import { parseKafkaBrokers } from "@retainiq/config";
import { PrismaClient } from "@retainiq/database/billing";
import { randomUUID } from "node:crypto";
import { createBroker, STREAMS, type EventPublisher, type StreamMessage } from "@retainiq/messaging";
import {
  createLogger,
  createMetrics,
  installProcessErrorHandlers,
  startOpsServer,
} from "@retainiq/observability";
import { computePrice, planPricingOf } from "@retainiq/contracts";
import { loadBillingConfig } from "./config.js";
import { PLAN_CATALOG } from "./plan-catalog.js";
import { startPlanApi } from "./plan-api.js";
import { runBillingCycle } from "./lifecycle.js";
import { runTrialExpiry } from "./trial.js";

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

// Set once the broker is initialized (see main). Lets HTTP handlers (plan-api)
// and event consumers publish domain events back onto the shared stream.
let publisher: EventPublisher | null = null;

/**
 * Publish a domain event onto the shared domain-events stream, mirroring the
 * envelope identity's transactional outbox emits (eventType / orgId / payload),
 * so cross-service consumers (e.g. identity's plan-cache invalidator) can read
 * billing-originated events the same way they read identity's.
 */
async function publishDomainEvent(eventType: string, orgId: string, payload: Record<string, unknown>): Promise<void> {
  if (!publisher) return; // broker not ready (boot / shutdown) — BillingEvent row still recorded
  const now = new Date().toISOString();
  const envelope = {
    eventId: randomUUID(),
    eventType,
    schemaVersion: 1,
    orgId,
    source: "billing-service",
    occurredAt: now,
    ingestedAt: now,
    payload,
  };
  await publisher.publish(STREAMS.domainEvents, envelope);
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
  // A free plan starts ACTIVE; a paid plan starts on a trial when the plan allows
  // one (per-plan trialEnabled/trialDays), else ACTIVE straight away.
  const startsTrial = plan.pricePerSeat > 0 && plan.trialEnabled;
  const status = startsTrial ? "TRIALING" : "ACTIVE";
  const trialDays = plan.trialDays > 0 ? plan.trialDays : 14;

  // Lock the rate at provisioning from the plan's pricing model at the licensed seats.
  const pricing = planPricingOf(plan);
  const lockedTotal = computePrice(pricing, seats).totalPrice;

  // Idempotent: orgId is unique, so a redelivered event leaves the sub unchanged.
  const sub = await prisma.subscription.upsert({
    where: { orgId },
    create: {
      orgId,
      planId,
      status,
      seats,
      activeSeats: 1,
      lockedBasePrice: pricing.basePrice,
      lockedAdditionalSeatPrice: pricing.additionalSeatPrice,
      lockedIncludedSeats: pricing.includedSeats,
      lockedTotalPrice: lockedTotal,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialStartedAt: startsTrial ? new Date() : null,
      trialEndsAt: startsTrial ? new Date(Date.now() + trialDays * DAY_MS) : null,
      autoRenew: true,
      billingEmail,
    },
    update: {},
  });

  // First invoice (idempotent on invoiceNumber). Charge the locked total at the
  // starting active-seat count (1), so it matches the seat-based pricing model.
  const amount = computePrice(pricing, sub.activeSeats).totalPrice;
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

/**
 * org deleted -> cancel the subscription. Idempotent: a CANCELED sub is left
 * untouched (no-op, no duplicate BillingEvent). "now" comes from the event's
 * occurredAt when present, else the consumer's wall clock (a redelivery lands
 * on the idempotency guard before the timestamp matters).
 */
async function handleOrganizationDeleted(event: Record<string, unknown>): Promise<void> {
  const orgId = typeof event.orgId === "string" ? event.orgId : null;
  if (!orgId) {
    eventsSkipped.inc({ reason: "missing_fields" });
    return;
  }
  const now = eventTime(event);
  const sub = await prisma.subscription.findUnique({ where: { orgId }, select: { status: true } });
  if (!sub) {
    eventsSkipped.inc({ reason: "no_subscription" });
    return;
  }
  if (sub.status === "CANCELED") {
    eventsSkipped.inc({ reason: "already_canceled" });
    return;
  }
  await prisma.subscription.update({ where: { orgId }, data: { status: "CANCELED", canceledAt: now } });
  await prisma.billingEvent.create({
    data: { orgId, type: "subscription.canceled", summary: "Canceled (org deleted)" },
  });
  logger.info({ orgId }, "Canceled subscription (org deleted)");
}

/**
 * org suspended -> suspend the subscription. Idempotent; refuses to downgrade a
 * CANCELED sub (terminal) or re-suspend an already-SUSPENDED one.
 */
async function handleOrganizationSuspended(event: Record<string, unknown>): Promise<void> {
  const orgId = typeof event.orgId === "string" ? event.orgId : null;
  if (!orgId) {
    eventsSkipped.inc({ reason: "missing_fields" });
    return;
  }
  const sub = await prisma.subscription.findUnique({ where: { orgId }, select: { status: true } });
  if (!sub) {
    eventsSkipped.inc({ reason: "no_subscription" });
    return;
  }
  if (sub.status === "CANCELED" || sub.status === "SUSPENDED") {
    eventsSkipped.inc({ reason: "not_suspendable" });
    return;
  }
  await prisma.subscription.update({ where: { orgId }, data: { status: "SUSPENDED" } });
  await prisma.billingEvent.create({
    data: { orgId, type: "subscription.suspended", summary: "Suspended (org suspended)" },
  });
  logger.info({ orgId }, "Suspended subscription (org suspended)");
}

/**
 * org reactivated -> restore an org-suspended subscription to ACTIVE, but only
 * while its paid period is still current. A CANCELED sub stays terminal, and an
 * expired period is left for the billing lifecycle to renew. Idempotent.
 */
async function handleOrganizationReactivated(event: Record<string, unknown>): Promise<void> {
  const orgId = typeof event.orgId === "string" ? event.orgId : null;
  if (!orgId) {
    eventsSkipped.inc({ reason: "missing_fields" });
    return;
  }
  const now = eventTime(event);
  const sub = await prisma.subscription.findUnique({ where: { orgId }, select: { status: true, currentPeriodEnd: true } });
  if (!sub) {
    eventsSkipped.inc({ reason: "no_subscription" });
    return;
  }
  if (sub.status !== "SUSPENDED" || sub.currentPeriodEnd <= now) {
    eventsSkipped.inc({ reason: "not_reactivatable" });
    return;
  }
  await prisma.subscription.update({ where: { orgId }, data: { status: "ACTIVE" } });
  await prisma.billingEvent.create({
    data: { orgId, type: "subscription.reactivated", summary: "Reactivated (org reactivated)" },
  });
  logger.info({ orgId }, "Reactivated subscription (org reactivated)");
}

/** "now" for a consumer: the event's occurredAt when valid, else wall clock. */
function eventTime(event: Record<string, unknown>): Date {
  const raw = typeof event.occurredAt === "string" ? event.occurredAt : null;
  if (raw) {
    const t = new Date(raw);
    if (!Number.isNaN(t.getTime())) return t;
  }
  return new Date();
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
  if (eventType === "organization.deleted") {
    return handleOrganizationDeleted(event);
  }
  if (eventType === "organization.suspended") {
    return handleOrganizationSuspended(event);
  }
  if (eventType === "organization.reactivated") {
    return handleOrganizationReactivated(event);
  }
  eventsSkipped.inc({ reason: "irrelevant" });
  return Promise.resolve();
}

async function main(): Promise<void> {
  await prisma.$connect();
  await seedPlans();
  await broker.init();
  publisher = broker.publisher();

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
  const planApi = await startPlanApi({
    prisma,
    port: config.API_PORT,
    jwtSecret: config.PLATFORM_JWT_SECRET,
    logger,
    publishEvent: publishDomainEvent,
  });

  // Recurring-billing lifecycle + trial expiry: run on boot, then on an interval.
  const billingCycle = async () => {
    // Expire due trials FIRST so the renewal loop never charges a lapsed trial.
    const trial = await runTrialExpiry({ prisma, logger }).catch((err) => {
      logger.error({ err: String(err) }, "trial expiry sweep failed");
      return { scanned: 0, expired: 0 };
    });
    // A newly-expired trial changed the org's entitlements — tell identity.
    if (trial.expired > 0) {
      const expired = await prisma.subscription.findMany({
        where: { status: "EXPIRED", trialExpiredAt: { gte: new Date(Date.now() - config.LIFECYCLE_INTERVAL_MS) } },
        select: { orgId: true, planId: true },
      });
      for (const s of expired) {
        await publishDomainEvent("subscription.plan_changed", s.orgId, { orgId: s.orgId, planId: s.planId }).catch(() => {});
      }
    }
    await runBillingCycle({ prisma, logger, paymentFailureRate: config.PAYMENT_FAILURE_RATE }).catch((err) =>
      logger.error({ err: String(err) }, "billing lifecycle cycle failed"),
    );
  };
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
