# Analytics Service — Architecture

`analytics-service` is a standalone **stream-consumer worker** (no HTTP API surface
beyond ops/health). It turns the high-volume employee-activity event stream into a
precomputed, per-employee/per-day read model — the **activity read-model** plus the
**daily productivity scores** — stored in its own `analytics-db`. Identity-service
reads that database **in-process, read-only** to serve monitoring, insights, and
platform-admin reporting without ever recomputing activity itself.

It follows the same database-per-service precedent as `billing-service` and
`payroll-service`: it owns and writes `analytics-db`; every other service treats
that DB as a read-only projection.

## Core principle

> **The worker precomputes; readers only read.** The consumer loop applies each
> activity event exactly once and keeps the day-fact + detail tables current;
> CPU-bound scoring is pushed off the loop into a `worker_threads` pool.

The scoring formula is intentionally simple and lives in one place (`score.task.ts`)
— explicitly the seam where heavier productivity/focus models or ML inference would
be dropped in (`src/score.task.ts` header comment).

## Service topology

```
ingestion (agent) ──► retainiq.activity  (Kafka / Redis Streams)
                          │  high-volume activity.* events
                          ▼
analytics-service (worker) ──────────────────────────────────────────
   main.ts        consumer loop: idempotent apply + delta rollup
   readmodel.ts   detail projections (sessions / app+site usage / timeline)
   scoring.ts     pure delta derivation + classification (shared contracts)
   score.task.ts  CPU-bound scoring, run in a Piscina worker_threads pool
   │
   ▼  analytics-db (Postgres) — owns:
        ConsumedEvent, EmployeeDayFact, WorkSession,
        AppUsageDaily, WebsiteUsageDaily, ActivityEvent
                          ▲
                          │  read-only, in-process (ANALYTICS_DATABASE_URL)
identity-service ─────────┘
   monitoring / insights / hr-analytics / platform-admin reporting
```

- **No cross-database FKs.** `orgId`/`employeeId` are plain UUIDs. Identity never
  joins across the DB boundary; it issues separate reads against `analytics-db`.
- **Multi-tenant** via `where: { orgId }` on every query.
- **No API server.** The only listening socket is the ops/health server
  (`startOpsServer`, default port `3004` per `config.ts` `HEALTH_PORT`).

## Consumer wiring

`main.ts` builds a broker from `@retainiq/messaging` (`createBroker`) driven by
`BROKER_DRIVER` (Kafka or Redis Streams) and subscribes a durable consumer group to
the activity stream:

```ts
const consumer = broker.consumer({
  stream: STREAMS.activity,          // "retainiq.activity" (messaging/src/types.ts)
  group: config.CONSUMER_GROUP,      // default "analytics-service"
  consumer: config.CONSUMER_NAME,    // default "analytics-service-1"
  maxDeliveries: config.MAX_DELIVERIES,        // default 5
  reclaimMinIdleMs: config.RECLAIM_MIN_IDLE_MS, // default 30000
});
```

`STREAMS.activity` resolves to the topic/stream `retainiq.activity`
(`backend/packages/messaging/src/types.ts`), which the docs describe as
*"High-volume activity events from the ingestion service."* This is a **separate
stream** from `STREAMS.domainEvents` (`retainiq.events`) that payroll/other services
consume — activity is its own high-volume channel.

### Per-message handling (`main.ts` `handle`)

Each `StreamMessage` carries an event envelope. The handler:

1. **Extracts + guards** `eventId`, `orgId`, `employeeId`. Activity not attributed
   to an employee cannot be scored — the message is acked and skipped
   (`main.ts:44-47`).
2. Derives the day bucket from `occurredAt.slice(0,10)` and computes the
   counter contribution with `deriveDelta(eventType, payload)` (from `scoring.ts`).
3. **Idempotent apply in one transaction** (`main.ts:60-97`): inserts a
   `ConsumedEvent` row and upserts the `EmployeeDayFact` (incrementing counters)
   in the same `prisma.$transaction`. Detail projection (`persistDetail`) runs in
   the same tx for `activity.*` events so the detail tables can never diverge from
   the day-fact.
4. **Scores off the loop** (`main.ts:106-119`): the current day totals are handed to
   the Piscina pool (`pool.run(...)`), and the returned `productivityScore` /
   `focusScore` are written back onto the `EmployeeDayFact`.

### Idempotency

Exactly-once apply is enforced by the `ConsumedEvent` unique constraint
`@@unique([eventId, consumer])` (analytics schema). On redelivery the
`consumedEvent.create` violates the constraint (Prisma `P2002`), the whole
transaction rolls back, and counters are **not** double-incremented. The handler
catches `P2002`, bumps the `analytics_events_duplicate_total` metric, and returns
(`main.ts:98-104`). Any other error re-throws so the message stays pending for
reclaim/DLQ via the broker's `maxDeliveries`/`reclaimMinIdleMs`.

## Concurrency model — worker_threads pool

Scoring is CPU-bound, so it is isolated from the event loop:

```ts
const pool = new Piscina({
  filename: fileURLToPath(new URL("./score.task.js", import.meta.url)),
  maxThreads: config.SCORING_THREADS ?? Math.max(1, cpus().length - 1),
});
```

The consumer loop stays free to keep ingesting activity while `score.task.ts`
computes on a pool thread (`main.ts:33-37`, `108-113`). This mirrors the
architecture direction (jobs off the request/consumer path via workers +
`worker_threads`). Default pool size is `cores - 1`; overridable via
`SCORING_THREADS`.

## analytics-db (the read model)

Schema: `backend/packages/database/prisma/analytics/schema.prisma`
(client generated to `@retainiq/database/analytics`). The schema header notes
`EmployeeDayFact` "mirrors a ClickHouse ReplacingMergeTree fact" — Postgres is the
current backing store for the same rollup shape.

