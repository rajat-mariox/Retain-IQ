import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import type { Logger, Metrics } from "@retainiq/observability";
import { type Observable, tap } from "rxjs";
import { readContext, type ContextProvider } from "../context.js";

type HttpRequestLike = {
  method?: string;
  url?: string;
  routeOptions?: { url?: string };
  routerPath?: string;
};

type HttpResponseLike = { statusCode?: number };

/** Probe/scrape endpoints (with or without a global prefix) are not logged/metered. */
function isSilentRoute(route: string): boolean {
  return (
    route.endsWith("/metrics") ||
    route.endsWith("/health") ||
    route.endsWith("/health/live") ||
    route.endsWith("/health/ready")
  );
}

/**
 * Emits one structured access-log line and records RED metrics per HTTP
 * request. Uses the route template (not the concrete URL) as the metric label
 * to keep cardinality bounded, and skips probe/metrics endpoints.
 */
export class ObservabilityInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly contextProvider?: ContextProvider,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const response = http.getResponse<HttpResponseLike>();

    const method = request.method ?? "UNKNOWN";
    const route = request.routeOptions?.url ?? request.routerPath ?? request.url ?? "unknown";
    const start = process.hrtime.bigint();
    // Record once per request. SSE handlers emit many values from one request;
    // without this guard each event would be logged/metered separately.
    let recorded = false;

    const record = (status: number) => {
      if (recorded || isSilentRoute(route)) {
        return;
      }
      recorded = true;
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const labels = { method, route, status: String(status) };
      this.metrics.httpRequestsTotal.inc(labels);
      this.metrics.httpRequestDuration.observe(labels, seconds);
      this.logger.info(
        { ...readContext(this.contextProvider), method, route, status, durationMs: Math.round(seconds * 1000) },
        "request",
      );
    };

    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode ?? 200),
        error: (err: unknown) => record(resolveErrorStatus(err, response.statusCode)),
      }),
    );
  }
}

function resolveErrorStatus(err: unknown, fallback: number | undefined): number {
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") {
      return status;
    }
  }
  return fallback && fallback >= 400 ? fallback : 500;
}
