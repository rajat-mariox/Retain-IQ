import { createLogger, createMetrics } from "@retainiq/observability";
import { loadIngestionConfig } from "./config.js";

const config = loadIngestionConfig();

export const logger = createLogger("ingestion-service", config.LOG_LEVEL);
export const metrics = createMetrics("ingestion-service");
