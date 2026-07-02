import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DatabaseModule } from "./common/database/database.module.js";
import { IdempotencyModule } from "./common/idempotency/idempotency.module.js";
import { MessagingModule } from "./common/messaging/messaging.module.js";
import { SeatLimitModule } from "./common/seat-limit/seat-limit.module.js";
import { SettingsModule } from "./common/settings/settings.module.js";
import { AccessScopeModule } from "./common/access-scope/access-scope.module.js";
import { ObservabilityModule } from "./common/observability/observability.module.js";
import { SecurityModule } from "./common/security/security.module.js";
import { RequestContextMiddleware } from "./common/middleware/request-context.middleware.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { PlatformAdminModule } from "./modules/platform-admin/platform-admin.module.js";
import { TenantModule } from "./modules/tenant/tenant.module.js";
import { EmployeeModule } from "./modules/employee/employee.module.js";
import { AttendanceModule } from "./modules/attendance/attendance.module.js";
import { BillingModule } from "./modules/billing/billing.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { InsightsModule } from "./modules/insights/insights.module.js";
import { MembersModule } from "./modules/members/members.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { StorageModule } from "./modules/storage/storage.module.js";
import { OrgStructureModule } from "./modules/org-structure/org-structure.module.js";
import { LeaveModule } from "./modules/leave/leave.module.js";
import { HolidaysModule } from "./modules/holidays/holidays.module.js";
import { MonitoringModule } from "./modules/monitoring/monitoring.module.js";
import { RbacModule } from "./modules/rbac/rbac.module.js";
import { SeatSyncModule } from "./modules/seat-sync/seat-sync.module.js";
import { OutboxModule } from "./modules/outbox/outbox.module.js";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ObservabilityModule,
    DatabaseModule,
    IdempotencyModule,
    MessagingModule,
    SeatLimitModule,
    SettingsModule,
    AccessScopeModule,
    SecurityModule,
    HealthModule,
    IdentityModule,
    PlatformAdminModule,
    TenantModule,
    EmployeeModule,
    AttendanceModule,
    BillingModule,
    ProjectsModule,
    InsightsModule,
    MembersModule,
    NotificationsModule,
    StorageModule,
    OrgStructureModule,
    LeaveModule,
    HolidaysModule,
    MonitoringModule,
    RbacModule,
    SeatSyncModule,
    OutboxModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}

