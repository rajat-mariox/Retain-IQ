import { Redis } from "ioredis";
import {
  type Broker,
  type ConsumerOptions,
  type EventConsumer,
  type EventPublisher,
  type MessagingLogger,
  type StreamMessage,
} from "./types.js";

const EVENT_FIELD = "event";

type RawStreamReply = Array<[string, Array<[string, string[]]>]> | null;
type RawEntries = Array<[string, string[]]>;
type RawPending = Array<[string, string, number, number]> | null;

/** Redis Streams implementation of the Broker. */
export class RedisBroker implements Broker {
  private readonly connections: Redis[] = [];
  private pub?: Redis;

  constructor(
    private readonly url: string,
    private readonly logger?: MessagingLogger,
  ) {}

  private connect(): Redis {
    const redis = new Redis(this.url, { maxRetriesPerRequest: null });
    redis.on("error", (error: Error) => this.logger?.error({ err: error.message }, "redis error"));
    this.connections.push(redis);
    return redis;
  }

  init(): Promise<void> {
    return Promise.resolve();
  }

  publisher(): EventPublisher {
    this.pub ??= this.connect();
    return new RedisStreamPublisher(this.pub);
  }

  consumer(options: ConsumerOptions): EventConsumer {
    // Each consumer needs its own connection (XREADGROUP blocks it).
    return new RedisStreamConsumer(this.connect(), options);
  }

  async ping(): Promise<void> {
    this.pub ??= this.connect();
    await this.pub.ping();
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.connections.map((c) => c.quit()));
  }
}

class RedisStreamPublisher implements EventPublisher {
  constructor(private readonly redis: Redis) {}

  async publish(stream: string, event: Record<string, unknown>): Promise<string> {
    const id = await this.redis.xadd(stream, "*", EVENT_FIELD, JSON.stringify(event));
    return id ?? "";
  }
}

/**
 * At-least-once consumer with crash recovery (XPENDING+XCLAIM reclaim),
 * delivery-count tracking, DLQ routing, and transient-error backoff.
 */
class RedisStreamConsumer implements EventConsumer {
  private running = false;

  constructor(
    private readonly redis: Redis,
    private readonly options: ConsumerOptions,
  ) {}

  private async ensureGroup(): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.redis.xgroup("CREATE", this.options.stream, this.options.group, "$", "MKSTREAM");
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("BUSYGROUP")) return;
        if (attempt >= 10) throw error;
        await delay(1000);
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  async run(handler: (message: StreamMessage) => Promise<void>): Promise<void> {
    await this.ensureGroup();
    this.running = true;
    while (this.running) {
      try {
        await this.reclaimPending(handler);
        await this.readNew(handler);
      } catch (error) {
        this.options.logger?.error(
          { stream: this.options.stream, err: String(error) },
          "consumer loop error; backing off",
        );
        await delay(this.options.errorBackoffMs ?? 1000);
      }
    }
  }

  private async readNew(handler: (message: StreamMessage) => Promise<void>): Promise<void> {
    const reply = (await this.redis.xreadgroup(
      "GROUP",
      this.options.group,
      this.options.consumer,
      "COUNT",
      this.options.count ?? 10,
      "BLOCK",
      this.options.blockMs ?? 5000,
      "STREAMS",
      this.options.stream,
      ">",
    )) as RawStreamReply;
    if (!reply) return;
    for (const [, entries] of reply) {
      for (const [id, fields] of entries) {
        await this.process(id, parseFields(fields), 1, handler);
      }
    }
  }

  private async reclaimPending(handler: (message: StreamMessage) => Promise<void>): Promise<void> {
    const minIdle = this.options.reclaimMinIdleMs ?? 30_000;
    const pending = (await this.redis.xpending(
      this.options.stream,
      this.options.group,
      "IDLE",
      minIdle,
      "-",
      "+",
      this.options.count ?? 10,
    )) as RawPending;
    if (!pending || pending.length === 0) return;
    for (const [id, , , priorDeliveries] of pending) {
      const claimed = (await this.redis.xclaim(
        this.options.stream,
        this.options.group,
        this.options.consumer,
        minIdle,
        id,
      )) as RawEntries;
      const entry = claimed[0];
      if (!entry) continue;
      await this.process(id, parseFields(entry[1]), Number(priorDeliveries) + 1, handler);
    }
  }

  private async process(
    id: string,
    event: Record<string, unknown>,
    deliveries: number,
    handler: (message: StreamMessage) => Promise<void>,
  ): Promise<void> {
    try {
      await handler({ id, event });
      await this.redis.xack(this.options.stream, this.options.group, id);
    } catch (error) {
      const maxDeliveries = this.options.maxDeliveries ?? 5;
      this.options.logger?.warn(
        { stream: this.options.stream, id, deliveries, err: String(error) },
        "stream handler failed",
      );
      if (deliveries >= maxDeliveries) {
        const dlq = this.options.dlqStream ?? `${this.options.stream}.dlq`;
        await this.redis.xadd(
          dlq,
          "*",
          EVENT_FIELD,
          JSON.stringify(event),
          "meta",
          JSON.stringify({ originalId: id, sourceStream: this.options.stream, deliveries, error: String(error) }),
        );
        await this.redis.xack(this.options.stream, this.options.group, id);
        this.options.logger?.error({ stream: this.options.stream, dlq, id, deliveries }, "message routed to DLQ");
      }
    }
  }
}

function parseFields(fields: string[]): Record<string, unknown> {
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === EVENT_FIELD) {
      try {
        return JSON.parse(fields[i + 1] as string) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
  }
  return {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
