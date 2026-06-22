# Phase 1 — Database-Per-Service & Domain Microservices (As-Built)

> **Status: implemented.** This is the authoritative description of the current code:
> five domain-named microservices, each with its own database and its own image.
> Phase 2 ([14](./14-phase-2-operations-service.md)) and Phase 3
> ([15](./15-phase-3-operations-auth-and-choreography.md)) describe the planned next steps.

## Services and their databases

Service names are **domain-based** and each builds into its **own image** (`apps/<svc>/Dockerfile`).

| Service (apps/) | Database | Owns | Client import |
|---|---|---|---|
| `identity-service` | `retainiq-identity` (Postgres) | Organization, User, Session, Membership, Role, Employee, AuditEvent, IdempotencyRecord, OutboxEvent | `@retainiq/database/identity` |
| `activity-ingestion` | — (stateless) | publishes activity to the stream only | — |
| `event-processor` | `retainiq-inbox` (Postgres) | ConsumedEvent (idempotent inbox) | `@retainiq/database/inbox` |
| `analytics-service` | `retainiq-analytics` (Postgres) | ConsumedEvent (own inbox) + EmployeeDayFact | `@retainiq/database/analytics` |
| `notifications-service` | `retainiq-notifications` (Postgres) | Notification + OrgRecipient (read model) | `@retainiq/database/notifications` |

> **Planned next step (not yet implemented):** carve `operations-service` (Employee/attendance,
> own `retainiq-operations` DB) out of `identity-service`. Employee currently still lives in the
> identity database. See [Phase 2](./14-phase-2-operations-service.md).

Each service connects **only** to its own database via `DATABASE_URL`. No service reads
another service's tables. Cross-service data moves over the Redis/Kafka event stream.

## The database package

`packages/database` holds **four independent Prisma schemas**, each generating its own
client to `prisma/generated/<name>` and exposed via subpath exports:

```
prisma/identity/schema.prisma       -> @retainiq/database/identity
prisma/inbox/schema.prisma          -> @retainiq/database/inbox
prisma/analytics/schema.prisma      -> @retainiq/database/analytics
prisma/notifications/schema.prisma  -> @retainiq/database/notifications
```

Each schema has its own `migrations/` directory (Prisma derives it next to the schema).
`npm run db:generate` generates all four clients; per-service migrations run with
`db:migrate:<identity|inbox|analytics|notifications>` against that service's `DATABASE_URL`.

## Cross-service reads — how they are avoided

Two places previously read across domains; both are now resolved without cross-DB access:

1. **Notification recipients.** notifications-service used to query identity's
   `OrganizationMembership`/`Role`. Now the identity service publishes
   **`org.member.upserted`** domain events; notifications-service projects them into a local
   **`OrgRecipient`** read model and resolves recipients from that copy.

2. **In-app inbox feed (BFF).** identity-service serves the inbox over HTTP/SSE, but the rows live
   in the notifications database. identity-service keeps a **read-only** connection to that database
   via `NOTIFICATIONS_DATABASE_URL` (`NotificationsReadPrismaService`). Writes remain owned
   by notifications-service. This is the single, deliberate exception to one-service-one-DB,
   justified by identity-service acting as the API/BFF layer.

## Infrastructure

- **Local (Docker):** `docker-compose.yml` provisions one Postgres per service
  (ports 5432–5435) + Redis and runs all five services. `docker-compose.infra.yml` provisions
  just the databases + Redis for running apps via `npm run dev:*`.
- **Kubernetes:** `infra/k8s/` — one Deployment per service, each from its **own image**
  (`retainiq/<service>`, built from `apps/<service>/Dockerfile`). DB connection strings live in the
  `retainiq-db` Secret; each Deployment maps exactly one key to its `DATABASE_URL` (identity-service
  also gets `NOTIFICATIONS_DATABASE_URL`). Migrations run as four `db-migrate-*` Jobs
  (`infra/k8s/migrate-job.yaml`).

## Data note

The per-service databases are created empty (initial migrations generated from scratch).
If migrating from the previous single shared database, perform a one-time per-table export
into the matching service database before cutover.
