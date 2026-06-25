import "@retainiq/config/env"; // load .env for host/dev runs (no-op in prod) — must be first
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { installProcessErrorHandlers, NestPinoLogger } from "@retainiq/platform";
import { AppModule } from "./app.module.js";
import { loadIngestionConfig } from "./config.js";
import { logger } from "./observability.js";

const config = loadIngestionConfig();
installProcessErrorHandlers(logger);

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bufferLogs: true,
  });
  app.useLogger(new NestPinoLogger(logger));
  app.flushLogs();
  app.enableShutdownHooks();
  app.setGlobalPrefix("v1");

  await app.listen(config.PORT, "0.0.0.0");
  logger.info({ port: config.PORT }, "RetainIQ ingestion-service started");
}

void bootstrap().catch((error) => {
  logger.fatal({ err: String(error) }, "ingestion-service bootstrap failed");
  process.exit(1);
});
