import { brokerDriverSchema, kafkaBrokersSchema, logLevelSchema } from "@retainiq/config";
import { z } from "zod";

const envSchema = z.object({
  REDIS_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url(),
  BROKER_DRIVER: brokerDriverSchema,
  KAFKA_BROKERS: kafkaBrokersSchema,
  LOG_LEVEL: logLevelSchema,
  CONSUMER_GROUP: z.string().default("analytics-service"),
  CONSUMER_NAME: z.string().default("analytics-service-1"),
  HEALTH_PORT: z.coerce.number().int().positive().default(3004),
  MAX_DELIVERIES: z.coerce.number().int().positive().default(5),
  RECLAIM_MIN_IDLE_MS: z.coerce.number().int().positive().default(30000),
  // worker_threads pool size for CPU-bound scoring (default: cores - 1).
  SCORING_THREADS: z.coerce.number().int().positive().optional(),
});

export type AnalyticsConfig = z.infer<typeof envSchema>;

export function loadAnalyticsConfig(env: NodeJS.ProcessEnv = process.env): AnalyticsConfig {
  return envSchema.parse(env);
}
