# event-processor — Architecture

A tiny standalone consumer-group worker (`@retainiq/event-processor`) whose only
job is to durably consume the platform's event streams and record every event it
sees in an **idempotent inbox** (`inbox-db`, table `ConsumedEvent`). It is not a
NestJS app: `src/` is just two files — `main.ts` (the worker) and `config.ts`
(env parsing) — plus shared packages. It runs the same at-least-once broker
abstraction used everywhere else in the monorepo (Redis Streams or Kafka), owns
its own database, and exposes Kubernetes probes + Prometheus metrics over a
minimal ops HTTP server.

```
core-api / ingestion  ──emit──▶  retainiq.events   (domain events)
                                 retainiq.activity  (high-volume activity)
                                        │
                                        ▼  Broker (Redis Streams | Kafka)
                              event-processor  (consumer group "event-processor")
                                        │  buildHandler → ConsumedEvent.create
                                        ▼
                                  inbox-db  (ConsumedEvent — dedup by (eventId, consumer))
```

## Role

The worker is a durable, horizontally-scalable **inbox recorder**. For each
message on a subscribed stream it writes one `ConsumedEvent` row keyed on
`(eventId, consumer)`. That row is the single source of truth for "has this
consumer group already processed this event?" — the primitive that makes the
platform's at-least-once delivery safe to build on. Duplicate deliveries collide
on the unique constraint and are silently skipped; genuine processing failures
stay pending and are eventually reclaimed or dead-lettered by the broker layer.

Everything the worker itself does lives in one function, `buildHandler(stream)`
(`src/main.ts:33`):

1. Read `event.eventId` off the envelope. If it is missing/non-string, log a
   warn and **return (ack)** — an unprocessable-but-not-retryable event
   (`main.ts:36-40`). A poison message never wedges the stream.
2. Insert `ConsumedEvent { eventId, consumer, stream, eventType, orgId, payload }`
   (`main.ts:46-55`). On success, `worker_events_consumed_total{stream}` is
   incremented and the event is logged.
3. On a Postgres unique violation (Prisma error `P2002`), increment
   `worker_events_duplicate_total{stream}` and **return (idempotent skip + ack)**
   (`main.ts:59-62`).
4. On any other error, **`throw`** — the message stays pending so the broker will
   redeliver, reclaim, and finally dead-letter it (`main.ts:63`).

The handler is deliberately thin. This service is the *template* for real
stream consumers: fan-out handlers (notifications, projections, analytics) follow
the same skeleton but replace step 2 with their domain work, keeping the same
idempotency + ack/throw contract.

## Consumed streams

Subscriptions are fixed in code (`main.ts:21`):

```ts
const SUBSCRIBED_STREAMS: StreamName[] = [STREAMS.domainEvents, STREAMS.activity];
```

| Constant | Stream / topic name | Source | What the worker does |
|---|---|---|---|
| `STREAMS.domainEvents` | `retainiq.events` | domain events relayed from the core-api transactional outbox | record one `ConsumedEvent` per event |
| `STREAMS.activity` | `retainiq.activity` | high-volume activity events from the ingestion service | record one `ConsumedEvent` per event |

Both names come from `@retainiq/messaging` (`packages/messaging/src/types.ts:1-9`).
One `broker.consumer(...)` is created per stream, all in the same consumer group
(`main.ts:82-91`), and each runs `buildHandler(stream)` so the stream name is
stamped onto every recorded row and every metric label.

## Idempotent inbox schema

The inbox is a dedicated database (`inbox-db`), owned solely by this worker, with
a single table. Prisma schema at
`packages/database/prisma/inbox/schema.prisma`, client generated to
`@retainiq/database/inbox` and imported in `main.ts:3`.

```prisma
model ConsumedEvent {
  id         String   @id @default(uuid()) @db.Uuid
  eventId    String   @db.Uuid
  consumer   String
  stream     String
  eventType  String
  orgId      String?  @db.Uuid
  payload    Json
  consumedAt DateTime @default(now())

  @@unique([eventId, consumer])          // the dedup key
  @@index([orgId, consumedAt])
  @@index([eventType, consumedAt])
}
```

DDL (`prisma/inbox/migrations/*/migration.sql`):

```sql
CREATE UNIQUE INDEX "ConsumedEvent_eventId_consumer_key"
  ON "ConsumedEvent"("eventId", "consumer");
```

Design notes:

- **`(eventId, consumer)` is the idempotency key.** `consumer` = `CONSUMER_GROUP`
  (default `"event-processor"`, `config.ts:10`), *not* the per-pod consumer name —
  so all pods of the group dedup against each other. Two pods racing the same
  redelivered event: the first insert wins, the second gets `P2002` and skips.