| Model | Grain | Purpose |
|---|---|---|
| `ConsumedEvent` | one per `(eventId, consumer)` | Idempotency inbox; commits with the fact write in one local tx. `@@unique([eventId, consumer])`. |
| `EmployeeDayFact` | `(orgId, employeeId, day)` | The rollup: `activeSeconds`, `idleSeconds`, `productiveSeconds`, `eventCount` + computed `productivityScore`, `focusScore`. |
| `WorkSession` | `(orgId, employeeId, sessionKey)` | Per-session active/idle/break seconds + start/end times. |
| `AppUsageDaily` | `(orgId, employeeId, day, appName)` | Per-app seconds + `category` (PRODUCTIVE/NEUTRAL/DISTRACTING). |
| `WebsiteUsageDaily` | `(orgId, employeeId, day, domain)` | Per-domain seconds, `visits`, `category`. |
| `ActivityEvent` | append per event | The raw timeline: `type` (app/website/idle/break/session/screenshot/focus/context_switch), `title`, `detail`, `category`, `seconds`. |

`EmployeeDayFact` is the **rollup** (counters + scores); the four detail tables keep
what the rollup discards. `readmodel.ts` populates the detail tables; `main.ts`
maintains the rollup and its scores. See `Scoring.md` for the projection logic.

Every table is indexed on `(orgId, day)` and `(orgId, employeeId, day)` (or
`occurredAt`) — the exact shapes identity's read queries filter on.

## How identity reads it (in-process, read-only)

Identity binds a **second, read-only Prisma client** to `analytics-db` rather than
calling analytics over HTTP:

`backend/apps/identity-service/src/common/database/analytics-prisma.service.ts`

```ts
@Injectable()
export class AnalyticsReadPrismaService extends PrismaClient {
  constructor() {
    const url = process.env.ANALYTICS_DATABASE_URL;   // distinct connection
    super(url ? { datasourceUrl: url } : undefined);
  }
  // "Never write to the analytics database here."
}
```

It uses the same generated client (`@retainiq/database/analytics`) but a **separate
connection** (`ANALYTICS_DATABASE_URL`) from identity's own DB. Provided via
`common/database/database.module.ts` and `modules/insights/insights.module.ts`, it is
injected into read surfaces:

| Identity consumer | Reads |
|---|---|
| `modules/monitoring/monitoring.service.ts` | `employeeDayFact`, `appUsageDaily`, `websiteUsageDaily`, `workSession`, `activityEvent` — live monitoring dashboards. |
| `modules/insights/insights.service.ts` | `employeeDayFact` `findMany` / `groupBy` / `aggregate` — trend + productivity insights (e.g. `activeSeconds` this-half vs last-half). |
| `modules/insights/insight-alerts.service.ts` | `employeeDayFact` — insight alerting. |
| `modules/hr-analytics/hr-analytics.service.ts` | `employeeDayFact` — HR analytics rollups. |
| `modules/employee/employee-360.service.ts` | `employeeDayFact` — per-employee 360 view. |
| `modules/timetracking/timetracking.service.ts` | activity read model. |
| `modules/platform-admin/admin.service.ts` | cross-org usage/productivity rollups (BFF reporting). |
| `modules/attendance/attendance-autoclose.service.ts` | activity signals for auto-close. |

Because analytics has already precomputed the day-facts and scores, these readers do
cheap indexed `where: { orgId, day }` lookups — they never touch the raw activity
stream and never recompute productivity.

## Configuration (`config.ts`)

Env is validated with Zod (`loadAnalyticsConfig`). Notable keys:

| Key | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | (required) | analytics-db connection for the worker (read/write). |
| `BROKER_DRIVER` | — | `kafka` \| `redis` (from `@retainiq/config`). |
| `KAFKA_BROKERS` / `REDIS_URL` | — | Broker endpoints. |
| `CONSUMER_GROUP` | `analytics-service` | Durable consumer group. |
| `CONSUMER_NAME` | `analytics-service-1` | Consumer instance id. |
| `HEALTH_PORT` | `3004` | Ops/health + metrics server port. |
| `MAX_DELIVERIES` | `5` | Redelivery attempts before DLQ/park. |
| `RECLAIM_MIN_IDLE_MS` | `30000` | Idle time before a pending message is reclaimed. |
| `SCORING_THREADS` | `cores - 1` | Piscina pool size. |
| `LOG_LEVEL` | — | Logger level. |

Note: the worker connects with `DATABASE_URL`; identity reads with a **different**
env var, `ANALYTICS_DATABASE_URL`, keeping the ownership boundary explicit.

## Observability & lifecycle

- **Metrics** (`createMetrics("analytics-worker")`): `analytics_facts_updated_total`,
  `analytics_events_duplicate_total`, `analytics_last_scoring_seconds` (gauge, timed
  via `process.hrtime.bigint()` around each `pool.run`).
- **Health** (`startOpsServer`): readiness probe runs `SELECT 1` against the DB and
  `broker.ping()` (`main.ts:140-149`).
- **Graceful shutdown** (`main.ts:153-165`): SIGINT/SIGTERM stop the consumer and ops
  server, race the run loop against an 8s deadline, then destroy the pool, close the
  broker, and disconnect Prisma.
- **Process error handlers** installed via `installProcessErrorHandlers`; a top-level
  crash logs and exits non-zero.

## Deployment

`Dockerfile` builds an independent image from the monorepo root: it builds the shared
packages (including Prisma client generation via `npm run build:packages`) plus this
one service, and runs `node backend/apps/analytics-service/dist/main.js`. No web
server — it is a long-running consumer with a health port.

See the companion doc `Scoring.md` for the delta derivation, classification,
detail projections, and the scoring formula.
