# RetainIQ V1

RetainIQ is an AI Workforce Intelligence Platform. The current repository contains product feature notes and scalable SaaS architecture documents.

## Current Implementation

The repo is an npm-workspace monorepo that has taken its first microservices
decomposition step: a transactional core plus an extracted async event path
(see [Microservices Topology](docs/architecture/07-microservices-topology.md)).

Services (`apps/*`):

- **identity-service** (`apps/identity-service`) — NestJS OLTP API: identity, tenancy, RBAC, employees;
  emits domain events via a transactional outbox + relay.
- **activity-ingestion** (`apps/activity-ingestion`) — NestJS high-volume activity
  intake; publishes to the broker, no DB access.
- **event-processor** (`apps/event-processor`) — Node consumer-group worker; projects
  events into the `ConsumedEvent` idempotent inbox.

Shared packages (`packages/*`): `contracts`, `messaging` (pluggable broker),
`authz`, `config`, `observability`, `platform`, `database` (Prisma). PostgreSQL +
Redis + all services run via Docker Compose; GitHub Actions CI builds/typechecks/
lints/tests the whole workspace.

### Event broker (pluggable: Redis Streams or Kafka)

`@retainiq/messaging` exposes a `Broker` interface with two drivers, selected by
`BROKER_DRIVER`. Services depend only on the interface, so switching is config-only:

- **`redis`** — Redis Streams consumer groups; no extra infra. Use `npm run up:redis`.
- **`kafka`** — durable, replayable, partitioned (`org_id:employee_id`), many
  independent consumer groups; the MSK backbone. `npm run up` runs the whole stack on Kafka
  (broker + every service on the Kafka driver) automatically.

  ```bash
  npm run up                 # full stack on Kafka (broker auto-started, services switched)
  # host-run a single service against the broker's external listener:
  BROKER_DRIVER=kafka KAFKA_BROKERS=localhost:29092 npm run dev:identity
  ```

Both drivers give at-least-once delivery with bounded retries and a `<topic>.dlq`
dead-letter topic; consumers are idempotent.

### Real-time notifications (SSE)

The real-time last hop is a separate **Redis Pub/Sub** fan-out (ephemeral; the
durable copy is already in Postgres). The notifications-service publishes to a
per-user channel on IN_APP delivery; identity-service runs one pattern-subscriber per
instance and pushes to the matching live connections via an in-memory hub.

```bash
# Live stream (Server-Sent Events) for the authenticated user:
curl -N -H "authorization: Bearer <accessToken>" http://localhost:3001/v1/notifications/stream
# Inbox history:
curl     -H "authorization: Bearer <accessToken>" http://localhost:3001/v1/notifications
```

Full path: HTTP write → transactional outbox → broker (Kafka/Redis) →
notifications-service (rules + fan-out) → Redis Pub/Sub → identity-service SSE → client.

## Local Setup

Run the whole stack (per-service Postgres, Redis, Kafka, and all five services) with one command —
migrations apply automatically before the services start:

```bash
cp .env.example .env
npm run up           # build + start everything (on Kafka), auto-migrated
npm run logs         # follow logs   ·   npm run down (stop)   ·   npm run down:clean (wipe)
```

Prefer Redis Streams (no Kafka broker): `npm run up:redis`. Full command reference: [QUICKSTART.md](QUICKSTART.md).

Or run the services on the host against just the infra containers:

```bash
npm install
cp .env.example .env
docker compose -f docker-compose.infra.yml up -d   # per-service Postgres + Redis
npm run db:generate
# migrate each service DB (see QUICKSTART.md for the per-service DATABASE_URL values)
npm run db:migrate:identity && npm run db:migrate:inbox && npm run db:migrate:analytics && npm run db:migrate:notifications
npm run dev:identity     # identity-service   on :3001
npm run dev:ingestion    # activity-ingestion on :3002
node apps/event-processor/dist/main.js   # after `npm run build`
```

> Host `npm run dev:*` needs port `5432` free — stop the native PostgreSQL service if it conflicts,
> or remap the Docker DB ports. Container mode (`npm run up`) is unaffected.

identity-service starts on `http://localhost:3001/v1`; activity-ingestion on
`http://localhost:3002/v1`. Each service exposes `/health` (liveness),
`/health/ready` (readiness — checks Postgres/Redis), and `/metrics` (Prometheus);
the worker serves these on `:3003`.

### Observability stack (local)

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml up --build
```

Grafana at `http://localhost:3000` (Prometheus + Loki datasources provisioned),
Prometheus at `http://localhost:9090`.

