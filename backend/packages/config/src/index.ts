import { z } from "zod";

/** Reusable fragments so per-service configs don't drift. */
export const nodeEnvSchema = z
  .enum(["development", "test", "staging", "production"])
  .default("development");

export const logLevelSchema = z
  .enum(["fatal", "error", "warn", "info", "debug", "trace"])
  .default("info");

export const brokerDriverSchema = z.enum(["redis", "kafka"]).default("redis");

/** Comma-separated Kafka bootstrap brokers, e.g. "localhost:29092". */
export const kafkaBrokersSchema = z.string().optional();

export function parseKafkaBrokers(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

/**
 * A boolean from an env var. Use this instead of z.coerce.boolean(), which runs
 * JS Boolean() — making the string "false" evaluate to TRUE and silently turning
 * a flag on when someone explicitly disabled it. Only the words below count as
 * true; anything else (including "false", "0", "no", "") is false.
 */
export const envBoolean = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["true", "1", "yes", "on"].includes(v.trim().toLowerCase())));

const PLACEHOLDER_SECRET = /replace|change[-_]?me|changeme|secret-here|example/i;

const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    // Read-only binding to the analytics service DB, used by the platform-admin
    // reporting API to aggregate EmployeeDayFact across orgs (BFF read pattern).
    ANALYTICS_DATABASE_URL: z.string().url().optional(),
    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    /**
     * Return the password-reset token in the API response instead of emailing it.
     *
     * DEV CONVENIENCE ONLY — there is no mail sender wired up yet. With this on,
     * the response reveals whether an account exists AND hands the caller a reset
     * for any address they can name. Defaults to off; only docker-compose.yml
     * (local) sets it. Never set it in a deployed environment.
     */
    // NOT z.coerce.boolean(): that runs JS Boolean(), and Boolean("false") is
    // true — so RESET_TOKEN_IN_RESPONSE=false would have turned the leak ON.
    // Env values are strings; only an explicit opt-in word enables this.
    RESET_TOKEN_IN_RESPONSE: envBoolean.default(false),
    // Platform (super-admin) auth — a cross-tenant principal with its OWN signing
    // secret so an org access token can never be replayed against admin routes.
    PLATFORM_JWT_SECRET: z.string().min(16),
    PLATFORM_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(28800), // 8h
    PLATFORM_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(14),
    // Optional bootstrap: identity-service seeds this super admin on startup if
    // it does not already exist. Leave unset to manage admins another way.
    PLATFORM_ADMIN_EMAIL: z.string().email().optional(),
    PLATFORM_ADMIN_PASSWORD: z.string().min(12).optional(),
    PERMISSION_CACHE_DRIVER: z.enum(["memory", "redis"]).default("memory"),
    AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
    AUTH_RATE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    BROKER_DRIVER: brokerDriverSchema,
    KAFKA_BROKERS: kafkaBrokersSchema,
    LOG_LEVEL: logLevelSchema,
  })
  .superRefine((cfg, ctx) => {
    // Distinct secrets are mandatory everywhere — a shared access/refresh secret
    // lets an access token be replayed as a refresh token.
    if (cfg.JWT_ACCESS_SECRET === cfg.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_REFRESH_SECRET"],
        message: "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ.",
      });
    }
    // The platform secret must be distinct from both org secrets — same replay
    // reasoning, across the tenant/platform boundary.
    if (
      cfg.PLATFORM_JWT_SECRET === cfg.JWT_ACCESS_SECRET ||
      cfg.PLATFORM_JWT_SECRET === cfg.JWT_REFRESH_SECRET
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PLATFORM_JWT_SECRET"],
        message: "PLATFORM_JWT_SECRET must differ from the org JWT secrets.",
      });
    }
    // Placeholder secrets must never reach production.
    if (cfg.NODE_ENV === "production") {
      for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "PLATFORM_JWT_SECRET"] as const) {
        if (PLACEHOLDER_SECRET.test(cfg[key])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} must not use a placeholder value in production.`,
          });
        }
      }
      // NOTE: RESET_TOKEN_IN_RESPONSE is deliberately NOT gated on NODE_ENV.
      // Every service image sets NODE_ENV=production for Node's runtime
      // optimisations, so local `npm run up` containers report "production" too —
      // gating here would break local development while proving nothing about a
      // real deployment. The flag defaults to OFF and must be set explicitly;
      // keep it out of production compose/env files.
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
