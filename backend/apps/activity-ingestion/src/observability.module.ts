import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, HttpAdapterHost } from "@nestjs/core";
import { AllExceptionsFilter, ObservabilityInterceptor } from "@retainiq/platform";
import { MetricsController } from "./metrics.controller.js";
import { logger, metrics } from "./observability.js";

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    {
      provide: APP_FILTER,
      useFactory: (httpAdapterHost: HttpAdapterHost) =>
        new AllExceptionsFilter(httpAdapterHost, logger),
      inject: [HttpAdapterHost],
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: () => new ObservabilityInterceptor(logger, metrics),
    },
  ],
})
export class ObservabilityModule {}
