import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DatabaseModule } from "./common/database/database.module.js";
import { IdempotencyModule } from "./common/idempotency/idempotency.module.js";
import { MessagingModule } from "./common/messaging/messaging.module.js";
import { SeatLimitModule } from "./common/seat-limit/seat-limit.module.js";
import { ApprovalModule } from "./common/approval/approval.module.js";
import { OrgRolesModule } from "./common/org-roles/org-roles.module.js";
import { SettingsModule } from "./common/settings/settings.module.js";
import { EntitlementModule } from "./common/entitlement/entitlement.module.js";
import { AccessScopeModule } from "./common/access-scope/access-scope.module.js";
import { ObservabilityModule } from "./common/observability/observability.module.js";
import { SecurityModule } from "./common/security/security.module.js";
import { ProductivityModule } from "./common/productivity/productivity.module.js";
import { RequestContextMiddleware } from "./common/middleware/request-context.middleware.js";
import { HealthModule } from "./modules/health/health.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { PlatformAdminModule } from "./modules/platform-admin/platform-admin.module.js";
import { TenantModule } from "./modules/tenant/tenant.module.js";
import { EmployeeModule } from "./modules/employee/employee.module.js";
import { AttendanceModule } from "./modules/attendance/attendance.module.js";
import { BillingModule } from "./modules/billing/billing.module.js";
import { EntitlementsModule } from "./modules/entitlements/entitlements.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { InsightsModule } from "./modules/insights/insights.module.js";
import { MembersModule } from "./modules/members/members.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { StorageModule } from "./modules/storage/storage.module.js";
import { OrgStructureModule } from "./modules/org-structure/org-structure.module.js";
import { ClientsModule } from "./modules/clients/clients.module.js";
import { LeaveModule } from "./modules/leave/leave.module.js";
import { PayrollWorkspaceModule } from "./modules/payroll-workspace/payroll-workspace.module.js";
import { HolidaysModule } from "./modules/holidays/holidays.module.js";
import { OrgActivityModule } from "./modules/org-activity/org-activity.module.js";
import { MonitoringModule } from "./modules/monitoring/monitoring.module.js";
import { TimeTrackingModule } from "./modules/timetracking/timetracking.module.js";
import { RbacModule } from "./modules/rbac/rbac.module.js";
import { RecruitmentModule } from "./modules/recruitment/recruitment.module.js";
import { OnboardingModule } from "./modules/onboarding/onboarding.module.js";
import { PerformanceModule } from "./modules/performance/performance.module.js";
import { HrAnalyticsModule } from "./modules/hr-analytics/hr-analytics.module.js";
import { ObservationModule } from "./modules/observation/observation.module.js";
import { EscalationModule } from "./modules/escalation/escalation.module.js";
import { IncidentModule } from "./modules/incident/incident.module.js";
import { ReportsModule } from "./modules/reports/reports.module.js";
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
    EntitlementModule,
    ApprovalModule,
    OrgRolesModule,
    AccessScopeModule,
    SecurityModule,
    ProductivityModule,
    HealthModule,
    IdentityModule,
    PlatformAdminModule,
    TenantModule,
    EmployeeModule,
    AttendanceModule,
    BillingModule,
    EntitlementsModule,
    ProjectsModule,
    InsightsModule,
    MembersModule,
    NotificationsModule,
    StorageModule,
    OrgStructureModule,
    ClientsModule,
    LeaveModule,
    PayrollWorkspaceModule, // §2 Payroll & Payout Workspace (replaces legacy payout)
    HolidaysModule,
    OrgActivityModule,
    MonitoringModule,
    TimeTrackingModule,
    RbacModule,
    RecruitmentModule,
    OnboardingModule,
    PerformanceModule,
    HrAnalyticsModule,
    ObservationModule,
    EscalationModule,
    IncidentModule,
    ReportsModule,
    SeatSyncModule,
    OutboxModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}

