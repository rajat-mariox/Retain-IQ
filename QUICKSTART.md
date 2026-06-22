# Quick Start Guide — Database-Per-Service

Each service owns its own database. See
[docs/architecture/13-phase-1-database-per-service.md](docs/architecture/13-phase-1-database-per-service.md)
for the full topology.

## Run everything (Docker) — one command

```bash
npm run up          # build + start all DBs, Redis, Kafka, and all 5 services
                    # migrations run automatically (migrator service) before apps start
npm run logs        # follow logs for the whole stack
npm run ps          # status
npm run down        # stop (keep data)
npm run down:clean  # stop + wipe all volumes (fresh DBs/Kafka)
```

`npm run up` brings the stack up **on Kafka** (broker + all services on the Kafka driver) and
self-migrates — no manual steps. Prefer Redis Streams instead (no Kafka broker)?

```bash
npm run up:redis    # base stack on the Redis driver
npm run down:redis
```

> These npm scripts wrap `docker compose` with the right `-f` files baked in. If you call
> `docker compose` directly in Kafka mode, pass both files every time:
> `docker compose -f docker-compose.yml -f docker-compose.kafka.yml <cmd>`.

## Run infra only, apps via npm (dev)

```bash
# Start one Postgres per service + Redis
docker-compose -f docker-compose.infra.yml up -d

# Generate Prisma clients, then run migrations per service
npm install
npm run db:generate
DATABASE_URL=postgresql://identity:identity@localhost:5432/retainiq-identity?schema=public          npm run db:migrate:identity
DATABASE_URL=postgresql://inbox:inbox@localhost:5433/retainiq-inbox?schema=public                    npm run db:migrate:inbox
DATABASE_URL=postgresql://analytics:analytics@localhost:5434/retainiq-analytics?schema=public        npm run db:migrate:analytics
DATABASE_URL=postgresql://notifications:notifications@localhost:5435/retainiq-notifications?schema=public npm run db:migrate:notifications

# Run a service (each is an independent microservice / image)
npm run dev:identity
npm run dev:ingestion
```

## Services & databases

Each service is a **separate microservice** with its **own image** (`apps/<svc>/Dockerfile`).

| Service (apps/) | HTTP/ops port | Database | Host:Port | User / Password |
|---|---|---|---|---|
| `identity-service` | 3001 | retainiq-identity | localhost:5432 | identity / identity |
| `activity-ingestion` | 3002 | — (stateless) | — | — |
| `event-processor` | 3003 | retainiq-inbox | localhost:5433 | inbox / inbox |
| `analytics-service` | 3004 | retainiq-analytics | localhost:5434 | analytics / analytics |
| `notifications-service` | 3005 | retainiq-notifications | localhost:5435 | notifications / notifications |

> identity-service also reads the notifications DB read-only (in-app inbox feed) via
> `NOTIFICATIONS_DATABASE_URL`. Writes to it are owned by notifications-service.

## Event flow

```
activity-ingestion ──(activity.*)──►  retainiq.activity ──► analytics-service (scores → analytics DB)
                                                      └────► event-processor   (inbox dedup)
identity-service ──(org.*, employee.*, org.member.upserted)──► retainiq.events ──► notifications-service
                                                                                   (deliveries + OrgRecipient read model)
```

## Build & verify

```bash
npm run build       # all packages + apps
npm run typecheck
npm run lint
npm run test
```

## Testing infra

```bash
# Per-service DB connectivity
docker exec retainiq-identity-db      psql -U identity      -d retainiq-identity      -c "SELECT 1;"
docker exec retainiq-inbox-db         psql -U inbox         -d retainiq-inbox         -c "SELECT 1;"
docker exec retainiq-analytics-db     psql -U analytics     -d retainiq-analytics     -c "SELECT 1;"
docker exec retainiq-notifications-db psql -U notifications -d retainiq-notifications -c "SELECT 1;"

# Redis + streams
docker exec retainiq-redis redis-cli PING
docker exec retainiq-redis redis-cli XINFO GROUPS retainiq.events
```

## Kubernetes

```bash
kubectl apply -k infra/k8s
# Run migrations (one job per service DB) before/with rollout:
kubectl apply -f infra/k8s/migrate-job.yaml
```

## Files reference

| File | Purpose |
|---|---|
| `docker-compose.yml` | Full stack: per-service DBs + Redis + migrator + all services |
| `docker-compose.kafka.yml` | Kafka broker + switches all services to the Kafka driver |
| `docker-compose.infra.yml` | Databases + Redis only (run apps via npm) |
| `docker-compose.observability.yml` | Prometheus + Grafana + Loki + Promtail |
| `packages/database/prisma/<svc>/schema.prisma` | Per-service Prisma schema + migrations |
| `infra/k8s/` | Kubernetes manifests (one Deployment per service) |
| `docs/architecture/13-phase-1-database-per-service.md` | As-built architecture |

## npm script shortcuts

| Script | Does |
|---|---|
| `npm run up` | Build + start the whole stack **on Kafka**, auto-migrated |
| `npm run up:redis` | Same, but Redis Streams driver (no Kafka) |
| `npm run down` / `down:clean` | Stop (keep data) / stop + wipe volumes |
| `npm run logs` / `ps` / `restart` | Follow logs / status / restart services |
| `npm run migrate:containers` | Re-apply migrations to the running containers |
