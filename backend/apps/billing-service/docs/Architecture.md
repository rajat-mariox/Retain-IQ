# Billing Service — Architecture

`billing-service` was the **first microservice extraction** in RetainIQ: the point
where billing stopped living inside identity-service and became a standalone
process with its own database (`billing-db`). It owns the plan catalog, per-org
subscriptions, invoices, and the recurring-billing lifecycle. Identity keeps only a
**read-only** binding onto `billing-db`; every billing *write* happens here.

Unlike the Nest-based services (identity, payroll), billing-service is a **plain
Fastify + raw Prisma process** — no Nest module graph. It is a small, event-driven
worker with a thin HTTP admin surface bolted on. The entry point is
`src/main.ts`.

## Core principle

> **identity owns the org; billing owns the money.**

There is **no `Organization` table** in `billing-db` and **no cross-database FK**
(`prisma/billing/schema.prisma` header): `orgId` is a plain `@db.Uuid`. The org is
created in identity-service, which emits `organization.created`; billing-service
consumes it and provisions the `Subscription` (choreography, not a synchronous
call). All money is **integer USD cents** end-to-end — no floats (`plan-catalog.ts`
line 1, `pricing.ts` line 6).

## Service topology

```
identity-service (owns Organization / Employee / sessions)
   │  transactional outbox → emits organization.created / .headcount /
   │  .deleted / .suspended / .reactivated
   ▼  Kafka / Redis Streams  (STREAMS.domainEvents = "retainiq.events")
billing-service ─────────────────────────────────────────────────────
   │  consumer group "billing-service" → provisions/reconciles subscriptions
   │  lifecycle.ts  → recurring-billing worker (renew / dunning / suspend)
   │  trial.ts      → trial expiry / convert / extend / cancel
   │  plan-api.ts   → platform-admin plan+subscription CRUD (Fastify :3007)
   │  emits subscription.plan_changed / .created back onto the stream
   ▼  billing-db (Plan / Subscription / Invoice / PlanFeature / BillingEvent)
        ▲
        └── identity-service reads billing-db read-only (billing-prisma.service.ts)
            for org billing pages, seat-limit checks, entitlements, admin rollups.
```

The messaging stream constant is `STREAMS.domainEvents = "retainiq.events"`
(`backend/packages/messaging/src/types.ts` line 4). The broker driver (Kafka or
Redis Streams) is selected by `BROKER_DRIVER` — the same shared bus identity uses.

## Process bootstrap (`src/main.ts`)

`main()` (line 312) wires the whole process in a fixed order:

| Step | Line | What |
|---|---|---|
| `prisma.$connect()` | 313 | connect to `billing-db` (`@retainiq/database/billing`) |
| `seedPlans()` | 314 | ensure the default catalog exists (create-only, see below) |
| `broker.init()` | 315 | connect Kafka/Redis, then grab `broker.publisher()` |
| `broker.consumer(...)` | 318 | durable consumer on `STREAMS.domainEvents`, group `CONSUMER_GROUP` |
| `startOpsServer(...)` | 327 | health/metrics on `HEALTH_PORT` (3006) |
| `startPlanApi(...)` | 339 | platform-admin HTTP API on `API_PORT` (3007) |
| `billingCycle()` + `setInterval` | 368-369 | run the lifecycle+trial sweep on boot, then every `LIFECYCLE_INTERVAL_MS` |
| `consumer.run(handler)` | 371 | start consuming events (the long-lived promise `main` awaits) |

So one billing-service process runs **three concurrent duties**: a domain-event
consumer, an interval-driven billing worker, and two HTTP servers (ops + plan-API).

### Two HTTP ports

- **Ops server** (`HEALTH_PORT`, default `3006`) — `startOpsServer` from
  `@retainiq/observability`, exposing health/metrics. Its `readiness` probe
  (`main.ts` line 331) runs `SELECT 1` against `billing-db` **and** `broker.ping()`,
  so readiness is red unless both the DB and the broker are reachable.
- **Plan-admin API** (`API_PORT`, default `3007`) — the Fastify app from
  `plan-api.ts`, guarded by the platform JWT.

### Metrics

`createMetrics("billing-service")` registers two Prometheus counters (`main.ts`
lines 23-24):

- `billing_subscriptions_created_total` — incremented per provisioned subscription.
- `billing_events_skipped_total{reason}` — incremented whenever a consumed event is
  ignored; `reason` is one of `missing_fields`, `unknown_plan`, `no_subscription`,
  `already_canceled`, `not_suspendable`, `not_reactivatable`, or `irrelevant`.

### Graceful shutdown

`shutdown()` (`main.ts` line 374) is idempotent (guarded by `shuttingDown`). On
`SIGINT`/`SIGTERM` it clears the lifecycle timer, stops the consumer, closes both
HTTP servers, then races the consumer's run-promise against an 8s deadline before
closing the broker, disconnecting Prisma, and exiting `0`.

## Configuration (`src/config.ts`)

Config is a single Zod schema (`envSchema`) parsed from `process.env` by
`loadBillingConfig()`. `@retainiq/config/env` is imported **first** in `main.ts`
(line 1) so `.env` is loaded for host/dev runs before anything reads env.

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | `billing-db` connection |
| `BROKER_DRIVER` | — | `kafka` \| `redis` |
| `REDIS_URL` / `KAFKA_BROKERS` | — | broker endpoints |
| `CONSUMER_GROUP` | `billing-service` | durable consumer group |
| `CONSUMER_NAME` | `billing-service-1` | consumer instance id |
| `HEALTH_PORT` | `3006` | ops server (health + metrics) |
| `API_PORT` | `3007` | plan-admin Fastify API |
| `PLATFORM_JWT_SECRET` | `change-me` | HS256 secret for platform-admin JWTs |
| `MAX_DELIVERIES` | `5` | consumer redelivery cap before park |
| `RECLAIM_MIN_IDLE_MS` | `30000` | reclaim window for stuck pending messages |
| `LIFECYCLE_INTERVAL_MS` | `21_600_000` (6h) | recurring-billing sweep cadence |
| `PAYMENT_FAILURE_RATE` | `0.08` | simulated charge-failure probability (no real gateway yet) |

