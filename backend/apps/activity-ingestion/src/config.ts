import { brokerDriverSchema, kafkaBrokersSchema, logLevelSchema, nodeEnvSchema } from "@retainiq/config";
import { z } from "zod";

// The ingestion service owns its own minimal config — it needs neither the
// database nor the refresh secret — but reuses shared fragments to avoid drift.
const envSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  PORT: z.coerce.number().int().positive().default(3002),
  REDIS_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(16),
  BROKER_DRIVER: brokerDriverSchema,
  KAFKA_BROKERS: kafkaBrokersSchema,
  LOG_LEVEL: logLevelSchema,
});

export type IngestionConfig = z.infer<typeof envSchema>;

export function loadIngestionConfig(env: NodeJS.ProcessEnv = process.env): IngestionConfig {
  return envSchema.parse(env);
}
