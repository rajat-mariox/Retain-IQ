import { brokerDriverSchema, kafkaBrokersSchema, logLevelSchema } from "@retainiq/config";
import { z } from "zod";

const envSchema = z.object({
  REDIS_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url(),
  BROKER_DRIVER: brokerDriverSchema,
  KAFKA_BROKERS: kafkaBrokersSchema,
  LOG_LEVEL: logLevelSchema,
  CONSUMER_GROUP: z.string().default("event-processor"),
  CONSUMER_NAME: z.string().default("event-processor-1"),
  HEALTH_PORT: z.coerce.number().int().positive().default(3003),
  MAX_DELIVERIES: z.coerce.number().int().positive().default(5),
  RECLAIM_MIN_IDLE_MS: z.coerce.number().int().positive().default(30000),
});

export type WorkerConfig = z.infer<typeof envSchema>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return envSchema.parse(env);
}
