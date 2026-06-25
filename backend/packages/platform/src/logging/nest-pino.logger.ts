import type { LoggerService } from "@nestjs/common";
import type { Logger } from "@retainiq/observability";
import { readContext, type ContextProvider } from "../context.js";

type LogLevel = "info" | "error" | "warn" | "debug" | "trace";

/**
 * Adapts the pino logger to Nest's LoggerService so framework logs, guard
 * rejections, and `new Logger()` calls all emit structured JSON with the
 * per-request context (requestId/traceId/orgId/...) merged in.
 */
export class NestPinoLogger implements LoggerService {
  constructor(
    private readonly logger: Logger,
    private readonly contextProvider?: ContextProvider,
  ) {}

  log(message: unknown, ...optional: unknown[]): void {
    this.write("info", message, optional);
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.write("error", message, optional);
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.write("warn", message, optional);
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.write("debug", message, optional);
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.write("trace", message, optional);
  }

  private write(level: LogLevel, message: unknown, optional: unknown[]): void {
    // Nest passes the source class name as the last string argument.
    const nestContext = optional.length > 0 ? optional[optional.length - 1] : undefined;
    const bindings: Record<string, unknown> = {
      ...readContext(this.contextProvider),
      ...(typeof nestContext === "string" ? { context: nestContext } : {}),
    };
    this.logger[level](bindings, toMessage(message));
  }
}

function toMessage(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }
  if (message instanceof Error) {
    return message.message;
  }
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}
