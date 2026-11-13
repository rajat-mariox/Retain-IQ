# RetainIQ Implementation Structure

This document converts the high-level architecture into a buildable engineering structure.

## 1. Recommended Monorepo Layout

Use a monorepo so shared contracts, event schemas, auth types, and UI packages stay consistent.

```text
retainiq/
  apps/
    web/                         # Next.js customer app
    admin/                       # Optional internal super-admin app, can start inside web
    api/                         # NestJS modular backend
    ingestion-api/               # NestJS/Fastify high-volume agent ingestion
    analytics-api/               # Read API for ClickHouse dashboards
    ai-api/                      # Python FastAPI model/scoring service
    workers/                     # NestJS workers for reports, notifications, integrations
  packages/
    contracts/                   # API DTOs, Zod schemas, event contracts
    authz/                       # permissions, roles, policy helpers
    database/                    # Prisma schema, migrations, seed scripts
    clickhouse/                  # ClickHouse schemas and migrations
    observability/               # logger, tracing, metrics helpers
    config/                      # typed env config
    ui/                          # shared UI components if needed
  infra/
    docker/
    k8s/
    terraform/
  docs/
    architecture/
    featureDocs/
```

Early MVP can run `apps/identity-service` and `apps/workers` from the same codebase. `ingestion-api`, `analytics-api`, and `ai-api` should be physically separated once traffic grows.

## 2. Backend Module Structure

Inside `apps/identity-service`:

```text
src/
  main.ts
  app.module.ts
  common/
    decorators/
    filters/
    guards/
    interceptors/
    pipes/
    tenant/
    pagination/
    idempotency/
    rate-limit/
    audit/
  modules/
    identity/
    tenant/
    employee/
    attendance/
    time-tracking/
    activity/
    productivity/
    ai-intelligence/
    projects/
    payroll/
    integrations/
    notifications/
    billing/
    reports/
    audit/
    files/
```

Each module should follow this pattern:

```text
module-name/
  module-name.module.ts
  controllers/
  services/
  repositories/
  dto/
  policies/
  events/
  jobs/
  tests/
```

Rules:

- Controllers handle HTTP only.
- Services own business workflows.
- Repositories own database access.
- Policies own authorization rules.
- Events define what the module publishes.
- Jobs define async work triggered by the module.

## 3. Service Split Plan

Start modular, split only when there is a clear reason.

| Phase | Deployment | Why |
| --- | --- | --- |
| MVP | `web`, `api`, `workers`, PostgreSQL, Redis, S3 | Lowest operational cost |
| Scale 1 | Add `ingestion-api`, ClickHouse | Activity data volume requires separate write path |
| Scale 2 | Add Kafka and dedicated consumers | Durable event processing and replay |
| Scale 3 | Add `analytics-api`, `ai-api` | Dashboard and AI workloads need independent scaling |
| Enterprise | Split auth, billing, notification, integration workers | Compliance and workload isolation |

Avoid splitting simple CRUD modules such as projects or settings into separate services too early.

## 4. Request Lifecycle

Every authenticated request should pass through the same lifecycle:

```text
Request
  -> request id middleware
  -> structured logger context
  -> auth guard
  -> tenant resolver
  -> permission guard
  -> rate limit guard
  -> idempotency guard for writes
  -> validation pipe
  -> controller
  -> service
  -> repository with tenant scope
  -> audit/event publisher
  -> response interceptor
```

The tenant resolver must set a trusted context:

```ts
type RequestContext = {
  requestId: string;
  traceId: string;
  userId: string;
  orgId: string;
  membershipId: string;
  role: string;
  permissionsVersion: number;
  ipAddress: string;
  userAgent: string;
};
```

The backend should never trust `orgId` from request body, query, or route params unless the caller is a verified platform super-admin.

## 5. API Style

Use REST for the main product API. It is easier to secure, cache, rate-limit, and document.

Recommended route style:

```text
/v1/me
/v1/org
/v1/employees
/v1/employees/:employeeId
/v1/attendance/check-in
/v1/attendance/records
/v1/time/sessions
/v1/productivity/dashboard
/v1/reports
/v1/admin/organizations               # platform super-admin only
```

Do not include `orgId` in normal tenant routes:

```text
Bad:  /v1/orgs/:orgId/employees
Good: /v1/employees
```

For internal service APIs, use explicit tenant context headers signed by service identity:

```text
X-Internal-Service: report-worker
X-Org-Id: uuid
X-Request-Id: uuid
```

## 6. Frontend Structure

Inside `apps/web`:

```text
src/
  app/
    (auth)/
    (dashboard)/
      dashboard/
      employees/
      attendance/
      time-tracking/
      monitoring/
      productivity/
      ai-intelligence/
      projects/
      payroll/
      reports/
      notifications/
      settings/
  components/
  features/
  lib/
    api/
    auth/
    permissions/
    query/
```

Frontend rules:

- Use server components for shell/navigation and low-change data.
- Use client components for dashboards, filters, live state, and forms.
- Use TanStack Query or equivalent for client data caching.
- Always paginate large tables.
- Never render 100,000 employee rows in the browser.
- Use virtualized tables for large lists.

## 7. Worker Structure

Workers should be small, idempotent, and restart-safe.

```text
workers/
  report-worker/
  notification-worker/
  integration-worker/
  audit-worker/
  clickhouse-writer/
  productivity-aggregator/
  attendance-correlator/
  ai-feature-worker/
```

Worker rules:

- Every job has `job_id`, `org_id`, `attempt`, `idempotency_key`.
- Jobs can be retried without duplicating state.
- Long jobs checkpoint progress.
- Workers emit metrics for duration, failures, retries, and queue lag.
- Workers must not make unbounded queries.

## 8. Shared Contracts

Create event and API contracts in `packages/contracts`.

Recommended structure:

```text
packages/contracts/
  src/
    api/
      employee.dto.ts
      attendance.dto.ts
      productivity.dto.ts
    events/
      base-event.ts
      activity-events.ts
      attendance-events.ts
      billing-events.ts
    schemas/
      pagination.ts
      idempotency.ts
```

Use Zod or TypeBox for runtime validation on boundaries. TypeScript types alone are not enough for ingestion APIs, webhooks, or Kafka consumers.

## 9. Environment Separation

Use separate environments:

```text
local
dev
staging
production
```

Each environment needs separate:

- databases
- Redis
- object storage bucket/prefix
- Kafka topics
- OAuth app credentials
- signing keys
- webhook secrets

Never reuse production secrets in lower environments.

## 10. Engineering Defaults

Default decisions:

- TypeScript strict mode enabled.
- ESLint and Prettier required in CI.
- DTO validation for every API boundary.
- Cursor pagination by default.
- OpenTelemetry instrumentation from day one.
- Structured JSON logs.
- Feature flags for large feature rollouts.
- All important writes emit an audit event.
- Every tenant-scoped query must include trusted `org_id`.