- **`payload` (JSONB)** stores the full event envelope, so the inbox doubles as an
  audit/replay log, not just a dedup marker.
- **`orgId` is nullable** — pulled from `event.orgId` when present (`main.ts:43`),
  left null otherwise. It is indexed with `consumedAt` for per-tenant scans.
- **No cross-database FKs.** `orgId` is a plain UUID; the inbox never joins to
  identity/billing data (consistent with the platform's database-per-service rule).

## Dedupe vs. FOR UPDATE SKIP LOCKED — where each lives

This worker does **not** run `SELECT ... FOR UPDATE SKIP LOCKED` itself; its dedup
is purely the unique-constraint insert above (optimistic: try the insert, catch
`P2002`). `FOR UPDATE SKIP LOCKED` is the *complementary* pattern on the **emit**
side of the pipeline — the transactional-outbox relays (e.g. payroll-service's
`OutboxRelayService`) use it to atomically claim batches of PENDING outbox rows
across replicas before publishing to the broker. Together they give the whole
platform exactly-once *effect* over at-least-once *delivery*:

| Side | Mechanism | Guarantee |
|---|---|---|
| Emit (outbox relay) | claim PENDING rows `FOR UPDATE SKIP LOCKED`, publish, mark SENT | no lost / no double-claimed publish across replicas |
| Deliver (broker) | Redis Streams / Kafka consumer groups, ack-on-success | at-least-once |
| Consume (this worker) | insert `ConsumedEvent`, unique `(eventId, consumer)`, catch `P2002` | idempotent — duplicates are no-ops |

## Broker & delivery semantics

The worker depends only on the `Broker` interface from `@retainiq/messaging`
(`types.ts:54-62`); the concrete driver is chosen by `BROKER_DRIVER` via
`createBroker(...)` (`main.ts:23-29`). Both drivers give **at-least-once**
delivery and route poison messages to a `<stream>.dlq` after `maxDeliveries`
(default 5) attempts — so the worker's ack/throw handler is all that's needed on
top.

- **Redis Streams** (`packages/messaging/src/redis.ts`): `XREADGROUP` for new
  messages, `XACK` on success. Failures aren't acked; a message idle longer than
  `RECLAIM_MIN_IDLE_MS` (default 30 000 ms) is reclaimed via `XPENDING`+`XCLAIM`
  with an incremented delivery count, and once deliveries reach `maxDeliveries`
  it is `XADD`-ed to `<stream>.dlq` and acked (`redis.ts:161-190`).
- **Kafka** (`packages/messaging/src/kafka.ts`): consumer-group `eachMessage`;
  a failed message is re-produced to the same topic with an incremented
  `x-attempts` header (bounded retry) and parked on `<topic>.dlq` once it exceeds
  `maxDeliveries`. Offsets always commit, so a poison message can't wedge the
  group (`kafka.ts:99-160`). Topics + their `.dlq` companions are auto-created at
  `init()` with 6 partitions (`kafka.ts:33-46`).

Because the handler `throw`s on unexpected errors and `return`s (acks) on both
success and duplicate, the worker cleanly delegates retry/DLQ policy to the
broker layer and never has to implement it itself.

## Config / env

Parsed and validated by Zod in `src/config.ts` (`loadWorkerConfig` calls
`envSchema.parse(process.env)`; `.env` is loaded first via
`import "@retainiq/config/env"` at the top of `main.ts`).

| Env var | Type / default | Purpose |
|---|---|---|
| `DATABASE_URL` | url (**required**) | inbox-db connection (Prisma) |
| `BROKER_DRIVER` | `redis` \| `kafka` | which broker implementation to use |
| `REDIS_URL` | url (optional) | Redis Streams endpoint (redis driver) |
| `KAFKA_BROKERS` | broker list | Kafka bootstrap brokers (kafka driver) |
| `CONSUMER_GROUP` | string, default `event-processor` | consumer group **and** the `consumer` column / dedup scope |
| `CONSUMER_NAME` | string, default `event-processor-1` | per-pod consumer identity within the group |
| `MAX_DELIVERIES` | int, default `5` | attempts before a message is dead-lettered |
| `RECLAIM_MIN_IDLE_MS` | int, default `30000` | Redis: idle time before a pending message is reclaimed |
| `HEALTH_PORT` | int, default `3003` | ops server port (probes + `/metrics`) |
| `LOG_LEVEL` | log level | logger verbosity |

In Kubernetes (`infra/k8s/event-processor.yaml`), `CONSUMER_NAME` is injected from
`metadata.name` via the downward API so each pod is a **distinct consumer** in the
group, and `DATABASE_URL` is taken from the `INBOX_DATABASE_URL` secret key —
making the inbox ownership explicit. Docker Compose wires
`DATABASE_URL=…@postgres-inbox:5432/retainiq-inbox` and `REDIS_URL=redis://redis:6379`
(`docker-compose.yml:275-293`), depending on the `migrator`, `postgres-inbox`, and
`redis` services being ready.

## Ops server, health & metrics

`startOpsServer(...)` from `@retainiq/observability` (`main.ts:93-102`,
implementation `packages/observability/src/ops-server.ts`) runs a minimal
`node:http` server on `HEALTH_PORT`:

| Endpoint | Behavior |
|---|---|
| `GET /health/live` | always `200 {status:"ok"}` — process is up |
| `GET /health/ready` | runs the readiness check: `SELECT 1` against inbox-db **and** `broker.ping()`; `200` if both pass, `503` otherwise (`main.ts:97-101`) |
| `GET /metrics` | Prometheus exposition |

Metrics (namespace `events-worker`, `main.ts:16-18`):

- `worker_events_consumed_total{stream}` — events successfully recorded.
- `worker_events_duplicate_total{stream}` — duplicates skipped on `P2002`.

`installProcessErrorHandlers(logger)` (`main.ts:31`) wires
`uncaughtException`/`unhandledRejection` logging.

## Lifecycle & graceful shutdown

`main()` (`main.ts:77-131`): connect Prisma → `broker.init()` → build one consumer
per subscribed stream → start the ops server → `run(buildHandler(stream))` each
consumer and `await Promise.all(runPromises)` (the run loops stay pending until
stopped).

On `SIGINT`/`SIGTERM`, `shutdown()` (`main.ts:106-120`) is idempotent (guarded by
`shuttingDown`): it calls `consumer.stop()` on every consumer, closes the ops
server, then races in-flight run loops against an 8 s timeout
(`Promise.race([Promise.allSettled(runPromises), delay(8000)])`) before
`broker.close()` → `prisma.$disconnect()` → `process.exit(0)`. The k8s Deployment
sets `terminationGracePeriodSeconds: 40` (`event-processor.yaml:16`) so in-flight
messages drain before the pod is killed. A crash in `main()` logs and exits `1`
(`main.ts:137-140`), letting Kubernetes restart the pod.

## Scaling (KEDA)

The worker is stateless — all shared state lives in the broker (consumer-group
offsets/PEL) and inbox-db — so it scales horizontally just by adding pods with
unique `CONSUMER_NAME`s in the same `CONSUMER_GROUP`. The k8s manifest
(`infra/k8s/event-processor.yaml`) scales on **backlog, not CPU**, via a KEDA
`ScaledObject`:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
spec:
  scaleTargetRef: { name: event-processor }
  minReplicaCount: 1
  maxReplicaCount: 20
  cooldownPeriod: 120
  triggers:
    - type: redis-streams
      metadata: { addressFromEnv: REDIS_URL, stream: "retainiq.activity",
                  consumerGroup: "event-processor", pendingEntriesCount: "100" }
    - type: redis-streams
      metadata: { addressFromEnv: REDIS_URL, stream: "retainiq.events",
                  consumerGroup: "event-processor", pendingEntriesCount: "100" }
```

- Two `redis-streams` triggers watch the pending-entries count (consumer-group
  lag) on `retainiq.activity` and `retainiq.events`. When either backlog exceeds
  ~100 pending entries KEDA scales the Deployment up, to at most 20 replicas;
  a 120 s cooldown damps scale-down.
- Requires KEDA installed in the cluster (noted inline in the manifest).
- A `PodDisruptionBudget` with `minAvailable: 1` keeps at least one consumer
  running during voluntary disruptions (`event-processor.yaml:82-90`).
- The headless `Service` (`clusterIP: None`) exposes only the ops port for
  scraping/probes — the worker takes no inbound request traffic.

## Build & image

Independent Docker image built from the monorepo root
(`backend/apps/event-processor/Dockerfile`): a `node:24-alpine` build stage runs
`npm install` then `npm run build:packages && npm run build -w @retainiq/event-processor`
(building shared packages incl. Prisma client generation, then just this service),
and a slim runtime stage runs `node backend/apps/event-processor/dist/main.js`.
`package.json` declares only the packages it uses — `@retainiq/config`,
`@retainiq/contracts`, `@retainiq/database`, `@retainiq/messaging`,
`@retainiq/observability`, plus `ioredis` and `zod`.
