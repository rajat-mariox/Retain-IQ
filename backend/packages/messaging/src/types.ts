/** Logical stream/topic names shared across services. */
export const STREAMS = {
  /** Domain events relayed from the core-api transactional outbox. */
  domainEvents: "retainiq.events",
  /** High-volume activity events from the ingestion service. */
  activity: "retainiq.activity",
} as const;

export type StreamName = (typeof STREAMS)[keyof typeof STREAMS];

export type StreamMessage<T = Record<string, unknown>> = {
  id: string;
  event: T;
};

/** Minimal structural logger so messaging needn't depend on a logging lib. */
export type MessagingLogger = {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
};

export type ConsumerOptions = {
  stream: StreamName;
  group: string;
  consumer: string;
  blockMs?: number;
  count?: number;
  /** Deliveries attempted before a message is parked in the DLQ. */
  maxDeliveries?: number;
  /** Redis only: a message pending longer than this is reclaimed. */
  reclaimMinIdleMs?: number;
  /** Override the dead-letter topic/stream (default `<stream>.dlq`). */
  dlqStream?: string;
  errorBackoffMs?: number;
  logger?: MessagingLogger;
};

/** Publishes JSON events to a topic/stream. */
export interface EventPublisher {
  publish(stream: string, event: Record<string, unknown>): Promise<string>;
}

/** A durable, at-least-once consumer. `run` stays pending until `stop()`. */
export interface EventConsumer {
  run(handler: (message: StreamMessage) => Promise<void>): Promise<void>;
  stop(): void;
}

/**
 * Broker abstraction. The same contract is satisfied by Redis Streams and
 * Kafka, so services depend on this — not on a specific broker.
 */
export interface Broker {
  /** Connect / create topics. Idempotent. */
  init(): Promise<void>;
  publisher(): EventPublisher;
  consumer(options: ConsumerOptions): EventConsumer;
  /** Readiness check — throws if the broker is unreachable. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export type BrokerDriver = "redis" | "kafka";

export type BrokerConfig = {
  driver: BrokerDriver;
  clientId: string;
  redisUrl?: string;
  kafkaBrokers?: string[];
  logger?: MessagingLogger;
};

/** Partition key — co-locates a tenant's (and employee's) events in order. */
export function partitionKey(event: Record<string, unknown>): string | undefined {
  const orgId = typeof event.orgId === "string" ? event.orgId : undefined;
  if (!orgId) {
    return undefined;
  }
  const employeeId = typeof event.employeeId === "string" ? event.employeeId : undefined;
  return employeeId ? `${orgId}:${employeeId}` : orgId;
}
