# activity-ingestion — Events

activity-ingestion is a **pure producer**. It consumes nothing; it emits one
message per accepted activity event onto the shared activity stream. This doc
covers the broker abstraction it uses, the stream it targets, the message shape it
puts on the wire, and the downstream consumers that read it.

Files: `src/broker.service.ts`, `src/ingestion.service.ts`, the stream registry in
`@retainiq/messaging` (`backend/packages/messaging/src/types.ts`).

## Broker abstraction (`src/broker.service.ts`)

The service depends on the `@retainiq/messaging` `Broker` interface, not on a
specific broker. The same code runs on **Redis Streams or Kafka** per
`BROKER_DRIVER`:

```ts
@Injectable()
export class BrokerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly broker: Broker = createBroker({
    driver: config.BROKER_DRIVER,
    clientId: "ingestion-service",
    redisUrl: config.REDIS_URL,
    kafkaBrokers: parseKafkaBrokers(config.KAFKA_BROKERS),
    logger,
  });
  private readonly eventPublisher: EventPublisher = this.broker.publisher();

  async onApplicationBootstrap() { await this.broker.init(); }   // connect / create topics
  async onApplicationShutdown()  { await this.broker.close(); }  // drain on SIGTERM

  publish(stream: string, event: Record<string, unknown>) {
    return this.eventPublisher.publish(stream, event);           // returns message id
  }
  ping() { return this.broker.ping(); }                          // readiness probe
}
```

- **Lifecycle is tied to Nest.** `broker.init()` runs on
  `OnApplicationBootstrap`; `broker.close()` on `OnApplicationShutdown` (reached
  because `main.ts` calls `enableShutdownHooks()`), so in-flight publishes drain on
  rollout/SIGTERM.
- `clientId: "ingestion-service"` identifies this producer to the broker.
- `broker.ping()` backs the `/v1/health/ready` readiness check (see
  `Operations.md`).
- `publish` returns the broker-assigned message id (Redis Stream id / Kafka
  offset), though the ingestion path does not surface it to the caller.

## Stream / topic name

There is exactly one target, from the shared registry
(`backend/packages/messaging/src/types.ts`):

```ts
export const STREAMS = {
  domainEvents: "retainiq.events",     // transactional outbox events (not used here)
  activity:     "retainiq.activity",   // high-volume activity events (this service)
} as const;
```

activity-ingestion only ever publishes to **`STREAMS.activity` =
`"retainiq.activity"`**.

### Partitioning / ordering

`@retainiq/messaging` derives a partition key with `partitionKey(event)`
(`types.ts`): `` `${orgId}:${employeeId}` `` when both are present, else `orgId`.
Because the envelope carries both `orgId` and `employeeId`, a given employee's
events are co-located and kept in order within a partition on Kafka.

## Emitted message shape

Every accepted event becomes one message with this envelope
(`src/ingestion.service.ts`):

| Field | Source | Notes |
|---|---|---|
| `eventId` | `randomUUID()` (server) | idempotency key consumers de-dupe on |
| `eventType` | agent | one of the `activity.*` enum (see `Ingestion-Pipeline.md`) |
| `schemaVersion` | constant `1` | envelope schema version |
| `orgId` | JWT claim | tenant; not taken from body |
| `employeeId` | agent (optional) | subject; may be absent |
| `source` | constant `"desktop-agent"` | provenance |
| `sourceEventId` | agent (optional) | agent-side id, dedupe hint |
| `occurredAt` | agent | ISO-8601, when the activity happened |
| `ingestedAt` | server | ISO-8601, batch receive time |
| `payload` | agent | free-form `Record<string, unknown>`, defaults `{}` |

Delivery is **at-least-once**: publish is the durability boundary, and
idempotency/dedupe is the consumers' job (below).

## Downstream consumers

The `retainiq.activity` stream is read by two independent, durably-grouped
workers. activity-ingestion has no knowledge of them beyond the shared stream name;
they subscribe on their own.

### 1. event-processor (`backend/apps/event-processor/src/main.ts`)

Subscribes to **both** core streams:

```ts
const SUBSCRIBED_STREAMS: StreamName[] = [STREAMS.domainEvents, STREAMS.activity];
```

Consumer group / consumer come from `config.CONSUMER_GROUP` /
`config.CONSUMER_NAME` (group `"event-processor"`). It records each `eventId` in a
`consumedEvent` row (columns `eventId`, `consumer`, `stream`, `eventType`,
`orgId`, ...) — the **inbox de-dupe** against the at-least-once delivery. Uses
`maxDeliveries` + `reclaimMinIdleMs` for DLQ / stuck-message reclaim.

### 2. analytics-service (`backend/apps/analytics-service/src/main.ts`)

A dedicated activity consumer that turns events into employee productivity
day-facts:

```ts
const consumer = broker.consumer({
  stream: STREAMS.activity,
  group: config.CONSUMER_GROUP,      // "analytics-service"
  consumer: config.CONSUMER_NAME,
  maxDeliveries: config.MAX_DELIVERIES,
  reclaimMinIdleMs: config.RECLAIM_MIN_IDLE_MS,
  logger,
});
```

- **Idempotent apply**: it inserts the `consumedEvent` inbox row *and* increments
  day-fact counters in one Prisma `$transaction`; a redelivered `eventId` trips the
  unique `(eventId, consumer)` constraint, the tx rolls back, and counters are not
  double-applied.
- Events missing `orgId`/`employeeId` are acked and skipped ("can't be scored").
- **CPU-bound scoring** runs off the consumer loop in a `piscina` worker_threads
  pool (`score.task.js`), so the consumer stays unblocked under load.

### Consumer autoscaling (KEDA)

Both consumers scale on the **backlog of `retainiq.activity`**, not CPU — the
inverse of the producer's CPU-based HPA. Each owns a `keda.sh/v1alpha1`
`ScaledObject` (`backend/infra/k8s/event-processor.yaml`,
`analytics-service.yaml`):

```yaml
kind: ScaledObject          # requires KEDA in the cluster
# ...
triggers:
  - type: redis-streams
    metadata:
      addressFromEnv: REDIS_URL
      stream: "retainiq.activity"
      consumerGroup: "event-processor"   # resp. "analytics-service"
      pendingEntriesCount: "100"
```

So a spike in ingested activity grows the stream backlog, which KEDA turns into
more consumer replicas — while the producer tier scales independently on request
CPU.

## Flow at a glance

```
agent batch ──202──▶ activity-ingestion ──publish(N)──▶ retainiq.activity
                                                          ├─▶ event-processor  (group "event-processor", inbox de-dupe)
                                                          └─▶ analytics-service (group "analytics-service", day-facts + scoring)
```
