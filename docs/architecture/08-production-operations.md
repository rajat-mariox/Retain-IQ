# Production Operations & Reliability

How the platform is run from local to production, and the reliability mechanisms
built into the services. Companion to [07-microservices-topology](07-microservices-topology.md).

## Environments

| Env | Infra | Notes |
| --- | --- | --- |
| local | `docker compose up` (Postgres, Redis, 3 services) + optional `docker-compose.observability.yml` (Prometheus/Grafana/Loki) | one image, per-service command |
| staging | EKS, RDS, ElastiCache, S3 — separate secrets/topics | deploy on merge to `main` |
| production | EKS (node pools: general-api, worker, observability), Aurora PITR, ElastiCache, S3+KMS | protected deploys, canary, manual approval |

Each environment has its own DB, Redis, S3 prefix, signing keys, and OAuth creds.
Secrets come from AWS Secrets Manager/SSM (via External Secrets Operator) — never committed.
`@retainiq/config` rejects placeholder secrets and equal access/refresh secrets at boot.

## Observability (built in)

- **Logs**: pino structured JSON on every service (`service`, and per request `requestId`, `traceId`, `orgId`, `userId`, `method`, `route`, `status`, `durationMs`). Secrets are redacted. Shipped to Loki (local: promtail; prod: agent → Loki).
- **Metrics**: Prometheus at `/v1/metrics` (HTTP services) and `:3003/metrics` (worker). RED HTTP metrics + `outbox_pending_events`, `outbox_published_total`, `worker_events_consumed_total`, `worker_events_duplicate_total`. Scraped via ServiceMonitors.
- **Tracing**: `traceId` is propagated through request context and event envelopes today; OpenTelemetry spans → Tempo is the next step (seam is in place).

## Reliability mechanisms

- **Liveness / readiness / startup probes** on all services. Readiness checks real dependencies (Postgres `SELECT 1`, Redis `PING`) and returns 503 when a dep is down, so traffic stops routing to a degraded pod.
- **Graceful shutdown**: services `enableShutdownHooks`; the worker drains in-flight handlers on SIGTERM (bounded), then closes Redis/Prisma. `terminationGracePeriodSeconds` set accordingly.
- **Crash safety**: `unhandledRejection` logged; `uncaughtException` logged at fatal then exit non-zero for a clean restart.
- **Transactional outbox**: domain events are written in the same transaction as the state change; the relay claims rows with `FOR UPDATE SKIP LOCKED` (safe across replicas), publishes, and marks PUBLISHED, retrying with backoff and parking FAILED after 5 attempts.
- **At-least-once consumers**: the `StreamConsumer` ACKs on success, reclaims messages stranded by a crashed consumer (XPENDING + XCLAIM), and routes poison messages to a `<stream>.dlq` dead-letter stream after `maxDeliveries`. Consumers are idempotent via the `ConsumedEvent` inbox.
- **Rate limiting** on auth endpoints; **idempotency** on retryable writes (`Idempotency-Key`).

## Autoscaling

- HTTP services: HPA on CPU/memory.
- `event-processor`: **KEDA** ScaledObject on Redis Stream pending-entry count (consumer-group lag) — scales on backlog, not CPU.

## Deploys

- One image, per-service `command`. CI builds/pushes on `main`, deploys staging, runs migrations, smoke-tests, then production canary with manual approval.
- **Migrations are expand/contract** (add nullable → dual-write → backfill → switch reads → drop later) and run as a pre-rollout Job (`infra/k8s/migrate-job.yaml`) so the old version keeps working during rollout. No destructive migrations in prod.
- Rollback = redeploy previous image tag (do not roll back migrations unless planned).

## DLQ runbook

A message in `retainiq.<stream>.dlq` exhausted retries. To inspect/replay:

```bash
redis-cli XRANGE retainiq.events.dlq - + COUNT 10        # inspect (event + meta: error, deliveries, originalId)
# fix root cause, then re-publish the payload back to the source stream:
redis-cli XADD retainiq.events '*' event '<json>'
```

## Alerting (targets)

- **Page**: API 5xx rate high, Postgres/Redis down, ingestion/worker stream lag over threshold, audit-write failures, DLQ growth.
- **Ticket**: slow dashboards, rising report/integration failures, high screenshot storage, high AI cost.

## Backups / DR

Postgres PITR (RPO 15m→5m), S3 versioning (RPO ~0), ClickHouse snapshots, Terraform
state in versioned S3. Production data changes only via migrations/app — direct DB
edits are break-glass and audited.
