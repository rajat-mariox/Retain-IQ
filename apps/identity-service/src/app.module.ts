import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DatabaseModule } from "./common/database/database.module.js";
import { IdempotencyModule } from "./common/idempotency/idempotency.module.js";
import { MessagingModule } from "./common/messaging/messaging.module.js";
import { ObservabilityModule } from "./common/observability/observability.module.js";
import { SecurityModule } from "./common/security/security.module.js";
import { RequestContextMiddleware } from "./common/middleware/request-context.middleware.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { TenantModule } from "./modules/tenant/tenant.module.js";
import { EmployeeModule } from "./modules/employee/employee.module.js";
import { AttendanceModule } from "./modules/attendance/attendance.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { OutboxModule } from "./modules/outbox/outbox.module.js";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ObservabilityModule,
    DatabaseModule,
    IdempotencyModule,
    MessagingModule,
    SecurityModule,
    HealthModule,
    IdentityModule,
    TenantModule,
    EmployeeModule,
    AttendanceModule,
    NotificationsModule,
    OutboxModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}

