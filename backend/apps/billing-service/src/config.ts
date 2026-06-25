import { brokerDriverSchema, kafkaBrokersSchema, logLevelSchema } from "@retainiq/config";
import { z } from "zod";

const envSchema = z.object({
  REDIS_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url(), // billing database
  BROKER_DRIVER: brokerDriverSchema,
  KAFKA_BROKERS: kafkaBrokersSchema,
  LOG_LEVEL: logLevelSchema,
  CONSUMER_GROUP: z.string().default("billing-service"),
  CONSUMER_NAME: z.string().default("billing-service-1"),
  HEALTH_PORT: z.coerce.number().int().positive().default(3006),
  MAX_DELIVERIES: z.coerce.number().int().positive().default(5),
  RECLAIM_MIN_IDLE_MS: z.coerce.number().int().positive().default(30000),
});

export type BillingConfig = z.infer<typeof envSchema>;

export function loadBillingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig {
  return envSchema.parse(env);
}
