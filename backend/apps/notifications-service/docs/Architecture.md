# notifications-service — Architecture

The **notification fan-out engine** for the RetainIQ Workforce SaaS. A dedicated,
event-driven worker (no HTTP API of its own beyond ops/health) that consumes the
shared domain-events stream, decides *who* should hear about each event and *how*,
and delivers across three channels (in-app inbox, email, web push) with per-user
preferences, quiet hours, and daily/weekly digests. It owns its own database
(`notifications-db`), following the billing-service / payroll-service extraction
precedent.

## Core principle

> **Code provides the fan-out engine. A rule registry provides the behavior.**

The worker itself knows nothing about leave, tasks, or attendance. It only knows:
*event type → notification spec(s) → audience → channels → recipient preferences →
delivery*. The mapping lives in a code-based rule registry (`rules.ts`) that is the
explicit seam for a future DB-backed, org-configurable rules engine — the consumer
"doesn't care where rules come from" (`rules.ts` header comment).

## Service topology

```
identity-service / project / attendance / insights …
   │  emit domain events (leave.requested, task.assigned, org.member.upserted, …)
   ▼  Kafka / Redis Streams  (STREAMS.domainEvents = "retainiq.events")
notifications-service (this worker)  ── src/main.ts handle()
   │  rules.ts        → rulesFor(eventType) → NotificationSpec[]
   │  recipients.ts   → resolveRecipients(audience)  (reads OrgRecipient projection)
   │  preferences.ts  → resolvePreferences(category)  (per-user channel opt-in + quiet)
   │  channels.ts     → dispatch()  → email.ts / push.ts / in-app row
   │  digest.ts       → periodic sweep → digest emails
   ▼  notifications-db (Notification, NotificationPreference, NotificationSetting,
   │                    PushSubscription, OrgRecipient)
   └─ RedisRealtimeBus.publish(userNotificationChannel)  → live SSE fan-out (best-effort)
```

- **No cross-database reads.** The worker never queries identity-db. It maintains a
  **local** `OrgRecipient` read model (org membership + role + email + name),
  projected from `org.member.upserted` events, and resolves recipients from that
  copy (`recipients.ts` header; `notifications/schema.prisma` model comment).
- **Multi-tenant** via `orgId` on every model and every query
  (`where: { orgId }` / composite `orgId_userId` keys).
- **At-least-once consumption, idempotent delivery.** There is no inbox table;
  idempotency is enforced at the delivery row via a unique `dedupeKey` (see below and
  `Database-Events.md`).

## Event-consumer model

`main.ts` builds a broker from config and runs a single durable consumer:

```ts
const broker = createBroker({
  driver: config.BROKER_DRIVER,       // "redis" | "kafka"
  clientId: "notifications-service",
  redisUrl: config.REDIS_URL,
  kafkaBrokers: parseKafkaBrokers(config.KAFKA_BROKERS),
  logger,
});

const consumer = broker.consumer({
  stream: STREAMS.domainEvents,        // "retainiq.events"
  group: config.CONSUMER_GROUP,        // default "notifications-service"
  consumer: config.CONSUMER_NAME,      // default "notifications-service-1"
  maxDeliveries: config.MAX_DELIVERIES,        // default 5, then DLQ
  reclaimMinIdleMs: config.RECLAIM_MIN_IDLE_MS, // default 30000
  logger,
});
const runPromise = consumer.run(handle);
```

The broker abstraction (`@retainiq/messaging`) satisfies the same contract on Redis
Streams and Kafka, selected by `BROKER_DRIVER`. On Redis it is a consumer-group
reader: `XREADGROUP` delivers a batch, the handler runs, a successful handler
`XACK`s the message; a throwing handler leaves the message pending to be reclaimed
and retried up to `maxDeliveries`, after which it is parked in the DLQ
(`<stream>.dlq`) and acked (`packages/messaging/src/redis.ts`).

### The `handle()` dispatch (`main.ts`)

Every message runs through one function:

1. Pull `eventId`, `eventType`, `orgId` off the envelope; drop the message if any is
   missing.
2. **Projection short-circuit** — if `eventType === "org.member.upserted"`, upsert the
   local `OrgRecipient` row (`projectMember`) and return. This is the only event that
   maintains a read model rather than producing a notification.
3. `rulesFor(eventType)` — if no spec matches, ack and ignore (most domain events are
   not notification-worthy).
4. `extractAttachments(payload)` — pull an optional `{ reportCsv: { filename, content } }`
   out of the payload; only EMAIL uses it.
