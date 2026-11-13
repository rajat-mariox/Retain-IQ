# Database & Events

notifications-service owns **`notifications-db`** and consumes the shared
domain-events stream. Unlike payroll-service, it has **no transactional outbox and no
consumer inbox table** — it is a terminal consumer (delivery is the side effect), and
idempotency is enforced at the delivery row via a unique `dedupeKey`.

Schema: `packages/database/prisma/notifications/schema.prisma`
(Prisma client imported as `@retainiq/database/notifications`).
Wiring: `src/main.ts`.

## notifications-db models

Five models, all keyed/scoped by `orgId` (database-per-service; no cross-DB FKs — ids
are plain `@db.Uuid`).

### `Notification` — the durable delivery record

One row per recipient×channel×event. The IN_APP inbox *is* these rows.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `orgId`, `recipientUserId` | uuid | tenant + target user |
| `channel` | `NotificationChannel` | IN_APP · EMAIL · PUSH |
| `category` | `NotificationCategory` | default SYSTEM (ATTENDANCE·PRODUCTIVITY·PROJECT·AI·SYSTEM) |
| `priority` | `NotificationPriority` | default NORMAL (LOW·NORMAL·HIGH·CRITICAL) |
| `type`, `title`, `body` | String | from the matched `NotificationSpec` |
| `link` | String? | optional deep link |
| `status` | `NotificationStatus` | default PENDING → SENT·READ·DEFERRED·SUPPRESSED·FAILED |
| `dedupeKey` | String **@unique** | `${eventId}:${type}:${recipientUserId}:${channel}` |
| `sourceEventId` | uuid? | originating domain-event id |
| `sentAt`, `readAt`, `archivedAt`, `createdAt` | DateTime | lifecycle timestamps |

Indexes support the inbox UI: `(orgId, recipientUserId, status, createdAt)`,
`(orgId, recipientUserId, category, createdAt)`, `(orgId, createdAt)`.

### `NotificationPreference` — per-category channel opt-in

`@@unique([orgId, userId, category])`. Booleans `inApp` (default true), `email`
(default false), `push` (default false). Absent row ⇒ category `DEFAULTS` apply
(`preferences.ts`).

### `NotificationSetting` — per-user global settings

`@@unique([orgId, userId])`. Quiet hours (`quietHoursEnabled`, `quietStart` 22,
`quietEnd` 8, `timezone` "UTC") and digest cadence (`digest` "OFF"|"DAILY"|"WEEKLY",
`digestHour` 9, `lastDigestAt`). Drives both quiet-hours gating and the digest sweep.

### `PushSubscription` — one row per browser Web Push endpoint

`endpoint @unique`, plus `p256dh`/`auth` VAPID keys, `userAgent`, `lastUsedAt`.
Indexed `(orgId, userId)`. `PushSender` fans out to all of a user's rows and prunes
`404`/`410` endpoints.

### `OrgRecipient` — local membership projection

`@@unique([orgId, userId])`, indexed `(orgId, status, roleName)`. Holds `roleName`,
`status` (default ACTIVE), and projected `email`/`name`. This is the read model that
lets recipient resolution and email addressing avoid identity-db entirely.

## Event consumption

The worker runs a single durable consumer over `STREAMS.domainEvents`
(`"retainiq.events"`) in the group `CONSUMER_GROUP` (default `notifications-service`),
on Redis Streams or Kafka per `BROKER_DRIVER` (`main.ts`).

```ts
const consumer = broker.consumer({
  stream: STREAMS.domainEvents,
  group: config.CONSUMER_GROUP,
  consumer: config.CONSUMER_NAME,
  maxDeliveries: config.MAX_DELIVERIES,       // default 5 → then DLQ (<stream>.dlq)
  reclaimMinIdleMs: config.RECLAIM_MIN_IDLE_MS, // default 30000
  logger,
});
consumer.run(handle);
```

### Delivery guarantees

- **At-least-once, at-broker.** On Redis (`packages/messaging/src/redis.ts`) it's a
  consumer-group reader: `XREADGROUP` delivers a batch, a successful `handle()` is
  `XACK`ed; a throwing handler leaves the message pending, to be reclaimed after
  `reclaimMinIdleMs` and retried up to `maxDeliveries`, then parked in the DLQ and
  acked. Kafka offers the equivalent via its consumer group.
- **Idempotent, at-service.** There is **no inbox table**. Redelivery is absorbed by
  the `Notification.dedupeKey` unique constraint in `deliver()`: the create either
  races and catches `P2002`, or the row already exists in a non-`PENDING` state and
  the function returns without re-sending (see `Channels-Delivery.md`).

### How identity events arrive

Producers (identity-service and the other feature services) publish domain events onto
`retainiq.events` via their own transactional outbox + relay; notifications-service is
one of several independent consumer groups on that stream. Every message is a standard
envelope — `handle()` reads `eventId`, `eventType`, `orgId`, and `payload` off it and
drops anything missing the three required fields.

Two distinct paths inside `handle()`:

1. **`org.member.upserted`** → `projectMember()` upserts `OrgRecipient` and acks. This
   is the sole event that maintains a read model; it produces no notification. Idempotent
   on `(orgId, userId)`; a payload that omits `email`/`name` never blanks stored values.
2. **Everything else** → `rulesFor(eventType)`. No match ⇒ ack and ignore. A match runs
   the resolve→prefs→quiet→dispatch pipeline (see `Rules-Engine.md`,
   `Preferences-QuietHours.md`, `Channels-Delivery.md`). The 36 handled event types are
   listed in `Rules-Engine.md`; the fields each rule reads off `payload` (e.g.
   `requesterUserId`, `assigneeUserId`, `status`, `reportCsv`) are the contract the
   producing services must satisfy.

### Realtime last hop (not the durable path)

Separate from the durable broker, `main.ts` optionally holds a `RedisRealtimeBus`
(when `REDIS_URL` is set). After a **SENT IN_APP** row is persisted, `deliver()`
publishes it to `userNotificationChannel(recipientUserId)`
(`notifications:user:<userId>`) so an API instance holding the user's SSE/WebSocket
connection can push it live. This is fire-and-forget — the authoritative copy is
already the `Notification` row in Postgres — so if `REDIS_URL` is unset, in-app rows
still persist, just without the live push (`main.ts` lines 56-60).

## Health & metrics

The ops server (`startOpsServer`, port `HEALTH_PORT` default 3005) exposes readiness —
`SELECT 1` against notifications-db plus `broker.ping()` — and Prometheus metrics:
`notifications_created_total{channel}` and `notifications_deferred_total{channel}`.
