# Infrastructure, CI/CD, and Operations Design

This document defines how RetainIQ should run reliably and cost-effectively from MVP to enterprise scale.

## 1. AWS Reference Architecture

MVP:

```text
CloudFront
  -> WAF
  -> ALB/API Gateway
  -> ECS or EKS services
  -> RDS PostgreSQL
  -> ElastiCache Redis
  -> S3
  -> CloudWatch/Loki/Prometheus
```

Scale:

```text
CloudFront + WAF
  -> API Gateway/Kong
  -> EKS
      web
      api
      ingestion-api
      analytics-api
      workers
      ai-api
  -> Aurora PostgreSQL + read replicas + PgBouncer
  -> MSK/Kafka
  -> ElastiCache Redis Cluster
  -> ClickHouse Cloud or self-managed ClickHouse
  -> S3 + lifecycle policies
  -> OpenSearch for audit/security search
  -> Prometheus/Grafana/Loki/Tempo
```

## 2. Kubernetes Workloads

Recommended deployments:

```text
web
identity-service
ingestion-api
analytics-api
ai-api
report-worker
notification-worker
integration-worker
audit-worker
clickhouse-writer
productivity-aggregator
attendance-correlator
ai-feature-worker
```

Separate worker types so one slow workload does not starve others.

## 3. Scaling Rules

| Workload | Scale Signal |
| --- | --- |
| `web` | CPU, memory, request rate |
| `identity-service` | CPU, p95 latency, request rate |
| `ingestion-api` | request rate, CPU, Kafka produce latency |
| `analytics-api` | p95 latency, ClickHouse query time |
| `clickhouse-writer` | Kafka lag |
| `productivity-aggregator` | Kafka lag, job queue depth |
| `report-worker` | queue depth |
| `notification-worker` | queue depth |
| `ai-api` | CPU/GPU, request queue, p95 latency |

Use KEDA for Kafka/queue-based autoscaling when possible.

## 4. Resource Isolation

Use node pools:

```text
general-api-pool
worker-pool
ai-pool
observability-pool
```

Do not run heavy AI or report workers on the same constrained nodes as API services.

Set:

- resource requests
- resource limits
- pod disruption budgets
- readiness probes
- liveness probes
- startup probes for slow services

## 5. Database Operations

PostgreSQL:

- RDS/Aurora with automated backups.
- PgBouncer for connection pooling.
- Read replicas for reporting/admin reads.
- Point-in-time recovery enabled.
- Slow query logging enabled.
- `statement_timeout` configured.
- Migration runbooks.

Prisma connection guidance:

```text
API pods should have small pool sizes.
PgBouncer absorbs connection spikes.
Workers should have separate pool limits.
```

ClickHouse:

- use ClickHouse Cloud initially if team lacks ops capacity
- partition and TTL from day one
- monitor parts count, merge pressure, query duration, disk usage
- avoid unbounded dashboard queries

Redis:

- cluster mode for scale
- separate logical DBs or clusters for cache vs queues at scale
- eviction policy intentionally configured
- do not rely on Redis for durable business state

## 6. S3 Operations

Buckets:

```text
retainiq-prod-app-files-{region}
retainiq-prod-screenshots-{region}
retainiq-prod-exports-{region}
retainiq-prod-backups-{region}
```

Lifecycle examples:

- screenshots: standard 30 days, infrequent access after 30, delete after configured retention
- exports: delete after 30-90 days
- audit exports: retain per compliance policy
- raw event archives: transition to Glacier if enabled

Always use:

- private buckets
- SSE-KMS
- block public access
- short-lived pre-signed URLs
- CloudFront signed URLs only if needed

## 7. CI/CD Pipeline

GitHub Actions stages:

```text
pull request:
  install
  lint
  typecheck
  unit tests
  contract tests
  prisma format/check
  security scan

main branch:
  build docker images
  push to registry
  deploy staging
  run migrations in staging
  smoke tests
  approval
  deploy production canary
  run production smoke tests
  promote rollout
```

Do not auto-run destructive migrations in production.

## 8. Migration Strategy

Database migrations must be backward compatible:

Safe sequence:

1. Add nullable column/table.
2. Deploy app that writes both old and new if needed.
3. Backfill in batches.
4. Switch reads.
5. Make column required/drop old field in later deploy.

Avoid:

- long locks
- table rewrites during peak traffic
- dropping columns in same deploy that stops writing them
- enum changes without testing Prisma behavior

## 9. Observability

Metrics:

- request rate
- latency p50/p95/p99
- error rate
- DB query time
- DB connection count
- Redis latency
- Kafka lag
- worker job duration
- failed jobs
- ClickHouse query duration
- S3 upload failures
- AI inference latency

Logs:

```json
{
  "level": "info",
  "service": "identity-service",
  "request_id": "uuid",
  "trace_id": "uuid",
  "org_id": "uuid",
  "user_id": "uuid",
  "action": "timesheet.approve",
  "duration_ms": 124
}
```

Tracing:

```text
gateway -> api -> postgres
gateway -> api -> kafka -> worker -> clickhouse
gateway -> analytics-api -> clickhouse
worker -> ai-api -> postgres
```

## 10. Alerting

Page immediately:

- API high 5xx rate
- auth service unavailable
- PostgreSQL unavailable
- Kafka unavailable
- Redis unavailable for auth/rate limit
- ingestion lag above threshold
- payment webhook failures
- audit writer failures

Ticket/non-page:

- slow dashboard queries
- rising report failures
- high screenshot storage usage
- individual integration sync failures
- high AI cost usage

## 11. Backup and Disaster Recovery

Backups:

- PostgreSQL PITR.
- S3 versioning for critical buckets.
- ClickHouse backup/snapshot plan.
- Terraform state backup.
- secrets backup/recovery process.

RPO/RTO targets:

| System | MVP Target | Enterprise Target |
| --- | --- | --- |
| PostgreSQL | RPO 15 min, RTO 4 hr | RPO 5 min, RTO 1 hr |
| S3 | RPO near zero | RPO near zero |
| ClickHouse | RPO 24 hr | RPO 1-6 hr |
| Redis cache | no strict RPO | no strict RPO |
| Kafka | RPO based on retention/replication | RPO low with MSK replication |

## 12. Cost Controls

Controls to implement early:

- plan-based screenshot retention
- plan-based AI request limits
- report scan limits
- dashboard caching
- ingestion batch compression
- Kafka retention limits
- ClickHouse TTL
- log sampling for high-volume endpoints
- no debug logs in production
- S3 lifecycle rules
- tenant usage metering

Tenant-level usage metrics:

```text
events_ingested
screenshots_stored_gb
reports_generated
ai_requests
active_employees
api_requests
integration_syncs
```

These metrics power billing, abuse detection, and cost visibility.

## 13. Environments

Local:

- Docker Compose for PostgreSQL, Redis, ClickHouse, Kafka optional.
- MinIO for S3-compatible local storage if needed.

Staging:

- production-like, smaller scale.
- separate secrets.
- test SSO/OAuth apps.
- synthetic data.

Production:

- protected deployments.
- no direct database edits.
- audited admin access.
- break-glass process.

## 14. Release Management

Use:

- feature flags
- canary releases
- database migration gates
- rollback plans
- smoke tests
- tenant allowlists for risky features

Feature flag dimensions:

```text
global
plan
organization
role
region
percentage rollout
```