5. For each matched `NotificationSpec`:
   - `resolveRecipients(orgId, spec.audience, payload)` → set of userIds.
   - For each recipient: `resolvePreferences(orgId, userId, spec.category)` →
     the allowed channel set + quiet-hours window (in the recipient's timezone).
   - For each channel in `spec.channels` **that the recipient opted into**, call
     `deliver(...)`.

### `deliver()` — the delivery unit (`main.ts`)

`deliver()` is idempotent per `(eventId, spec.type, recipientUserId, channel)`:

```ts
const dedupeKey = `${eventId}:${spec.type}:${recipientUserId}:${channel}`;
```

It find-or-creates the `Notification` row (catching the `P2002` unique-violation on a
concurrent create), and only proceeds to dispatch if the row is still `PENDING`.
So a redelivered event never double-sends: the second pass finds a non-`PENDING` row
and returns. It then calls `dispatch()` (`channels.ts`), persists the returned
`status`/`sentAt`, and — for a **SENT IN_APP** row only — publishes to the realtime
bus for live SSE delivery.

## notifications-db (owned)

Five models in `packages/database/prisma/notifications/schema.prisma` (Prisma client
imported as `@retainiq/database/notifications`):

| Model | Purpose |
|---|---|
| `Notification` | The durable delivery record — one row per recipient×channel, unique on `dedupeKey`. The IN_APP inbox *is* these rows. |
| `NotificationPreference` | Per `(orgId, userId, category)` channel opt-in (`inApp`/`email`/`push`). |
| `NotificationSetting` | Per `(orgId, userId)` global settings: quiet hours, timezone, digest cadence + `lastDigestAt`. |
| `PushSubscription` | One row per browser Web Push (VAPID) endpoint. |
| `OrgRecipient` | Local projection of org membership (role, status, email, name) used to resolve recipients without touching identity-db. |

See `Database-Events.md` for the full field-level breakdown.

## main.ts bootstrap

`main()` (`main.ts`):

1. `prisma.$connect()` + `broker.init()` (connect / create the group; idempotent).
2. Start the consumer: `consumer.run(handle)`.
3. `startOpsServer(...)` on `HEALTH_PORT` (default **3005**) with a **readiness** probe
   that runs `SELECT 1` against `notifications-db` and `broker.ping()`, and exposes
   Prometheus metrics.
4. Start the **digest timer** — `setInterval(runDigestSweep, DIGEST_INTERVAL_MS)`
   (default 300 000 ms). Digest failures are logged, never fatal to the consumer.
5. Install SIGINT/SIGTERM handlers: a guarded `shutdown()` clears the digest timer,
   stops the consumer, closes the ops server, then races the run promise against an
   8 s timeout before closing the broker, the realtime bus, and Prisma, and exiting.

Two Prometheus counters are emitted (`createMetrics("notifications-service")`):
`notifications_created_total{channel}` and `notifications_deferred_total{channel}`
(incremented when a channel defers for quiet hours).

## Configuration

All behavior is env-driven, parsed by a Zod schema (`config.ts`,
`loadNotificationsConfig`). Notable knobs:

| Var | Default | Effect |
|---|---|---|
| `BROKER_DRIVER` | — | `redis` or `kafka` |
| `DATABASE_URL` | — | `notifications-db` (required) |
| `REDIS_URL` | — | realtime SSE bus; if unset, in-app rows persist but aren't pushed live |
| `CONSUMER_GROUP` / `CONSUMER_NAME` | `notifications-service` / `notifications-service-1` | durable group identity |
| `MAX_DELIVERIES` | 5 | retries before DLQ |
| `RECLAIM_MIN_IDLE_MS` | 30000 | pending-message reclaim window (Redis) |
| `HEALTH_PORT` | 3005 | ops/health/metrics server |
| `QUIET_HOURS_START` / `QUIET_HOURS_END` | 22 / 8 | service-wide default quiet window |
| `SMTP_HOST` … `MAIL_FROM`, `APP_URL` | — / Mailpit-friendly | email transport; unset `SMTP_HOST` ⇒ EMAIL logs instead of sends |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | — | web push; unset keys ⇒ PUSH logs instead of sends |
| `DIGEST_INTERVAL_MS` | 300000 | digest sweep cadence |

## Companion docs

- `Rules-Engine.md` — `rulesFor` / the `RULES` registry / the full handled-event table.
- `Channels-Delivery.md` — `dispatch()`, email, push, digest, dedupe/idempotency.
- `Preferences-QuietHours.md` — per-user prefs, quiet hours, the `OrgRecipient` projection.
- `Database-Events.md` — `notifications-db` models + the consumer/inbox wiring.
