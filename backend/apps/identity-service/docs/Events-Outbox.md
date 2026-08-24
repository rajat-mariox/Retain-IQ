# Events & Outbox

identity-service publishes domain events through a **transactional outbox**: every
event is written to the `OutboxEvent` table inside the *same* Prisma transaction
as the state change it describes, and a relay publishes committed rows to the
broker asynchronously. This guarantees an event is emitted **if and only if** its
write commits — no lost or phantom events. Delivery is at-least-once; consumers
are idempotent.

Files: `src/common/outbox/outbox.service.ts`, `src/modules/outbox/
outbox-relay.service.ts`, `STREAMS`/`BrokerService` from `@retainiq/messaging`.

## Enqueue — OutboxService

`OutboxService.enqueue(tx, params)` (`outbox.service.ts`) takes a **transaction
client** and writes one envelope-wrapped row. It must be called with the same
`tx` as the state change:

```ts
const envelope = {
  eventId: randomUUID(), eventType, schemaVersion: 1, orgId,
  actorUserId: params.actorUserId ?? ctx.userId, source: "system",
  occurredAt, ingestedAt, requestId: ctx.requestId, traceId: ctx.traceId,
  payload: params.payload,
};
return tx.outboxEvent.create({ data: { orgId, topic: STREAMS.domainEvents,
  eventType, aggregateType, aggregateId, payload: JSON.parse(JSON.stringify(envelope)) } });
```

`requestId`/`traceId` are pulled from the request context so an event is
correlated back to the request that produced it. The payload is round-tripped
through JSON to drop `undefined` for the Json column. Topic is always
`STREAMS.domainEvents` = **`"retainiq.events"`** (`packages/messaging/src/types.ts`).

Canonical usage (from `LeaveService.createRequest`):

```ts
return this.prisma.$transaction(async (tx) => {
  const req = await tx.leaveRequest.create({ … });
  await this.outbox.enqueue(tx, { eventType: "leave.requested", aggregateType: "leave_request",
    aggregateId: req.id, orgId, payload: { … } });
  return req;
});
```

## Relay — OutboxRelayService

`OutboxRelayService` (`outbox-relay.service.ts`) runs on a `@Interval(2000)` loop.
Each tick, in **one transaction**, it atomically claims a batch of PENDING rows
with `FOR UPDATE SKIP LOCKED` (so multiple replicas never grab the same rows),
publishes each to the broker, and marks them PUBLISHED:

```sql
SELECT id, topic, payload, attempts FROM "OutboxEvent"
WHERE status = 'PENDING' AND "nextRunAt" <= now()
ORDER BY "createdAt" ASC LIMIT 50 FOR UPDATE SKIP LOCKED
```

Config: `BATCH_SIZE = 50`, `MAX_ATTEMPTS = 5`, `BASE_BACKOFF_MS = 2000`. A publish
failure increments `attempts` and reschedules `nextRunAt = now + BASE_BACKOFF_MS *
attempts`; after `MAX_ATTEMPTS` the row is parked as `FAILED`. Guards
(`running`/`destroyed`) prevent overlapping ticks and publishing during shutdown.
Metrics: `outbox_pending_events` (gauge), `outbox_published_total` (counter).

`OutboxStatus` = `PENDING | PUBLISHED | FAILED`.

## Broker

`BrokerService` (`src/common/messaging`) wraps the `@retainiq/messaging` broker
factory, which selects **Kafka or Redis Streams** by `BROKER_DRIVER`
(`packages/messaging/src/factory.ts` — Kafka requires `KAFKA_BROKERS`, Redis
requires `REDIS_URL`). All identity domain events flow on the single
`retainiq.events` stream; consumers (billing-service, payroll-service) subscribe
in their own durable consumer groups and dedupe by `eventId`.

## Emitted event types (complete)

Grepped from `eventType:` across `src/modules`, with the emitting file:

| Event type | Emitted by |
|---|---|
| `org.registered` | `identity/identity.service.ts` (org sign-up) |
| `org.member.upserted` | `identity/identity.service.ts`, `members/members.service.ts` |
| `organization.created` | `platform-admin/admin.service.ts` (super-admin provisions org) |
| `organization.headcount` | `seat-sync/seat-sync.service.ts` |
| `employee.created` | `employee/employee.service.ts` |
| `employee.confirmed` | `employee/probation.service.ts` |
| `employee.promoted` / `employee.transferred` | `employee/change-request.service.ts` (on `apply()`) |
| `employee.change_approval_pending` / `employee.change_decided` | `employee/change-request.service.ts` |
| `employee.exit_started` / `employee.exited` / `employee.access_revoked` | `employee/exit.service.ts` |
| `employee.alumni_created` | `employee/exit.service.ts` |
| `probation.ending` | `employee/probation-reminders.service.ts` (cron) |
| `certification.expiring` | `employee/certification-reminders.service.ts` (cron) |
| `attendance.correction_requested` / `attendance.correction_decided` | `attendance/attendance-correction.service.ts` |
| `attendance.auto_checked_out` | `attendance/attendance-autoclose.service.ts` (cron) |
| `leave.requested` / `leave.decided` / `leave.cancelled` | `leave/leave.service.ts` |
| `timesheet.submitted` / `timesheet.decided` | `timetracking/timetracking.service.ts` |
| `task.assigned` | `projects/projects.service.ts` (on genuine reassignment) |
| `escalation.created` | `escalation/escalation.service.ts`, `escalation/escalation-sla.service.ts` (cron auto-bump, `auto: true`) |
| `recognition.created` | `performance/performance.service.ts` |
| `report.scheduled` | `attendance/report-schedule.service.ts` |
| `report.ready` | `reports/report-jobs.service.ts` |

Many of these carry a `requesterUserId` (or `requterUserId` recipient) in the
payload so notifications-service can turn them into per-user inbox notifications
idempotently per `(event, recipient)`.

## Who consumes them

- **notifications-service** — turns `leave.*`, `timesheet.*`, `escalation.created`,
  `employee.change_*`, `attendance.correction_*`, reminder events (`probation.
  ending`, `certification.expiring`) into inbox/push/email notifications.
- **billing-service** — `org.registered`/`organization.created` provisions a
  subscription; `organization.headcount` drives seat billing.
- **payroll-service** — projects `employee.*`, `attendance.overtime_approved`,
  `leave.decided` (APPROVED), `timesheet.decided` (APPROVED), `time.entry.recorded`
  into its read-models (see payroll-service `Events.md`).
