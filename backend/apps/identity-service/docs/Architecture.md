# identity-service — Architecture

The large, core bounded context of the RetainIQ Workforce SaaS. It owns the
tenant model (organizations, users, memberships, roles), the entire HR domain
(employees, attendance, leave, timesheets, payroll, performance, recruitment,
onboarding), the workforce-care chain (observations → escalations → incidents),
and cross-cutting platform concerns (RBAC/ABAC, sessions, realtime, storage,
platform-admin). It is the source of truth for `identity-db` and the origin of
the `employee.*`, `leave.*`, `timesheet.*`, `attendance.*` domain events that
downstream services (billing-service, payroll-service) project.

## Tech stack

| Concern | Choice | Where |
|---|---|---|
| Framework | NestJS on **Fastify** (`FastifyAdapter`) | `src/main.ts` |
| DB / ORM | PostgreSQL (`identity-db`) via Prisma | `@retainiq/database/identity`, `src/common/database/prisma.service.ts` |
| Global prefix | `/v1` | `app.setGlobalPrefix("v1")` (`main.ts:30`) |
| Validation | per-route Zod pipes against `@retainiq/contracts` | `src/common/pipes/zod-validation.pipe.ts` |
| AuthN | Bearer access JWT (`@nestjs/jwt`) | `src/common/guards/auth.guard.ts` |
| AuthZ | `@retainiq/authz` permission bundles + ABAC scope | `src/common/security/*`, `src/common/access-scope/*` |
| Messaging | transactional outbox → Kafka / Redis Streams | `src/common/outbox`, `src/modules/outbox` |
| Realtime | SSE + Redis pub/sub bus | `src/common/realtime/*` |
| Logging | pino with per-request correlation | `NestPinoLogger` + `getRequestContext` (`main.ts:22`) |
| Scheduling | `@nestjs/schedule` (`@Cron`, `@Interval`) | crons across attendance/escalation/storage |
| Object storage | S3 / MinIO dual-client | `src/modules/storage/storage.service.ts` |

`main.ts` boots a Fastify Nest app with buffered logs routed through pino,
enables shutdown hooks and CORS with credentials, sets the `/v1` prefix, and
listens on `config.PORT`. Request validation is deliberately **not** a global
class-validator pipe — each route validates its own body/query with a
`ZodValidationPipe` bound to the matching schema in `@retainiq/contracts`.

## Module map

31 feature modules under `src/modules`, wired in `src/app.module.ts`, plus
cross-cutting infrastructure under `src/common`.

### Common infrastructure (`src/common`)

| Dir | Purpose |
|---|---|
| `context` | `AsyncLocalStorage` request context (`requireTenantContext`) |
| `middleware` | `RequestContextMiddleware` — stamps `requestId`/`traceId`, seeds context |
| `guards` | `AuthGuard`, `TenantGuard`, `PermissionGuard` |
| `security` | JWT module, `PermissionBundleService`, `PermissionCache`, `OrgStatusService`, `field-mask` |
| `access-scope` | `AccessScopeService` — the ABAC engine (org/scoped/self tiers) |
| `approval` | `ApprovalService` — who may approve whose leave/timesheet |
| `org-roles` | `OrgRolesService` — Owner-vs-staff helper |
| `entitlement` / `settings` | plan entitlements, feature flags, maintenance mode |
| `outbox` | `OutboxService.enqueue(tx, …)` — transactional event write |
| `realtime` | `SseHub`, `NotificationRealtimeService`, `RealtimePublisher` |
| `database` | `PrismaService` (identity-db) + 3 read-only cross-service clients |
| `idempotency` | `IdempotencyService` / records |
| `audit` | `AuditService` — append-only `AuditEvent` |
| `crypto` | password / refresh-token / temp-password utils |
| `productivity` | app/domain classification rules for insights |
| `seat-limit` | seat enforcement against the plan |
| `observability` | pino logger + Prometheus metrics |

### Feature modules (`src/modules`)

| Cluster | Modules |
|---|---|
| Tenant & identity | `identity` (auth), `tenant`, `members`, `rbac` |
| People | `employee` (+ 360, skills, certs, career, probation, exit, alumni, remarks, change-requests), `org-structure`, `holidays` |
| Time & pay | `attendance`, `leave`, `timetracking`, `payroll` |
| Delivery | `projects`, `clients` |
| Care chain | `observation`, `escalation`, `incident` |
| Analytics | `insights`, `hr-analytics`, `monitoring`, `performance`, `org-activity` |
| Hiring & joining | `recruitment`, `onboarding` |
| Platform | `platform-admin`, `billing`, `entitlements`, `storage`, `notifications`, `reports`, `seat-sync`, `outbox`, `health` |

## Request lifecycle

```
HTTP → Fastify → RequestContextMiddleware  (requestId/traceId, ip, ua → AsyncLocalStorage)
     → APP_GUARDs                          (FeatureFlagGuard, MaintenanceGuard — see below)
     → route @UseGuards(AuthGuard, TenantGuard, PermissionGuard)
          AuthGuard      verify JWT, denylist check, populate ctx.{userId,orgId,membershipId,role}
          TenantGuard    org+membership+user still ACTIVE (OrgStatusService, 10s cache)
          PermissionGuard load effective permission bundle from DB, check @RequirePermissions
     → ZodValidationPipe (body/query against @retainiq/contracts)
     → controller → service → PrismaService (where:{orgId} everywhere)
                             → OutboxService.enqueue(tx, …) in the same transaction
```

The request context lives in an `AsyncLocalStorage` store (`src/common/context/
request-context.store.ts`). `RequestContextMiddleware` runs for every route and
seeds `requestId`, `traceId`, `ipAddress`, `userAgent`; `AuthGuard` later adds
the authenticated principal. Any service can call `requireTenantContext()` to
get a fully-populated `{ orgId, userId, membershipId, requestId, role, … }` or
throw if it is missing.

## How it fits the platform

- **Emits** domain events via a transactional outbox on `STREAMS.domainEvents`
  (Kafka or Redis Streams). billing-service and payroll-service consume these to
  build their own read-models (see `Events-Outbox.md`).
- **Reads** three sibling databases **read-only** through dedicated Prisma
  clients: `billing-db` (plan/subscription for quotas & entitlements),
  the analytics read model (productivity facts), and `notifications-db`
  (notification projection). No cross-database writes, no cross-DB FKs —
  `orgId`/`employeeId` are plain UUIDs across services.
- **Owns** the RBAC bundle that every service's guards ultimately trust: a
  user's effective permissions live in `identity-db` and are resolved here.

See the companion docs: `RBAC-ABAC.md`, `Auth-Sessions.md`, `Multi-Tenancy.md`,
`Employee-360.md`, `Attendance-Leave.md`, `Workflow-Engine.md`,
`Projects-Timetracking.md`, `Insights-Analytics.md`, `Payroll-Timesheets.md`,
`Platform-Admin.md`, `Events-Outbox.md`, `Storage.md`, `Realtime.md`,
`Database.md`, `API.md`.
