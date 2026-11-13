# Service Clustering & Concurrency Model

Two principles govern the architecture:

1. **A service is a cluster of same-kind features** (a bounded context), not one
   service per feature/screen. Group by what scales and fails together.
2. **Work that isn't request-shaped runs off the request path** — on *workers*
   (out-of-process, scale-out) and *threads* (`worker_threads` for CPU-bound),
   so the event loop never blocks and throughput stays high.

## 1. Service map (feature clusters)

Grounded in `docs/featureDocs`. "Kind of work" + scaling/infra profile decides the cluster.

| Service | Feature cluster | Profile | Store | Status |
| --- | --- | --- | --- | --- |
| **identity** (identity-service) | orgs, users, RBAC, SSO, billing, settings, audit, super-admin | transactional control-plane | Postgres | built |
| **workforce** | employees, teams, departments, projects, tasks, goals | transactional CRUD | Postgres | partial (employees) |
| **attendance** | check-in/out, shifts, leave, holidays, schedules, overtime | transactional + scheduled | Postgres | planned |
| **time-tracking** | work sessions, timesheets, approvals, manual entries | transactional + derived | Postgres | planned |
| **ingestion** | activity telemetry: app/web usage, idle, presence | **high-volume write** | → streams | built |
| **screenshots** | capture, blur/masking, retention, access audit | **blob, privacy** | S3+KMS | planned |
| **analytics** | productivity/focus/utilization scores, heatmaps, dashboards, reports | **read-heavy + batch precompute** | ClickHouse + Postgres facts | planned |
| **ai** (FastAPI) | burnout/attrition, scores, recommendations, summaries, copilot | **async precompute + inference** | feature/score tables | planned |
| **payroll** | billable hours, payroll calc, invoices, exports | transactional + batch | Postgres + S3 | planned |
| **integrations** | Slack/Teams/Google/Jira/… connectors, OAuth, sync, webhooks | **async external I/O** | Postgres + streams | planned |
| **notifications** | rules engine, multi-channel fan-out, escalation, quiet hours | **async fan-out** | Postgres + streams | planned |

Consolidate transactional CRUD (identity, workforce) — they share a tx boundary; splitting
them early adds distributed-transaction pain for no benefit. Split out the ones with a
distinct scaling/infra profile (ingestion, analytics, ai, integrations, notifications, screenshots).

## 2. Concurrency model — threads vs workers

Node's event loop already makes **I/O non-blocking**. The job is to (a) keep CPU-bound work
*off* that loop, and (b) move non-request work to scalable consumers.

| Work | Mechanism | Why |
| --- | --- | --- |
| Request-time, light I/O | inline async handler | already non-blocking |
| Event-driven background I/O (projections, ClickHouse writes, notification fan-out, integration sync) | **worker process = stream/queue consumer** (the `event-processor` pattern) | scale-out on lag (KEDA), at-least-once + DLQ |
| Scheduled / retryable jobs (payroll runs, daily summaries, retention purge, report builds) | **BullMQ worker** (cron + retries + backoff + DLQ) | durable scheduling, restart-safe |
| CPU-bound (scoring math, PDF/Excel, image/screenshot processing, ML feature vectors) | **`worker_threads` pool inside the worker** | parallelism without blocking the loop |

Rule of thumb: **worker = out-of-process scale-out for I/O**; **thread = in-process parallelism
for CPU**. A heavy worker often uses both — it consumes a stream (process) and offloads the
crunch to a thread pool.

### Throughput levers (from the docs' Golden Rules)
- **Partition** by `org_id:employee_id` — per-employee ordering, no hot-partition on huge tenants.
- **Batch** ingestion; accept-and-queue, never compute analytics in request time (backpressure).
- **Consumer concurrency** tuned per worker; bounded queries only.
- **Idempotent consumers** (the `ConsumedEvent` inbox) — safe to scale and redeliver.
- **Precomputed read models / facts** — dashboards read facts, never raw events.

## 3. How the current code embodies this

- `identity-service` = identity cluster; request path stays thin and transactional; domain events
  go to the outbox (no slow calls in the tx).
- `activity-ingestion` = high-volume write cluster; accepts batches, publishes to a stream,
  touches no OLTP DB.
- `event-processor` = the worker pattern: stream consumer group, idempotent, DLQ, drains on
  shutdown, autoscales on lag (KEDA). **This is the template every background worker follows.**
- A CPU-bound worker (e.g. analytics scoring) adds a `worker_threads` pool to that template.

## 4. Worker skeleton (thread pool inside a consumer)

```
event-processor pattern (process)              worker_threads pool (CPU)
  StreamConsumer.run(handler) ─► handler ─►  pool.run(scoreEmployeeDay, batch)
     │ XACK on success                          │ N threads = N cores
     │ reclaim + DLQ on failure                 │ no event-loop blocking
     └ scale replicas on stream lag             └ returns computed facts → upsert
```

Concretely: `apps/analytics-service` consumes `retainiq.activity`, buckets events by
`org_id:employee_id:day`, and offloads score computation to a `worker_threads` pool; results
are upserted as daily facts (Postgres now, ClickHouse `ReplacingMergeTree` at Scale 1).
