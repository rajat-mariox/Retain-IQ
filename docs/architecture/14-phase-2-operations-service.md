# Phase 2 — Carve out `operations-service`

> **Status: planned.** Builds on [Phase 1](./13-phase-1-database-per-service.md). Authorization
> and the registration choreography are detailed separately in
> [Phase 3](./15-phase-3-operations-auth-and-choreography.md); this doc covers the structural split.

## Goal

Split the workforce/HR domain (employees, attendance) out of `identity-service` into its own
microservice, `operations-service`, with its **own database** — completing the domain-based,
database-per-service decomposition.

| | Before (Phase 1) | After (Phase 2) |
|---|---|---|
| `identity-service` | auth, org/RBAC, tenant, billing **+ employee/attendance** | auth, org/RBAC, tenant, billing |
| `operations-service` | — | employee, attendance → `retainiq-operations` DB |

## Why this is non-trivial

`identity-service` currently owns `Employee` in the identity DB and creates the founding employee
**inside the org-registration transaction**. Three things must change:

1. **Data move** — `Employee` (and future attendance tables) move to a new `retainiq-operations` DB.
2. **Shared plumbing** — both services need the same NestJS cross-cutting code (request context,
   guards, pipes, outbox, idempotency, audit, messaging, observability).
3. **Bootstrap decoupling** — registration can no longer create the employee in one transaction
   (cross-DB). It becomes event-driven (see Phase 3).

## 1. New database: `retainiq-operations`

New Prisma schema `packages/database/prisma/operations/schema.prisma` → client
`@retainiq/database/operations`. Owns:

- `Employee` (moved out of the identity schema)
- `Attendance` (new; check-in/out, shifts — currently only a stub module)
- `OutboxEvent` — operations emits its own domain events (`employee.created`, …)
- `IdempotencyRecord` — operations has its own idempotent-write store
- `AuditEvent` — operations writes its own audit trail (or emits `audit.event.created`)

`Employee` is **removed** from `packages/database/prisma/identity/schema.prisma`. The
`OrganizationMembership.employeeId` link becomes a logical reference (no cross-DB FK); it is
backfilled via events in Phase 3, or dropped if unused.

Add per-service infra to match Phase 1:
- `docker-compose.yml` / `docker-compose.infra.yml`: `postgres-operations` (port `5436`).
- `infra/k8s/`: `operations-service.yaml` (Deployment/Service/HPA/PDB), `OPERATIONS_DATABASE_URL`
  in the `retainiq-db` secret, a `db-migrate-operations` Job, a ServiceMonitor, a Prometheus target.

## 2. Shared NestJS plumbing → `@retainiq/nest-core`

Extract the framework plumbing currently in `apps/identity-service/src/common/*` into a shared
package so both HTTP services reuse it instead of duplicating:

```
packages/nest-core/src/
  context/        request-context store + middleware
  guards/         auth.guard, tenant.guard, permission.guard
  pipes/          zod-validation.pipe
  decorators/     permissions.decorator
  crypto/         password / refresh-token utils
  messaging/      broker.service + module
  observability/  metrics controller + module
  idempotency/    idempotency.service (+ module)   — generic over the tx client
  outbox/         outbox.service                   — generic over the tx client
  audit/          audit.service                    — generic over the tx client
```

DB-coupled pieces (`OutboxService`, `IdempotencyService`, `AuditService`) are parameterised over a
structural Prisma transaction-client type so each service can bind them to its own client
(`identity`, `operations`, …). The `PrismaService` itself stays per-service (it extends a specific
generated client).

> `PermissionBundleService`/`PermissionGuard` is the exception — it reads identity data, so
> operations-service uses a different resolver. That is the subject of Phase 3.

## 3. `operations-service` application

New `apps/operations-service/` (NestJS, its own `Dockerfile` + image `retainiq/operations-service`):

```
src/
  main.ts, app.module.ts
  common/
    prisma.service.ts        -> @retainiq/database/operations
    (imports guards/context/pipes/outbox/idempotency/audit from @retainiq/nest-core)
  modules/
    employee/                moved from identity-service (controller/service/repository)
    attendance/              implemented against the operations DB
    health/
    outbox/                  outbox relay for the operations DB
```

Employee endpoints move verbatim (`GET/POST /v1/employees`, `GET /v1/employees/:id`); only the
Prisma client binding and the outbox/idempotency wiring change to the operations DB.

## 4. Event & topology changes

- `employee.created` is now emitted by **operations-service** (from its own outbox), not identity.
- `activity-ingestion` and `analytics-service` are unaffected (they key on `employeeId` from the
  stream, not on the identity DB).
- HTTP routing: an API gateway / BFF routes `/v1/employees*` and `/v1/attendance*` to
  operations-service and everything else to identity-service.

## Deliverables checklist

- [ ] `operations` Prisma schema + migration + generated client
- [ ] `Employee` removed from identity schema (+ migration)
- [ ] `@retainiq/nest-core` package with shared plumbing
- [ ] `apps/operations-service` (employee + attendance + outbox relay + Dockerfile)
- [ ] `postgres-operations` in both compose files; k8s manifest, secret key, migrate job, monitoring
- [ ] Build/lint/typecheck/test green
- [ ] Phase 3 (auth + registration choreography) applied
