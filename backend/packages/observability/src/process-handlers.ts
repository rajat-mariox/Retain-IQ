import type { Logger } from "./index.js";

/**
 * Installs last-resort handlers so a process never dies silently. Unhandled
 * rejections are logged; an uncaught exception is logged at fatal and the
 * process exits non-zero so the orchestrator restarts it cleanly.
 */
export function installProcessErrorHandlers(logger: Logger): void {
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error({ err: serializeError(reason) }, "unhandledRejection");
  });

  process.on("uncaughtException", (error: unknown) => {
    logger.fatal({ err: serializeError(error) }, "uncaughtException");
    setTimeout(() => process.exit(1), 100).unref();
  });
}

function serializeError(error: unknown): Record<string, unknown> | string {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}
