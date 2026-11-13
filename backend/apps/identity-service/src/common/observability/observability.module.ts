import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, HttpAdapterHost } from "@nestjs/core";
import { AllExceptionsFilter, ObservabilityInterceptor } from "@retainiq/platform";
import { getRequestContext } from "../context/request-context.store.js";
import { MetricsController } from "./metrics.controller.js";
import { logger, metrics } from "./observability.js";

/**
 * Registers the global exception filter (standard error envelope + Prisma
 * mapping) and the HTTP observability interceptor (access logs + RED metrics),
 * and exposes GET /metrics. Both pull request correlation from the
 * AsyncLocalStorage request context.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    {
      provide: APP_FILTER,
      useFactory: (httpAdapterHost: HttpAdapterHost) =>
        new AllExceptionsFilter(httpAdapterHost, logger, getRequestContext),
      inject: [HttpAdapterHost],
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: () => new ObservabilityInterceptor(logger, metrics, getRequestContext),
    },
  ],
})
export class ObservabilityModule {}
