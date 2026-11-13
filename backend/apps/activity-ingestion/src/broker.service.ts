import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { parseKafkaBrokers } from "@retainiq/config";
import { createBroker, type Broker, type EventPublisher } from "@retainiq/messaging";
import { loadIngestionConfig } from "./config.js";
import { logger } from "./observability.js";

const config = loadIngestionConfig();

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

  async onApplicationBootstrap(): Promise<void> {
    await this.broker.init();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.broker.close();
  }

  publish(stream: string, event: Record<string, unknown>): Promise<string> {
    return this.eventPublisher.publish(stream, event);
  }

  ping(): Promise<void> {
    return this.broker.ping();
  }
}
