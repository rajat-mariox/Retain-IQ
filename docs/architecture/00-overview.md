# RetainIQ Scalable SaaS Architecture

## 1. Architecture Goal

RetainIQ is a multi-tenant AI Workforce Intelligence Platform. It must support:

- Millions of platform users.
- Up to 100,000 organizations.
- Up to 100,000 employees per large organization.
- High-frequency activity ingestion from web, desktop, mobile, and integrations.
- Strict organization-level data isolation.
- Low operating cost through partitioning, batching, caching, async jobs, and tiered storage.
- Auditability for every important user, system, billing, security, and AI decision.

The system should not be designed as a single CRUD application. It is an event-heavy SaaS platform with separate paths for transactional workflows, real-time ingestion, analytics, AI scoring, reporting, and compliance.

## 2. Recommended Stack

| Layer | Choice | Reason |
| --- | --- | --- |
| Frontend | Next.js, React, Tailwind, ShadCN | Fast SaaS UI, SSR/CSR support, component velocity |
| API Gateway | Kong or AWS API Gateway at enterprise scale, NGINX for early stage | Auth, rate limits, routing, request shaping |
| Backend | NestJS | Modular service boundaries, guards, interceptors, queues, typed APIs |
| AI Services | Python FastAPI | ML ecosystem, model serving, feature processing |
| OLTP Database | PostgreSQL + Prisma | Strong consistency for tenants, users, policies, approvals, billing |
| Analytics Database | ClickHouse | Cheap high-volume event analytics, dashboards, time-series queries |
| Cache | Redis Cluster | Sessions, rate limits, hot dashboards, locks, job state |
| Queue/Event Bus | Kafka for platform event backbone, BullMQ for local jobs | Kafka for durable streams; BullMQ for simple background work |
| Object Storage | S3 | Screenshots, exports, reports, attachments, evidence files |
| Search | OpenSearch | Audit search, employee directory search, report search |
| Infra | Docker + Kubernetes | Horizontal scaling, isolated workloads, rolling deploys |
| CI/CD | GitHub Actions | Build, test, security scan, deploy |
| Monitoring | Prometheus + Grafana | Metrics and service health |
| Logs | Loki for cost-efficient logs; OpenSearch only for searchable audit/security logs | Avoid expensive ELK for all logs |
| Cloud | AWS | EKS, RDS/Aurora, MSK, ElastiCache, S3, CloudFront |

Use MongoDB only if a feature truly needs flexible document storage. For this product, PostgreSQL JSONB plus ClickHouse usually avoids another operational database.

## 3. High-Level System

```text
Next.js Web App
Desktop Agent
Mobile App
3rd Party Webhooks
        |
CloudFront / WAF
        |
API Gateway
        |
        +--> Auth / Identity Service
        +--> Tenant / Organization Service
        +--> Employee / HR Service
        +--> Attendance Service
        +--> Time Tracking Service
        +--> Monitoring Ingestion Service
        +--> Productivity Service
        +--> Projects / Teams Service
        +--> Payroll / Timesheets Service
        +--> Notification Service
        +--> Billing Service
        +--> Integration Service
        +--> Audit / Compliance Service
        +--> Reports Service
        +--> AI Intelligence Service
        |
PostgreSQL + Redis + Kafka + ClickHouse + S3 + OpenSearch
```

## 4. Service Boundaries

Start with a modular monolith in NestJS, then split services when traffic and team ownership require it. Premature microservices will increase cost and complexity.

Recommended starting modules:

