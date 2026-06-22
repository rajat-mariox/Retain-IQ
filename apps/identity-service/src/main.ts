import "@retainiq/config/env"; // load .env for host/dev runs (no-op in prod) — must be first
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadConfig } from "@retainiq/config";
import { installProcessErrorHandlers, NestPinoLogger } from "@retainiq/platform";
import { AppModule } from "./app.module.js";
import { getRequestContext } from "./common/context/request-context.store.js";
import { logger } from "./common/observability/observability.js";

const config = loadConfig();
installProcessErrorHandlers(logger);

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );

  // Route all framework logs through pino with per-request correlation.
  app.useLogger(new NestPinoLogger(logger, getRequestContext));
  app.flushLogs();

  app.enableShutdownHooks();
  app.enableCors({ origin: true, credentials: true });
  // Request validation is handled per-route by ZodValidationPipe against the
  // schemas in @retainiq/contracts (single source of truth), so no global
  // class-validator pipe is registered.
  app.setGlobalPrefix("v1");

  await app.listen(config.PORT, "0.0.0.0");
  logger.info({ port: config.PORT }, "RetainIQ identity-service started");
}

void bootstrap().catch((error) => {
  logger.fatal({ err: String(error) }, "identity-service bootstrap failed");
  process.exit(1);
});
