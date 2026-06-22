# Microservices Topology

This document describes the first decomposition step: extracting the high-volume
async path out of the modular monolith while keeping the transactional core
intact. We did **not** shatter every domain into its own service — that remains a
roadmap-driven decision made per real scaling pressure.

## Services

| Service | Type | Responsibility | Scales on |
| --- | --- | --- | --- |
| `identity-service` (`apps/identity-service`) | NestJS HTTP | OLTP: identity, tenancy, RBAC, employees. Owns the Postgres schema. Emits domain events via a transactional outbox. | request volume |
| `activity-ingestion` (`apps/activity-ingestion`) | NestJS HTTP | High-volume activity intake. Validates + stamps events and publishes them to the broker. No database access. | event volume |
| `event-processor` (`apps/event-processor`) | Node worker | Consumes streams via a durable consumer group and projects events into the `ConsumedEvent` inbox (idempotently). | consumer lag |

Shared libraries (`packages/*`): `contracts` (event/envelope schemas), `messaging`
(broker abstraction), `authz`, `config`, `observability`, `database` (Prisma).

## Message flow

```
identity-service  ──(write + OutboxEvent in one txn)──▶ Postgres
   │ outbox-relay polls PENDING rows
   └──────────────▶ Redis Stream "retainiq.events" ──┐
                                                      ├─▶ event-processor
activity-ingestion ─▶ Redis Stream "retainiq.activity"─┘   (consumer group)
                                                              │
                                                              ▼
                                                   ConsumedEvent (idempotent inbox)
```

## Patterns applied

- **Transactional outbox**: state changes and their domain events are written in
  the same DB transaction (`OutboxService.enqueue` takes the txn client), so events
  can never be lost or emitted for rolled-back writes.
- **Outbox relay**: `OutboxRelayService` polls `PENDING` rows on an interval,
  publishes to the broker, marks `PUBLISHED`, and retries with backoff
  (`FAILED` after max attempts). Delivery is **at-least-once**.
- **Durable consumer groups**: `event-processor` reads with `XREADGROUP` and `XACK`s
  on success; failed handlers leave messages pending for redelivery.
- **Idempotent consumers (inbox)**: each `(eventId, consumer)` is recorded once in
  `ConsumedEvent`; redeliveries hit the unique constraint and are skipped.
- **Service-to-service auth**: `activity-ingestion` verifies the same access JWT
  issued by `identity-service` (shared `JWT_ACCESS_SECRET`); it trusts identity-service as the
  identity authority and does no DB lookups.

## Broker choice

Redis Streams is the broker — it reuses infrastructure already present and gives
durable, replayable, consumer-group semantics. Per the roadmap, **Kafka/MSK is
deferred** until replay scale, many independent consumers, or partitioned
throughput actually demand it. The `@retainiq/messaging` package is the seam: its
`StreamPublisher` / `StreamConsumer` interfaces can be reimplemented over Kafka
without touching service code.

## What was intentionally NOT split

Identity, tenant, and employee remain in `identity-service`. They share a transactional
boundary and a database; splitting them now would add latency and distributed-
transaction complexity for no scaling benefit. They are extracted only when a
specific module needs independent scaling or isolation.

## Running

`docker compose up --build` starts Postgres, Redis, and all three services from a
single image (different `command` per service). Locally without Docker, run each
with its workspace start script (`npm run dev:identity`, `npm run dev:ingestion`, and
`node apps/event-processor/dist/main.js`).