| Module | Owns |
| --- | --- |
| Identity | Login, JWT, refresh tokens, SSO, OAuth, sessions, MFA |
| Tenant | Organizations, plans, limits, feature flags, isolation config |
| Employee | Employees, departments, teams, roles, lifecycle |
| Attendance | Check-in/out, shifts, leave, holidays, schedules, regularization |
| Activity Ingestion | Desktop/web/mobile events, app usage, website usage, idle, screenshots metadata |
| Productivity | Scores, focus, utilization, app/site classification, trends |
| AI Intelligence | Burnout, attrition, recommendations, daily/weekly summaries, explainability |
| Projects | Projects, tasks, milestones, goals |
| Payroll | Timesheets, billable hours, payroll-ready calculations, exports |
| Integration | Slack, Teams, Google, Outlook, GitHub, GitLab, Jira, ClickUp, Asana |
| Notification | Inbox, email, push, escalation rules |
| Billing | Plans, subscriptions, invoices, usage metering |
| Audit | Immutable audit events, compliance exports, admin activity |
| Reporting | Report definitions, exports, scheduled reports |

Split into independent deployable services later:

1. Auth/Tenant service.
2. Activity ingestion service.
3. Analytics/query service.
4. AI service.
5. Billing service.
6. Notification service.

## 5. Data Storage Strategy

### PostgreSQL: source of truth

Use PostgreSQL for transactional data:

- organizations
- users/employees
- departments/teams
- roles/permissions
- shifts/schedules
- leave requests
- timesheets
- payroll rules
- plans/subscriptions
- integration connections
- notification preferences
- audit metadata

Every tenant-owned table must include:

```text
org_id
created_at
updated_at
created_by
updated_by
```

Large tenant tables should use composite indexes:

```text
(org_id, id)
(org_id, employee_id)
(org_id, created_at)
(org_id, status, created_at)
```

### ClickHouse: high-volume analytics

Use ClickHouse for:

- activity events
- app usage events
- website usage events
- idle events
- work session facts
- screenshot metadata facts
- productivity facts
- attendance daily facts
- employee score snapshots
- dashboard aggregates

Partition by month or week, order by tenant and time:

```sql
PARTITION BY toYYYYMM(event_date)
ORDER BY (org_id, employee_id, event_time)
```

For very large tenants, add `tenant_shard_id` or route the organization to a dedicated ClickHouse cluster.

### S3: binary and long-retention data

Use S3 for:

- screenshots
- leave attachments
- generated reports
- payroll exports
- invoices
- data export archives
- compliance evidence

Path format:

```text
s3://retainiq-{region}/org/{org_id}/employee/{employee_id}/screenshots/yyyy/mm/dd/{file_id}.webp
```

Store only metadata and object keys in databases. Never store binary data in PostgreSQL.

### Redis: hot and temporary state

Use Redis for:

- rate limits
- short-lived JWT/session deny lists
- OAuth state
- idempotency keys
- distributed locks
- live employee status
- dashboard cache
- query result cache
- BullMQ jobs

Use TTL aggressively. Redis is not the system of record.

### OpenSearch: search only where needed

Use OpenSearch for:

- audit log search
- admin action search
- employee directory search
- report discovery
- integration sync error search

Do not use OpenSearch as the primary analytics engine.

## 6. Tenant Isolation Model

Use a hybrid model:

| Tenant Type | Storage Model |
| --- | --- |
| Small/medium organizations | Shared database, shared schema, strict `org_id` isolation |
| Large enterprise organizations | Dedicated schema or dedicated database |
| Regulated/strategic enterprise | Dedicated database, dedicated object bucket prefix, optional dedicated ClickHouse cluster |

Rules:

- Every request must resolve `org_id` from authenticated membership, not from user-provided body data.
- Use PostgreSQL Row Level Security for high-risk tables where possible.
- Add Prisma middleware or repository guards that require `org_id` for every tenant-scoped query.
- S3 object keys must include `org_id`.
- Kafka messages must include `org_id`, `event_id`, `event_time`, and `producer`.
- ClickHouse tables must include `org_id` in ordering keys.
- Background jobs must carry tenant context explicitly.

## 7. Event-Driven Flow

High-volume tracking should not synchronously write to many tables.

```text
Desktop Agent / Web App
        |
Ingestion API
        |
Validate + authenticate + idempotency check
        |
Kafka topic
        |
Consumers:
  - ClickHouse writer
  - Real-time status updater
  - Productivity aggregator
  - Attendance correlator
  - Screenshot metadata processor
  - AI feature builder
  - Audit writer
```