### Kubernetes / production

Manifests (Deployments with liveness/readiness/startup probes, HPA, PDB, KEDA
autoscaling on stream lag, ServiceMonitors) live in [infra/k8s/](infra/k8s/);
Terraform skeleton in [infra/terraform/](infra/terraform/); deploy pipeline in
[.github/workflows/deploy.yml](.github/workflows/deploy.yml). See
[Production Operations](docs/architecture/08-production-operations.md).

Health check:

```bash
curl http://localhost:3001/v1/health
```

### Authentication (JWT + RBAC)

Auth uses short-lived access JWTs plus rotating, DB-backed refresh sessions.
`register` bootstraps a new organization (Owner role with all permissions, user,
employee, and active membership) and returns the first token pair.

```bash
# 1. Bootstrap an organization and get tokens
curl -X POST http://localhost:3001/v1/auth/register \
  -H "content-type: application/json" \
  -d '{"email":"owner@acme.com","password":"SuperSecret123!","orgName":"Acme","firstName":"Ada","lastName":"Lovelace"}'

# 2. Call a tenant-protected route with the access token
curl http://localhost:3001/v1/employees \
  -H "authorization: Bearer <accessToken>"

# 3. Rotate the refresh token (reuse of a rotated token revokes the session family)
curl -X POST http://localhost:3001/v1/auth/refresh \
  -H "content-type: application/json" \
  -d '{"refreshToken":"<refreshToken>"}'
```

Authorization is enforced by `PermissionGuard`, which loads the membership's
effective permissions from the database (cached) — access-token claims are used
only to identify the principal, never trusted for authorization.

**Platform behaviors:**

- **Multi-org login**: if a user belongs to several active orgs, `login` returns
  `{ requiresOrgSelection, memberships }`; resend with `orgId` to get tokens.
- **Idempotent writes**: send an `Idempotency-Key` header on `POST /employees`.
  Replays with the same key + payload return the original result; the same key
  with a different payload is rejected (409).
- **Rate limiting**: `register`/`login`/`refresh` are throttled per IP
  (`AUTH_RATE_LIMIT` / `AUTH_RATE_TTL_SECONDS`).
- **Permission cache**: in-memory by default; set `PERMISSION_CACHE_DRIVER=redis`
  to share the cache across instances. Redis failures fail open to the database.

### Activity ingestion (high-volume path)

The ingestion service accepts batched activity events (authenticated with the
identity-service access token) and publishes them to the broker; `event-processor` consumes
and projects them. This path never touches the OLTP database.

```bash
curl -X POST http://localhost:3002/v1/ingest/activity \
  -H "authorization: Bearer <accessToken>" \
  -H "content-type: application/json" \
  -d '{"events":[{"eventType":"activity.session.started","occurredAt":"2026-06-19T10:00:00.000Z","payload":{"device":"laptop"}}]}'
```

> Note: `docker-compose.yml` publishes PostgreSQL on `5432`. If you run a native
> PostgreSQL on the same port, remap via a `docker-compose.override.yml`
> (e.g. `5433:5432`) and point `DATABASE_URL` at the new port.

## Architecture Docs

Full index: [docs/architecture/README.md](docs/architecture/README.md).

- [Overview — Scalable SaaS Architecture](docs/architecture/00-overview.md)
- Foundations: [Implementation Structure](docs/architecture/01-implementation-structure.md) ·
  [Tenancy](docs/architecture/02-postgres-prisma-tenancy.md) ·
  [Events & Analytics](docs/architecture/03-events-clickhouse-analytics.md) ·
  [Auth & Security](docs/architecture/04-auth-security-api.md) ·
  [Infra & CI/CD](docs/architecture/05-infra-cicd-operations.md) ·
  [Roadmap](docs/architecture/06-implementation-roadmap.md)
- Microservices: [Topology](docs/architecture/07-microservices-topology.md) ·
  [Production Operations](docs/architecture/08-production-operations.md) ·
  [Communication](docs/architecture/10-microservices-communication.md)
- Phases: [Phase 1 — Database-Per-Service (built)](docs/architecture/13-phase-1-database-per-service.md) ·
  [Phase 2 — operations-service](docs/architecture/14-phase-2-operations-service.md) ·
  [Phase 3 — Operations Auth & Choreography](docs/architecture/15-phase-3-operations-auth-and-choreography.md)

## Product Feature Docs

Feature definitions live in [docs/featureDocs](docs/featureDocs).
