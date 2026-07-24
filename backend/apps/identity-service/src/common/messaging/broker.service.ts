import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { loadConfig, parseKafkaBrokers } from "@retainiq/config";
import { createBroker, type Broker, type ConsumerOptions, type EventConsumer, type EventPublisher } from "@retainiq/messaging";
import { logger } from "../observability/observability.js";

const config = loadConfig();

/**
 * Nest wrapper around the pluggable message broker (Redis Streams or Kafka,
 * selected by BROKER_DRIVER). Owns the connection lifecycle and exposes
 * publish + readiness to the rest of identity-service.
 */
@Injectable()
export class BrokerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly broker: Broker = createBroker({
    driver: config.BROKER_DRIVER,
    clientId: "identity-service",
    redisUrl: config.REDIS_URL,
    kafkaBrokers: parseKafkaBrokers(config.KAFKA_BROKERS),
    logger,
  });
  private readonly eventPublisher: EventPublisher = this.broker.publisher();

  async onApplicationBootstrap(): Promise<void> {
    await this.broker.init();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.broker.close();
  }

  publish(stream: string, event: Record<string, unknown>): Promise<string> {
    return this.eventPublisher.publish(stream, event);
  }

  /** Create a durable consumer for a stream (at-least-once). Caller runs/stops it. */
  consumer(options: ConsumerOptions): EventConsumer {
    return this.broker.consumer(options);
  }

  ping(): Promise<void> {
    return this.broker.ping();
  }
}
