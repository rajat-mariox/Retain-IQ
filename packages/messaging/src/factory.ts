import { KafkaBroker } from "./kafka.js";
import { RedisBroker } from "./redis.js";
import type { Broker, BrokerConfig } from "./types.js";

/**
 * Builds the configured broker. Services depend only on the Broker interface,
 * so switching `driver` from "redis" to "kafka" requires no code changes.
 */
export function createBroker(config: BrokerConfig): Broker {
  if (config.driver === "kafka") {
    const brokers = config.kafkaBrokers ?? [];
    if (brokers.length === 0) {
      throw new Error("BROKER_DRIVER=kafka requires KAFKA_BROKERS to be set.");
    }
    return new KafkaBroker(brokers, config.clientId, config.logger);
  }

  if (!config.redisUrl) {
    throw new Error("BROKER_DRIVER=redis requires REDIS_URL to be set.");
  }
  return new RedisBroker(config.redisUrl, config.logger);
}
