# PostgreSQL and Prisma Tenancy Design

PostgreSQL is the transactional source of truth. Prisma is acceptable for most operational workflows, but tenancy rules must be enforced carefully.

## 1. Core Principles

1. Every tenant-owned row has `org_id`.
2. Backend derives `org_id` from authenticated context.
3. Repositories must require tenant context.
4. Large tables need composite indexes starting with `org_id`.
5. Dashboards should read precomputed aggregates, not transactional tables.
6. Prisma should not be used for high-volume analytics scans.

## 2. Base Tables

Core SaaS tables:

```text
organizations
organization_memberships
users
employees
departments
teams
roles
permissions
role_permissions
feature_flags
plans
subscriptions
usage_meters
audit_events
```

User and employee should be separate concepts:

- `user`: login identity.
- `employee`: workforce profile inside an organization.

This supports contractors, invited admins, external accountants, and employees without login access.

## 3. Suggested Prisma Models

Representative schema, not final exhaustive schema:

```prisma
model Organization {
  id          String   @id @default(uuid()) @db.Uuid
  name        String
  slug        String   @unique
  status      OrgStatus @default(ACTIVE)
  region      String   @default("ap-south-1")
  planId      String?  @db.Uuid
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  memberships OrganizationMembership[]
  employees   Employee[]
}

model User {
  id             String   @id @default(uuid()) @db.Uuid
  email          String   @unique
  passwordHash   String?
  status         UserStatus @default(ACTIVE)
  mfaEnabled     Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  memberships    OrganizationMembership[]
}

model OrganizationMembership {
  id          String   @id @default(uuid()) @db.Uuid
  orgId       String   @db.Uuid
  userId      String   @db.Uuid
  employeeId  String?  @db.Uuid
  roleId      String   @db.Uuid
  status      MembershipStatus @default(ACTIVE)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  org         Organization @relation(fields: [orgId], references: [id])
  user        User @relation(fields: [userId], references: [id])
  employee    Employee? @relation(fields: [employeeId], references: [id])

  @@unique([orgId, userId])
  @@index([userId, status])
  @@index([orgId, status])
}

model Employee {
  id             String   @id @default(uuid()) @db.Uuid
  orgId          String   @db.Uuid
  employeeCode   String?
  email          String?
  firstName      String
  lastName       String
  departmentId   String?  @db.Uuid
  managerId      String?  @db.Uuid
  status         EmployeeStatus @default(ACTIVE)
  joinedAt       DateTime?
  exitedAt       DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  createdBy      String?  @db.Uuid
  updatedBy      String?  @db.Uuid

  org            Organization @relation(fields: [orgId], references: [id])
  memberships    OrganizationMembership[]

  @@unique([orgId, employeeCode])
  @@index([orgId, email])
  @@index([orgId, departmentId, status])
  @@index([orgId, managerId, status])
}
```

## 4. Tenant-Scoped Repository Pattern

Do not let application services call Prisma directly. Use repositories that require `RequestContext`.

```ts
export class EmployeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(ctx: RequestContext, employeeId: string) {
    return this.prisma.employee.findFirst({
      where: {
        id: employeeId,
        orgId: ctx.orgId,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
      },
    });
  }
}
```

Do not expose generic repository methods such as:

```ts
findMany(where: Prisma.EmployeeWhereInput)
```

That pattern eventually leaks tenant data.

## 5. Prisma Middleware Guard

Add a defensive middleware that rejects tenant-owned model reads without `orgId`, but do not rely on middleware alone.

Tenant-owned models:

```text
Employee
Department
Team
AttendanceRecord
LeaveRequest
WorkSession
Timesheet
Project
Task
Notification
IntegrationConnection
```

For batch jobs, require an explicit system context:

```ts
type SystemTenantContext = {
  orgId: string;
  actor: "system";
  jobId: string;
};
```

## 6. Row Level Security

For high-risk tables, enable PostgreSQL Row Level Security:

```sql
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_employees
ON employees
USING (org_id = current_setting('app.current_org_id')::uuid);
```

Before queries in a transaction:

```sql
SET LOCAL app.current_org_id = '...';
```

RLS gives a second line of defense, but it needs careful connection pooling configuration. With PgBouncer transaction pooling, use `SET LOCAL` inside transactions only.

## 7. Index Strategy

Common indexes:

```sql
CREATE INDEX idx_employee_org_status
ON employees (org_id, status);

CREATE INDEX idx_attendance_org_employee_date
ON attendance_records (org_id, employee_id, work_date DESC);

CREATE INDEX idx_leave_org_status_created
ON leave_requests (org_id, status, created_at DESC);

CREATE INDEX idx_timesheet_org_status_period
ON timesheets (org_id, status, period_start DESC, period_end DESC);

CREATE INDEX idx_audit_org_time
ON audit_events (org_id, occurred_at DESC);
```

Avoid indexes that do not start with `org_id` on tenant-owned high-volume tables unless there is a proven global admin query.

## 8. Partitioning

Partition large append-heavy PostgreSQL tables:

- `audit_events`
- `notifications`
- `timesheets` at high scale
- `report_runs`
- `idempotency_records`

Example:

```sql
CREATE TABLE audit_events (
  id uuid not null,
  org_id uuid not null,
  action text not null,
  occurred_at timestamptz not null,
  payload jsonb not null,
  primary key (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
```

Create monthly partitions automatically through migrations or scheduled maintenance jobs.

## 9. Idempotency Table

Critical financial and approval operations need durable idempotency:

```prisma
model IdempotencyRecord {
  id              String   @id @default(uuid()) @db.Uuid
  orgId           String   @db.Uuid
  key             String
  requestHash     String
  status          IdempotencyStatus
  responseCode    Int?
  responseBody    Json?
  lockedUntil     DateTime?
  createdAt       DateTime @default(now())
  expiresAt       DateTime

  @@unique([orgId, key])
  @@index([orgId, expiresAt])
}
```

Use Redis for fast-path dedupe and PostgreSQL for workflows where duplicate execution is unacceptable.

## 10. Transaction Guidelines

Use transactions for:

- approval workflows
- payroll calculations
- subscription changes
- role/permission changes
- critical audit writes

Do not put slow external calls inside DB transactions:

- email sending
- Stripe API calls
- S3 uploads
- Slack/Teams calls
- AI model calls

Use the outbox pattern:

```text
DB transaction writes business row + outbox row
Outbox worker publishes Kafka event
Consumer performs external side effect
```

## 11. Outbox Table

```prisma
model OutboxEvent {
  id            String   @id @default(uuid()) @db.Uuid
  orgId         String?  @db.Uuid
  topic         String
  eventType     String
  aggregateType String
  aggregateId   String
  payload       Json
  status        OutboxStatus @default(PENDING)
  attempts      Int @default(0)
  nextRunAt     DateTime @default(now())
  createdAt     DateTime @default(now())
  publishedAt   DateTime?

  @@index([status, nextRunAt])
  @@index([orgId, createdAt])
}
```

This prevents data changes without matching events.

## 12. Query Safety Rules

Backend PRs should fail review if they:

- query tenant-owned data without `orgId`
- use offset pagination on large tables
- load relations without explicit `select`
- use unbounded `findMany`
- compute dashboards by looping rows
- call ClickHouse through Prisma
- write binary data to PostgreSQL
- store tokens unencrypted

