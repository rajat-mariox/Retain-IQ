# Database (identity-db)

identity-service owns `identity-db` — the largest schema in the platform:
**90 models** and **50+ enums** in
`packages/database/prisma/identity/schema.prisma`, generated to
`@retainiq/database/identity`. It is a PostgreSQL database accessed through a
single writable Prisma client, plus three **read-only** clients bound to sibling
services' databases.

## Datasource & generation

```prisma
generator client { provider = "prisma-client-js"  output = "../generated/identity" }
datasource  db   { provider = "postgresql"        url = env("DATABASE_URL") }
```

`PrismaService` (`src/common/database/prisma.service.ts`) extends the generated
`PrismaClient` and connects/disconnects on Nest lifecycle hooks. It is provided
globally by `DatabaseModule` (`@Global`) so exactly one connection pool per
database per process is opened.

## Model groups

Every tenant row carries `orgId`; ids are UUIDs. Grouped by domain:

| Group | Models |
|---|---|
| **Tenant & identity** | `Organization`, `User`, `Session`, `OrganizationMembership`, `Role`, `RoleAssignment` |
| **Employee & lifecycle** | `Employee`, `EmployeeDocument`, `EmploymentEvent`, `EmployeeChangeRequest`, `ChangeApprovalStep`, `EmployeeCareerHistory`, `EmployeeExit`, `OffboardingTask`, `EmployeeAlumni`, `WorkforceSetting`, `ProbationRecord`, `ProbationExtension`, `EmployeeRemark`, `Achievement` |
| **Skills** | `SkillCatalog`, `EmployeeSkill`, `EmployeeCertification`, `Designation` |
| **Org structure** | `Department`, `Team`, `Shift`, `ShiftRotation`, `Holiday` |
| **Attendance** | `AttendanceRecord`, `AttendanceSession`, `AttendanceBreak`, `AttendanceEvent`, `AttendanceCorrection`, `AttendancePolicy` |
| **Leave** | `LeaveType`, `LeaveRequest`, `LeaveAttachment`, `CompOffLedger` |
| **Time & payroll** | `TimeEntry`, `Timesheet`, `EmployeeRate`, `BillRate`, `PayrollSetting`, `PayrollCycle`, `PayrollLine`, `ClientInvoice`, `ClientInvoiceLine` |
| **Delivery** | `Client`, `Project`, `Task`, `TaskComment`, `Milestone`, `Goal`, `ProjectSetting` |
| **Performance** | `ReviewCycle`, `PerformanceReview`, `ReviewRating` |
| **Recruitment** | `Requisition`, `Candidate`, `Application`, `Interview`, `Offer` |
| **Onboarding** | `OnboardingTemplate`, `OnboardingTemplateItem`, `OnboardingJourney`, `OnboardingTask` |
| **Care chain** | `Observation`, `ObservationEvent`, `ObservationComment`, `ObservationEvidence`, `Escalation`, `EscalationEvent`, `Incident`, `IncidentEvent`, `IncidentComment`, `IncidentEvidence` |
| **Monitoring & storage** | `MonitoringPolicy`, `ProductivitySetting`, `ScreenshotObject` |
| **Platform & ops** | `PlatformAdmin`, `PlatformAdminSession`, `PlatformEvent`, `PlatformSetting`, `OrgFeatureFlag`, `ReportSchedule`, `ReportJob`, `AuditEvent`, `IdempotencyRecord`, `OutboxEvent` |

Representative enums: `OrgStatus`, `UserStatus`, `MembershipStatus`,
`EmployeeStatus`, `LifecycleStage`, `ScopeType` (ORG/DEPARTMENT/TEAM),
`LeaveStatus`, `TimesheetStatus`, `AttendanceState`, `AttendanceStatus`,
`AttendanceCorrectionStatus`, `ChangeRequestStatus`, `ChangeStepStatus`,
`ProbationStatus`, `ExitStatus`, `PayrollCycleStatus`, `ClientInvoiceStatus`,
`Severity`, `ObservationStatus`, `EscalationStatus`, `IncidentStatus`,
`SessionStatus`, `OutboxStatus`, `IdempotencyStatus`, `PlatformRole`,
`RemarkVisibility`, `SkillProficiency`, `ReportJobStatus`.

## Cross-service read-only clients

`DatabaseModule` also provides three read-only Prisma clients to sibling
databases — identity acts as the BFF/API layer and only *reads* them:

| Client | Database | Env | Used for |
|---|---|---|---|
| `BillingReadPrismaService` | billing-db | `BILLING_DATABASE_URL` | plans/subscriptions/invoices — tenant billing screen, super-admin revenue, storage quotas |
| `AnalyticsReadPrismaService` | analytics | (analytics URL) | `EmployeeDayFact`, `appUsageDaily`, `websiteUsageDaily` — insights/monitoring |
| `NotificationsReadPrismaService` | notifications-db | (notifications URL) | notification projection reads (org feed) |

The contract is explicit in `billing-prisma.service.ts`:

> Database-per-service: billing-service owns and writes this database. identity
> acts as the BFF/API layer and only *reads* … Never write to the billing
> database here — subscriptions are provisioned by billing-service via the
> `organization.created` event.

No cross-database foreign keys exist; `orgId`/`employeeId` are plain UUIDs shared
by value across services.

## Migration workflow

Migrations live in `packages/database/prisma/identity/migrations/` (63+ ordered
folders, e.g. `20260806260000_audit_append_only`). Scripts in
`packages/database/package.json`:

```jsonc
"db:generate":        "prisma generate --schema prisma/identity/schema.prisma && …",
"db:migrate:identity":"prisma migrate deploy --schema prisma/identity/schema.prisma",
"db:diff:identity":   "prisma migrate diff --from-empty --to-schema-datamodel prisma/identity/schema.prisma --script"
```

- **Generate** — `db:generate` regenerates every client (identity + 5 siblings)
  into `prisma/generated/*`.
- **Apply** — `db:migrate:identity` runs `prisma migrate deploy` (forward-only,
  applies pending migrations) against `DATABASE_URL`.
- **Diff** — `db:diff:identity` emits a SQL script from an empty DB to the current
  datamodel (schema inspection / drift check).

Each service migrates its own schema independently — there is one `db:migrate:*`
per database (identity/inbox/analytics/notifications/billing/payroll), reflecting
the database-per-service topology.
