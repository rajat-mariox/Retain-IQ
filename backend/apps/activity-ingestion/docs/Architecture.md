# activity-ingestion — Architecture

`activity-ingestion` is RetainIQ's high-volume intake edge for desktop-agent
activity telemetry. Its single job: authenticate an agent's batch of activity
events, validate them, wrap each in a standard envelope, and publish them to the
shared activity stream. It **never touches the OLTP database** — the fire-hose of
agent events is fully decoupled from transactional workloads
(`src/ingestion.service.ts`).

## Core principle

> **Accept fast, publish, and get out of the way.**

The service is a thin, stateless, horizontally-scalable HTTP producer in front of
the broker. It owns no database, no read-models, and no domain logic. It trusts
identity-service as the identity authority (shared JWT secret) and hands work off
to the broker as quickly as possible, returning `202 Accepted`
(`src/ingestion.controller.ts`).

## Service topology

```
desktop-agent (many, high frequency)
   │  POST /v1/ingest/activity   (Bearer access JWT)
   ▼
activity-ingestion  ── stateless HTTP producer (Fastify + NestJS)
   │  IngestAuthGuard  → verify identity-issued JWT + Redis denylist
   │  ZodValidationPipe → activityIngestBatchSchema (@retainiq/contracts)
   │  IngestionService  → envelope per event
   ▼  broker.publish(STREAMS.activity = "retainiq.activity")
Redis Streams / Kafka   (driver per BROKER_DRIVER)
   ├─▶ event-processor    (durable consumer group "event-processor")
   └─▶ analytics-service  (durable consumer group "analytics-service")
```

- **No database.** The config schema deliberately omits any `DATABASE_URL`; the
  comment in `src/config.ts` states it "needs neither the database nor the refresh
  secret." Redis is used only to read the shared logout denylist, and even that is
  optional (fails open).
- **Stateless.** Any replica can serve any agent; there is no session affinity.
- **At-least-once downstream.** Publishing is the only durability boundary here;
  idempotency is the consumers' responsibility (they de-dupe on `eventId`).

## Bootstrap (`src/main.ts`)

The service is a NestJS app on the **Fastify** adapter (chosen for throughput):

```ts
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule, new FastifyAdapter(), { bufferLogs: true });
app.useLogger(new NestPinoLogger(logger));
app.flushLogs();
app.enableShutdownHooks();          // drives OnApplicationShutdown → broker.close()
app.setGlobalPrefix("v1");          // all routes under /v1
await app.listen(config.PORT, "0.0.0.0");   // default 3002
```

Bootstrap order matters:

1. `import "@retainiq/config/env"` is the **first** import — it loads `.env` for
   host/dev runs and is a no-op in production.
2. `loadIngestionConfig()` parses/validates env via Zod at process start; a bad
   env fails fast before `listen`.
3. `installProcessErrorHandlers(logger)` wires `unhandledRejection` /
   `uncaughtException` to the structured logger.
4. `enableShutdownHooks()` lets `BrokerService.onApplicationShutdown` close the
   broker cleanly on SIGTERM (see `Events.md`).

A bootstrap failure logs `logger.fatal(...)` and `process.exit(1)`.

## Module wiring (`src/app.module.ts`)

| Provider / import | Role |
|---|---|
| `ObservabilityModule` (global) | logging, metrics, exception filter, `/v1/metrics` |
| `JwtModule.register({ secret: config.JWT_ACCESS_SECRET })` | verifies identity's access tokens |
| `IngestionController` | `POST /v1/ingest/activity` |
| `HealthController` | `/v1/health`, `/v1/health/ready` |
| `IngestAuthGuard` | agent authentication (JWT + denylist) |
| `IngestionService` | envelope + publish |
| `BrokerService` | broker lifecycle + publish |
| `TokenDenylist` (factory) | shared Redis logout denylist; `new TokenDenylist(null)` when no `REDIS_URL` |

The `TokenDenylist` factory reads the same Redis key-space identity-service writes
on logout, so a revoked access token is rejected here too. With no `REDIS_URL`
configured it is constructed with `null` and **fails open** — the comment notes
"ingestion only reads, never writes." The Redis client uses
`{ maxRetriesPerRequest: 2, lazyConnect: true }` and connects in the background so
broker/HTTP readiness is never blocked on Redis.

## Scaling posture

The service is CPU-light (JSON parse + JWT verify + publish), so it scales on CPU
via a plain HPA rather than on stream lag (`backend/infra/k8s/activity-ingestion.yaml`):

```yaml
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 65 } }
```

Supporting posture from the same manifest:

- **`replicas: 2`** baseline, container port **3002** (`PORT` also pinned to
  `"3002"` via env).
- Resource envelope: requests `250m` CPU / `192Mi`, limits `1` CPU / `384Mi`.
- **Probes** all hit HTTP: `startupProbe` and `livenessProbe` on `/v1/health`;
  `readinessProbe` on `/v1/health/ready` (broker reachability).
- **`terminationGracePeriodSeconds: 30`** + a `PodDisruptionBudget`
  (`minAvailable: 1`) give in-flight publishes time to drain on rollout.

> **KEDA note.** KEDA lag-based autoscaling is applied to the *consumers*, not to
> this producer. `event-processor` and `analytics-service` each own a
> `keda.sh/v1alpha1` `ScaledObject` that scales on the backlog of
> `stream: "retainiq.activity"` (`pendingEntriesCount: "100"`) for their
> respective consumer groups (`backend/infra/k8s/event-processor.yaml`,
> `analytics-service.yaml`). The ingestion tier scales on request CPU; the
> processing tier scales on stream depth.

## What lives where

| Concern | File |
|---|---|
| Bootstrap | `src/main.ts` |
| DI wiring | `src/app.module.ts` |
| Env schema/loader | `src/config.ts` |
| HTTP endpoint | `src/ingestion.controller.ts` |
| Envelope + publish | `src/ingestion.service.ts` |
| Agent auth | `src/auth.guard.ts` |
| Broker lifecycle | `src/broker.service.ts` |
| Validation pipe | `src/zod-validation.pipe.ts` |
| Health | `src/health.controller.ts` |
| Metrics endpoint | `src/metrics.controller.ts` |
| Logger/metrics singletons | `src/observability.ts` |
| Global observability module | `src/observability.module.ts` |

See companions: `Ingestion-Pipeline.md`, `Events.md`, `Operations.md`.
