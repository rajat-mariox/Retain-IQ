import { loadConfig } from "@retainiq/config";
import { createLogger, createMetrics } from "@retainiq/observability";

const config = loadConfig();

// Process-wide singletons (one pino logger + one Prometheus registry per
// process — never per request). Shared by bootstrap, the Nest logger adapter,
// the exception filter, and the metrics endpoint.
export const logger = createLogger("identity-service", config.LOG_LEVEL);
export const metrics = createMetrics("identity-service");
