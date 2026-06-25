import { brokerDriverSchema, kafkaBrokersSchema, logLevelSchema } from "@retainiq/config";
import { z } from "zod";

const envSchema = z.object({
  REDIS_URL: z.string().url().optional(),
  DATABASE_URL: z.string().url(),
  BROKER_DRIVER: brokerDriverSchema,
  KAFKA_BROKERS: kafkaBrokersSchema,
  LOG_LEVEL: logLevelSchema,
  CONSUMER_GROUP: z.string().default("notifications-service"),
  CONSUMER_NAME: z.string().default("notifications-service-1"),
  HEALTH_PORT: z.coerce.number().int().positive().default(3005),
  MAX_DELIVERIES: z.coerce.number().int().positive().default(5),
  RECLAIM_MIN_IDLE_MS: z.coerce.number().int().positive().default(30000),
  // Quiet hours (local hour, wrap-around supported). EMAIL/PUSH are deferred
  // during this window; IN_APP is always delivered.
  QUIET_HOURS_START: z.coerce.number().int().min(0).max(23).default(22),
  QUIET_HOURS_END: z.coerce.number().int().min(0).max(23).default(8),
});

export type NotificationsConfig = z.infer<typeof envSchema>;

export function loadNotificationsConfig(env: NodeJS.ProcessEnv = process.env): NotificationsConfig {
  return envSchema.parse(env);
}