Recommended Kafka topics:

```text
activity.events.v1
attendance.events.v1
timesheet.events.v1
project.events.v1
integration.events.v1
notification.events.v1
billing.events.v1
audit.events.v1
ai.features.v1
ai.recommendations.v1
```

Partition keys:

```text
org_id:employee_id
org_id:department_id
org_id
```

Use `org_id:employee_id` for per-employee ordering. Do not use only `org_id` for large tenants because one huge organization can create hot partitions.

## 8. Idempotency

Every write API that can be retried must support idempotency.

Request pattern:

```text
Idempotency-Key: client_generated_uuid
X-Request-Id: request_uuid
```

Store idempotency records in Redis first, then PostgreSQL for critical financial or payroll workflows.

Idempotent event format:

```json
{
  "event_id": "uuid",
  "org_id": "uuid",
  "employee_id": "uuid",
  "source": "desktop-agent",
  "schema_version": 1,
  "occurred_at": "2026-06-18T10:00:00Z",
  "ingested_at": "2026-06-18T10:00:02Z",
  "payload_hash": "sha256"
}
```

Consumers must deduplicate by `event_id` or `(source, source_event_id)`.

## 9. API, Rate Limiting, and Throttling

Apply limits at multiple layers:

| Layer | Limit |
| --- | --- |
| WAF/API Gateway | IP, region, bot, abusive traffic |
| Auth middleware | user/session/org limits |
| Ingestion service | per agent, employee, org, event type |
| Queue consumers | consumer concurrency and backpressure |
| Database | connection pool, query timeout |

Suggested rate limits:

- Web UI: per user and per org.
- Desktop agent: per employee and per device.
- Integrations: per provider connection.
- Reports: per org and per role.
- AI copilot: per org, per user, and per plan.

Return `429` with retry-after metadata. For ingestion, prefer accepting compressed batches over frequent single-event writes.

## 10. Query and N+1 Prevention

Rules:

- Never load dashboards by looping employees and querying per employee.
- Use aggregate tables/materialized views for dashboards.
- Use cursor pagination, not offset pagination, on large tables.
- Use Prisma `select` to fetch only required fields.
- Use DataLoader-style batching for GraphQL-like access patterns.
- Use SQL joins or `findMany where id in (...)` batching instead of per-row queries.
- Add query budgets per endpoint.
- Add database timeout and slow query logging.

Bad pattern:

```text
GET team dashboard -> fetch 10,000 employees -> query attendance one by one
```

Good pattern:

```text
GET team dashboard -> read precomputed team_daily_metrics by org_id, team_id, date
```

## 11. Database Scaling

PostgreSQL:

- Use PgBouncer for connection pooling.
- Use read replicas for read-heavy admin pages.
- Use partitioning for large audit, notification, and timesheet tables.
- Use dedicated database for billing and identity if compliance requires it.
- Use background archiving for old operational data.

Prisma:

- Avoid one Prisma client per request.
- Use a singleton Prisma client per process.
- Set pool size per pod carefully.
- For heavy analytics, bypass Prisma and query ClickHouse or raw SQL.

Connection sizing example:

```text
100 app pods * 10 DB connections = 1,000 connections
```

This is too high for many PostgreSQL setups. Use PgBouncer and keep Prisma pool sizes small.

## 12. Analytics and Reporting

Use derived tables instead of dashboard-time computation.

Core facts:

```text
employee_day_fact
employee_hour_fact
team_day_fact
department_day_fact
org_day_fact
app_usage_fact
website_usage_fact
attendance_day_fact
productivity_score_snapshot
workforce_risk_snapshot
```

Dashboards should query facts such as:

- attendance rate
- active employees
- idle employees
- focus hours
- productivity score
- burnout risk count
- attrition risk count
- team health score

Reports that scan huge time ranges should run asynchronously:

1. Create report request in PostgreSQL.
2. Enqueue job.
3. Query ClickHouse.
4. Write export to S3.
5. Notify user when ready.

## 13. AI Architecture

AI should be a separate intelligence layer.

```text
Raw Events -> Aggregates -> Feature Store -> Model/Rules -> Scores -> Explanations -> Recommendations
```

Feature groups:

- attendance reliability
- punctuality
- productivity momentum
- focus quality
- context switching
- utilization
- burnout signals
- attrition signals
- engagement signals
- manager/team health

Store outputs in PostgreSQL for operational reads and ClickHouse for trend analysis:

```text
employee_score_snapshot
employee_risk_snapshot
team_health_snapshot
ai_recommendation
ai_explanation
```

Do not call an LLM for every dashboard load. Precompute summaries daily/weekly and cache them.

Use LLMs for:

- natural-language summaries
- executive copilot answers
- recommendation wording
- explanation generation

Use deterministic rules and ML models for:

- scoring
- risk thresholds
- anomaly detection
- trend detection

## 14. Authentication and Authorization

Auth requirements:

- JWT access token with short TTL.
- Refresh token rotation.
- Session/device tracking.
- SSO via SAML/OIDC.
- OAuth for Google/Microsoft login where required.
- MFA for admins.
- Domain verification for enterprise SSO.
- SCIM provisioning later for enterprise customers.

JWT claims:

```json
{
  "sub": "user_id",
  "org_id": "active_org_id",
  "membership_id": "membership_id",
  "role": "admin",
  "permissions_version": 12,
  "session_id": "uuid"
}
```

Authorization:

- RBAC for standard roles.
- ABAC for scoped access such as department, team, manager chain, location, and feature plan.
- Permission checks must happen in backend guards, not only in frontend.
- Cache permission bundles in Redis with version invalidation.

## 15. Audit and Compliance

Audit everything important:

- logins and failed logins
- SSO changes
- role/permission changes
- employee creation/update/deletion
- payroll and timesheet approvals
- leave approvals
- billing changes
- integration connections
- data exports
- AI score changes and recommendations
- screenshot access
- admin impersonation

Audit event schema:

```json
{
  "audit_id": "uuid",
  "org_id": "uuid",
  "actor_user_id": "uuid",
  "action": "timesheet.approved",
  "resource_type": "timesheet",
  "resource_id": "uuid",
  "ip": "string",
  "user_agent": "string",
  "before": {},
  "after": {},
  "occurred_at": "timestamp"
}
```

Write audit events asynchronously to Kafka, but for critical actions also persist a minimal audit row transactionally.

## 16. Notifications

Use notification rules and templates:

```text
Event -> Rule Engine -> Notification Intent -> Delivery Job -> Email/Push/In-App
```

Channels:

- in-app inbox
- email
- browser push
- desktop push
- Slack/Teams later

Use digesting to prevent alert fatigue. For example, combine low-priority productivity events into daily summaries.

## 17. Integrations

Each integration should have:

- OAuth connection record
- encrypted tokens
- provider account mapping
- user mapping
- sync cursor
- sync status
- retry state
- webhook secret
- permission scope record

Never process provider webhooks directly into core tables. Normalize into integration events first, then process asynchronously.

## 18. File and Screenshot Strategy

Screenshots are expensive. Control cost early:

- Store compressed WebP.
- Use configurable quality.
- Use org-level retention policies.
- Store thumbnails separately.
- Use lifecycle rules to move old screenshots to cheaper storage.
- Encrypt objects with KMS.
- Use pre-signed URLs with short TTL.
- Audit every screenshot view/download.

## 19. Deployment and Kubernetes

Recommended workloads:

```text
web-app
api-gateway
identity-service
ingestion-api
analytics-api
auth-service
notification-worker
report-worker
integration-worker
clickhouse-writer
ai-feature-worker
ai-api
```

Scaling:

- HPA on CPU/memory for web/core services.
- HPA on Kafka lag for consumers.
- Separate node pool for AI workloads.
- Separate node pool for bursty report workers.
- Pod disruption budgets for critical services.
- Resource limits on every workload.

## 20. Observability

Every service must emit:

- request rate
- error rate
- latency p50/p95/p99
- DB query latency
- queue lag
- job failures
- Kafka consumer lag
- cache hit ratio
- rate-limit hits
- tenant-level usage metrics

Use OpenTelemetry tracing across:

```text
API Gateway -> NestJS service -> Kafka -> worker -> database
```

Logs must include:

```text
trace_id
request_id
org_id
user_id
service
action
```

Never log secrets, tokens, passwords, payroll details, or raw screenshot content.

## 21. CI/CD

Pipeline:

1. Lint.
2. Type check.
3. Unit tests.
4. Integration tests with PostgreSQL/Redis.
5. Prisma migration check.
6. Docker build.
7. Security scan.
8. Push image.
9. Deploy to staging.
10. Run smoke tests.
11. Manual approval for production.
12. Progressive rollout.

Deployment strategy:

- Blue/green or canary for APIs.
- Backward-compatible DB migrations.
- Feature flags for risky features.
- Rollback image without rolling back migrations unless planned.

## 22. Region Strategy

Start with one primary region to control cost.

Scale to multi-region like this:

| Phase | Region Strategy |
| --- | --- |
| MVP | Single AWS region |
| Growth | Read replicas and S3 CDN |
| Enterprise | Regional data residency per customer |
| Global | Tenant routed to home region |

Tenant home region must be stored in the tenant metadata:

```text
org_id -> region -> database cluster -> object bucket -> ClickHouse cluster
```

Avoid active-active multi-region writes until the business truly needs it.

## 23. Cost Control

Biggest cost risks:

- screenshots
- logs
- high-cardinality metrics
- ClickHouse storage
- AI/LLM calls
- report scans
- Kafka retention

Controls:

- Batch ingestion.
- Compress payloads.
- Keep raw Kafka retention short.
- Store long-term history in ClickHouse/S3.
- Use materialized aggregates.
- Cache dashboards.
- Use lifecycle policies for screenshots and exports.
- Precompute AI summaries.
- Put AI copilot behind plan limits and rate limits.
- Use Loki for service logs and OpenSearch only for searchable compliance logs.

## 24. MVP to Enterprise Roadmap

### Phase 1: Scalable MVP

- Modular NestJS backend.
- PostgreSQL with strict `org_id`.
- Redis.
- S3.
- BullMQ.
- Basic ClickHouse for activity analytics.
- Next.js app.
- JWT auth.
- RBAC.
- Audit logs.
- Attendance, time tracking, productivity dashboards.

### Phase 2: Event Platform

- Kafka.
- Dedicated ingestion API.
- ClickHouse materialized views.
- Report workers.
- Integration workers.
- Notification service.
- PgBouncer.
- OpenTelemetry.

### Phase 3: Enterprise Readiness

- SSO/SAML/OIDC.
- SCIM.
- Dedicated tenant database option.
- Advanced audit and compliance exports.
- Regional tenant routing.
- Data retention policies.
- AI governance and explainability.

### Phase 4: Massive Scale

- Dedicated clusters for large tenants.
- Tenant-aware sharding.
- Kafka topic scaling.
- ClickHouse cluster per region.
- Read model services.
- Enterprise data residency.
- Advanced workload isolation.

## 25. Golden Rules

1. Do not query raw events for dashboards.
2. Do not put screenshots in the database.
3. Do not trust `org_id` from request bodies.
4. Do not perform synchronous fan-out writes during ingestion.
5. Do not use offset pagination for large data.
6. Do not run expensive reports in API request time.
7. Do not call AI models during every page load.
8. Do not deploy every module as a microservice on day one.
9. Do not allow unlimited logs, screenshots, or AI requests.
10. Do not build without tenant-level metrics from the beginning.

