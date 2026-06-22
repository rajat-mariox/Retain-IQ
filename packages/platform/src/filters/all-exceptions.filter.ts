import {
  type ArgumentsHost,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { HttpAdapterHost } from "@nestjs/core";
import type { Logger } from "@retainiq/observability";
import { readContext, type ContextProvider } from "../context.js";

export type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    request_id?: string;
    details?: unknown;
  };
};

/**
 * Catch-all exception filter. Produces the standardized error envelope
 * `{ error: { code, message, request_id, details } }` (architecture doc §04),
 * maps known Prisma errors to proper HTTP statuses, never leaks internal
 * exception details on 5xx, and logs with request correlation.
 *
 * Registered via `app.useGlobalFilters(new AllExceptionsFilter(...))` so it can
 * be constructed with the service's logger and context provider.
 */
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: Logger,
    private readonly contextProvider?: ContextProvider,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const context = readContext(this.contextProvider);
    const requestId = typeof context.requestId === "string" ? context.requestId : undefined;

    const mapped = this.mapException(exception);

    const envelope: ErrorEnvelope = {
      error: {
        code: mapped.code,
        message: mapped.message,
        request_id: requestId,
        ...(mapped.details === undefined ? {} : { details: mapped.details }),
      },
    };

    if (mapped.status >= 500) {
      this.logger.error({ ...context, err: serialize(exception), status: mapped.status }, "request_error");
    } else {
      this.logger.warn({ ...context, code: mapped.code, status: mapped.status }, "request_rejected");
    }

    httpAdapter.reply(ctx.getResponse(), envelope, mapped.status);
  }

  private mapException(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const { message, details } = extractHttpDetails(response, exception.message);
      return { status, code: statusToCode(status), message, details };
    }

    const prisma = mapPrismaError(exception);
    if (prisma) {
      return prisma;
    }

    // Unknown error: never leak internals.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "internal_error",
      message: "Internal server error.",
    };
  }
}

function extractHttpDetails(
  response: string | object,
  fallback: string,
): { message: string; details?: unknown } {
  if (typeof response === "string") {
    return { message: response };
  }
  const record = response as Record<string, unknown>;
  const message =
    typeof record.message === "string"
      ? record.message
      : Array.isArray(record.message)
        ? "Validation failed."
        : fallback;
  // Surface structured validation info (issues / array messages) as details.
  const details = record.issues ?? (Array.isArray(record.message) ? record.message : undefined);
  return { message, details };
}

/** Duck-typed Prisma known-request-error mapping (no Prisma import coupling). */
function mapPrismaError(
  exception: unknown,
): { status: number; code: string; message: string } | null {
  if (
    typeof exception !== "object" ||
    exception === null ||
    !("code" in exception) ||
    !("clientVersion" in exception)
  ) {
    return null;
  }
  const code = (exception as { code?: unknown }).code;
  switch (code) {
    case "P2002":
      return { status: HttpStatus.CONFLICT, code: "conflict", message: "Resource already exists." };
    case "P2025":
      return { status: HttpStatus.NOT_FOUND, code: "not_found", message: "Resource not found." };
    case "P2003":
      return { status: HttpStatus.CONFLICT, code: "constraint_violation", message: "Related resource constraint failed." };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: "database_error",
        message: "Internal server error.",
      };
  }
}

function statusToCode(status: number): string {
  const map: Record<number, string> = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    422: "unprocessable_entity",
    429: "rate_limited",
  };
  return map[status] ?? (status >= 500 ? "internal_error" : "error");
}

function serialize(error: unknown): Record<string, unknown> | string {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}