## The event consumer (`handler` in `main.ts`)

`handler(message)` (line 290) is a flat dispatch on `event.eventType`. It maps five
identity events to handlers; anything else increments
`billing_events_skipped_total{reason:"irrelevant"}` and returns.

| Consumed `eventType` | Handler | Effect |
|---|---|---|
| `organization.created` | `handleOrganizationCreated` (84) | provision `Subscription` + first `Invoice` + `BillingEvent` |
| `organization.headcount` | `handleOrganizationHeadcount` (178) | reconcile `activeSeats` from identity's live headcount |
| `organization.deleted` | `handleOrganizationDeleted` (203) | subscription → `CANCELED` |
| `organization.suspended` | `handleOrganizationSuspended` (230) | subscription → `SUSPENDED` |
| `organization.reactivated` | `handleOrganizationReactivated` (257) | `SUSPENDED` → `ACTIVE` (if period still current) |

Every handler is **idempotent**, which matters because delivery is at-least-once:

- **Provisioning** upserts on the unique `orgId` (`main.ts` line 117,
  `create ... update:{}`), and the first invoice is caught on the unique
  `invoiceNumber` violation (`isUniqueViolation`, P2002, line 37/162). A redelivered
  `organization.created` therefore changes nothing.
- **Cancel / suspend / reactivate** each read the current status first and no-op if
  the transition doesn't apply (e.g. a `CANCELED` sub is terminal and refuses
  re-suspend; `main.ts` lines 215, 241, 269), bumping a distinct skip reason.
- **Headcount** writes only when `next !== sub.activeSeats` (line 192), so a steady
  headcount produces no write churn.

### org.created payload contract

Identity emits `organization.created` from its own transactional outbox inside the
create-org transaction (`identity-service/.../platform-admin/admin.service.ts` line
465). The payload billing reads:

```jsonc
{ "orgId": "<uuid>", "payload": { "planId": "professional", "seats": 25, "billingEmail": "ops@acme.test" } }
```

`handleOrganizationCreated` defaults `seats` to `10` and tolerates a missing
`billingEmail`, but **requires `orgId` + `planId`** (else `missing_fields`) and
requires the plan to exist in `billing-db` (else `unknown_plan`, `main.ts` lines
91-100).

## Emitting back onto the stream

billing-service is not only a consumer. `publishDomainEvent(eventType, orgId,
payload)` (`main.ts` line 51) publishes onto the same `STREAMS.domainEvents` stream
using an envelope that mirrors identity's outbox shape (`eventId`, `eventType`,
`schemaVersion:1`, `orgId`, `source:"billing-service"`, `occurredAt`, `ingestedAt`,
`payload`). It is **best-effort**: if the broker isn't ready it silently returns
(the durable `BillingEvent` row is still written).

The primary consumer of billing's emitted events is identity's
`PlanCacheSyncService` (`identity-service/.../seat-sync/plan-cache-sync.service.ts`),
which listens for `subscription.plan_changed`, `subscription.seats_changed`,
`subscription.created`, and the org-status events, and busts its cached plan +
entitlement data for that org so a plan change takes effect within moments instead
of after the cache TTL.

## The plan catalog (`src/plan-catalog.ts`)

`PLAN_CATALOG` is reference data for the four built-in tiers — `free`, `basic`,
`professional`, `enterprise` — with USD-cent pricing, seat caps, storage quotas,
and feature-code arrays. `seedPlans()` (`main.ts` line 76) upserts each with
`create: p, update: {}` — **create-only**: on a fresh DB the defaults appear, but an
existing (possibly super-admin-edited) plan is **never overwritten**. Plans are
now admin-managed via the plan-API, and the catalog is only the initial seed.

The seeded rows keep the historical **flat per-seat** behaviour (`basePrice 0`,
`includedSeats 0`, `additionalSeatPrice` = the old per-seat price), so pricing is
unchanged until an admin sets a real base/included model. See `Database-Events.md`
for the pricing model and `Billing-Lifecycle.md` for how it drives invoices.

## Platform-admin plan API (`src/plan-api.ts`)

`startPlanApi()` builds a Fastify instance guarded by a **`preHandler` JWT hook**
(line 89): the `Authorization: Bearer` token is verified with `PLATFORM_JWT_SECRET`
and must carry `scope === "platform"` — the same token identity issues to
super-admins. It verifies signature + scope + expiry only (no logout-denylist
revocation yet; see the note at `plan-api.ts` line 72). It exposes plan CRUD,
per-plan feature-limit management, and per-org subscription/trial actions — all
enumerated in `Database-Events.md`.

## Shared pricing (`@retainiq/contracts`)

Pricing math is **not** inlined here. billing-service imports `computePrice`,
`planPricingOf`, and `effectivePricing` from `@retainiq/contracts`
(`backend/packages/contracts/src/lib/pricing.ts`) — the single authoritative
implementation shared with identity and mirrored in the frontends. The model:

```
total = basePrice + max(0, seatQuantity - includedSeats) * additionalSeatPrice
```

This one function computes provisioning invoices, renewal invoices, the rate-lock
snapshot, and MRR, so all four agree by construction.

## Related docs

- `Billing-Lifecycle.md` — the recurring-billing worker, dunning state machine, and trial lifecycle.
- `Database-Events.md` — `billing-db` models, the full event catalog, and the plan-API endpoint reference.
