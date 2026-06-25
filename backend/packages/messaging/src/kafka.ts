import { Kafka, logLevel, type Admin, type Consumer, type Producer } from "kafkajs";
import {
  STREAMS,
  partitionKey,
  type Broker,
  type ConsumerOptions,
  type EventConsumer,
  type EventPublisher,
  type MessagingLogger,
  type StreamMessage,
} from "./types.js";

const ATTEMPTS_HEADER = "x-attempts";

/** Kafka (kafkajs) implementation of the Broker — the durable event backbone. */
export class KafkaBroker implements Broker {
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly admin: Admin;
  private readonly consumers: KafkaConsumer[] = [];
  private connected = false;

  constructor(
    brokers: string[],
    clientId: string,
    private readonly logger?: MessagingLogger,
  ) {
    this.kafka = new Kafka({ brokers, clientId, logLevel: logLevel.NOTHING });
    this.producer = this.kafka.producer({ allowAutoTopicCreation: false });
    this.admin = this.kafka.admin();
  }

  async init(): Promise<void> {
    if (this.connected) return;
    await this.admin.connect();
    await this.producer.connect();
    const base = Object.values(STREAMS);
    const topics = [...base, ...base.map((t) => `${t}.dlq`)].map((topic) => ({
      topic,
      numPartitions: 6,
      replicationFactor: 1,
    }));
    await this.admin.createTopics({ topics, waitForLeaders: true });
    this.connected = true;
    this.logger?.info({ topics: topics.map((t) => t.topic) }, "kafka broker initialized");
  }

  publisher(): EventPublisher {
    return new KafkaPublisher(this.producer);
  }

  consumer(options: ConsumerOptions): EventConsumer {
    const consumer = new KafkaConsumer(this.kafka, this.producer, options);
    this.consumers.push(consumer);
    return consumer;
  }

  async ping(): Promise<void> {
    // Cheap reachability check against a connected admin client.
    await this.admin.listTopics();
  }

  async close(): Promise<void> {
    for (const consumer of this.consumers) {
      consumer.stop();
    }
    await Promise.allSettled([
      ...this.consumers.map((c) => c.disconnect()),
      this.producer.disconnect(),
      this.admin.disconnect(),
    ]);
  }
}

class KafkaPublisher implements EventPublisher {
  constructor(private readonly producer: Producer) {}

  async publish(stream: string, event: Record<string, unknown>): Promise<string> {
    const [metadata] = await this.producer.send({
      topic: stream,
      messages: [
        {
          key: partitionKey(event) ?? null,
          value: JSON.stringify(event),
          headers: { [ATTEMPTS_HEADER]: "0" },
        },
      ],
    });
    return metadata?.baseOffset ?? "";
  }
}

/**
 * Kafka consumer-group worker. Errors don't block the partition: a failed
 * message is re-produced to the same topic with an incremented attempt header
 * (bounded retry) and parked on a `<topic>.dlq` topic once it exceeds
 * maxDeliveries. Offsets always commit, so a poison message can't wedge the group.
 */
class KafkaConsumer implements EventConsumer {
  private readonly consumer: Consumer;
  private running = false;
  private stopResolve?: () => void;

  constructor(
    kafka: Kafka,
    private readonly producer: Producer,
    private readonly options: ConsumerOptions,
  ) {
    this.consumer = kafka.consumer({ groupId: options.group, allowAutoTopicCreation: false });
  }

  async run(handler: (message: StreamMessage) => Promise<void>): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.options.stream, fromBeginning: false });
    this.running = true;

    await this.consumer.run({
      eachMessage: async ({ partition, message }) => {
        if (!this.running) return;
        const event = parseValue(message.value);
        const attempts = Number(headerValue(message.headers, ATTEMPTS_HEADER) ?? "0");
        try {
          await handler({ id: `${partition}-${message.offset}`, event });
        } catch (error) {
          await this.onFailure(event, attempts, error);
          // Swallow so the offset commits (we've retried or dead-lettered).
        }
      },
    });

    // Stay pending until stop() so the service's run loop matches the Redis driver.
    await new Promise<void>((resolve) => {
      this.stopResolve = resolve;
    });
  }

  private async onFailure(event: Record<string, unknown>, attempts: number, error: unknown): Promise<void> {
    const next = attempts + 1;
    const maxDeliveries = this.options.maxDeliveries ?? 5;
    if (next >= maxDeliveries) {
      const dlq = this.options.dlqStream ?? `${this.options.stream}.dlq`;
      await this.producer.send({
        topic: dlq,
        messages: [
          {
            key: partitionKey(event) ?? null,
            value: JSON.stringify(event),
            headers: { [ATTEMPTS_HEADER]: String(next), "x-error": String(error), "x-source": this.options.stream },
          },
        ],
      });
      this.options.logger?.error({ stream: this.options.stream, dlq, deliveries: next }, "message routed to DLQ");
      return;
    }
    this.options.logger?.warn({ stream: this.options.stream, deliveries: next, err: String(error) }, "handler failed; retrying");
    await this.producer.send({
      topic: this.options.stream,
      messages: [{ key: partitionKey(event) ?? null, value: JSON.stringify(event), headers: { [ATTEMPTS_HEADER]: String(next) } }],
    });
  }

  stop(): void {
    this.running = false;
    this.stopResolve?.();
  }

  async disconnect(): Promise<void> {
    await this.consumer.disconnect();
  }
}

function parseValue(value: Buffer | null): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value.toString()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function headerValue(headers: Record<string, unknown> | undefined, key: string): string | undefined {
  const raw = headers?.[key];
  if (raw === undefined || raw === null) return undefined;
  if (Buffer.isBuffer(raw)) return raw.toString();
  return typeof raw === "string" ? raw : undefined;
}
