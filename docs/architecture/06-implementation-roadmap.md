# RetainIQ Implementation Roadmap

This roadmap is optimized for scalable progress: build the foundation once, avoid premature microservices, and introduce expensive infrastructure only when the product needs it.

## Phase 0: Architecture Foundation

Goal: make the product buildable with clear boundaries.

Deliverables:

- monorepo setup
- Next.js app shell
- NestJS API shell
- shared contracts package
- Prisma package
- typed config package
- logger/tracing package
- Docker Compose for local PostgreSQL and Redis
- base CI pipeline

Engineering gates:

- TypeScript strict mode.
- request context exists.
- tenant context exists.
- structured logs exist.
- health endpoints exist.

## Phase 1: Scalable MVP Core

Goal: ship usable SaaS without overbuilding infra.

Infrastructure:

- Next.js web app
- NestJS modular API
- PostgreSQL
- Redis
- S3
- BullMQ
- basic observability

Product modules:

- identity and sessions
- organization setup
- employees, departments, teams
- RBAC permissions
- attendance check-in/out
- time tracking sessions
- basic activity ingestion
- basic productivity dashboard
- notifications inbox
- settings
- audit logs

Important technical work:

- `org_id` on every tenant table
- repository-level tenant guard
- cursor pagination
- idempotency for important writes
- S3 file upload service
- audit event helper
- rate limiting for login and APIs

Do not build yet:

- full microservices
- complex Kafka setup
- active-active regions
- custom ML models
- full payroll
- heavy report builder

## Phase 2: Analytics Backbone

Goal: separate high-volume activity analytics from transactional operations.

Infrastructure:

- ClickHouse
- dedicated ingestion API
- ClickHouse writer worker
- analytics read service or module
- S3 screenshot lifecycle rules

Product modules:

- app usage
- website usage
- idle detection
- screenshot metadata
- work session facts
- employee daily facts
- team and org dashboards
- productivity score snapshots

Important technical work:

- batch ingestion endpoint
- event schema validation
- source event deduplication
- ClickHouse raw tables
- daily/hourly fact tables
- dashboard cache
- report job framework

Scale gate:

- If ingestion volume is low, BullMQ can handle early async processing.
- Add Kafka when replay, durable streams, and multiple consumers become necessary.

## Phase 3: Event Platform

Goal: make ingestion durable, replayable, and independently scalable.

Infrastructure:

- Kafka or MSK
- schema registry or contract validation strategy
- event consumers
- Kafka lag autoscaling
- outbox publisher

Consumers:

- clickhouse writer
- attendance correlator
- productivity aggregator
- real-time status updater
- audit writer
- notification rule processor
- AI feature builder

Important technical work:

- event envelope standard
- topic partition strategy
- idempotent consumers
- dead-letter topics
- backfill tooling
- replay runbooks

## Phase 4: Enterprise Security

Goal: become credible for large organizations.

Product/security:

- SAML/OIDC SSO
- Google/Microsoft OAuth login
- MFA for admins
- domain verification
- SCIM provisioning
- advanced RBAC/ABAC
- audit search
- screenshot access audit
- retention policies
- data export workflows
- privacy policy controls

Infrastructure:

- OpenSearch for audit/security search
- Secrets Manager/KMS
- stronger WAF rules
- private networking
- protected production deploys

Engineering gates:

- tenant isolation tests
- permission tests
- audit coverage tests
- security headers
- dependency scanning
- container scanning

## Phase 5: AI Intelligence

Goal: turn tracking data into workforce intelligence.

Infrastructure:

- Python FastAPI AI service
- feature builder worker
- feature store tables
- score snapshot tables
- AI recommendation tables
- scheduled summary jobs

Product:

- employee score
- productivity momentum
- focus quality score
- consistency score
- burnout risk
- attrition risk
- workforce health score
- manager/team health
- daily summaries
- weekly executive summaries
- explainable recommendations

Rules:

- Precompute AI outputs.
- Do not call LLMs on every page load.
- Store explanation factors.
- Version scoring models.
- Keep org-specific AI settings.

## Phase 6: Billing and Usage Metering

Goal: connect product limits, cost controls, and revenue.

Product:

- plans
- subscriptions
- invoices
- payment methods
- seat limits
- feature limits
- usage dashboard
- failed payment handling

Usage meters:

- active employees
- events ingested
- screenshots stored
- reports generated
- AI requests
- integration sync volume

Important technical work:

- billing event handling
- payment webhook idempotency
- plan enforcement middleware
- tenant usage aggregation
- overage policy

## Phase 7: Reports, Payroll, and Integrations

Goal: deepen enterprise workflows after the core data platform is stable.

Reports:

- async report builder
- scheduled reports
- PDF/Excel exports
- S3 export storage
- report notifications

Payroll:

- approved timesheets
- billable hours
- payroll-ready calculations
- export center
- approval audit

Integrations:

- Slack
- Teams
- Google Workspace
- Outlook
- GitHub
- GitLab
- Jira
- ClickUp
- Asana

Integration rules:

- encrypted OAuth tokens
- provider webhooks verified
- sync cursors
- user mapping
- async normalization
- retry and dead-letter handling

## Phase 8: Enterprise Scale

Goal: support very large tenants and regional requirements.

Infrastructure:

- tenant routing by home region
- dedicated DB option
- dedicated ClickHouse option
- read replicas
- regional S3 buckets
- advanced autoscaling
- workload isolation

Product:

- enterprise admin controls
- compliance exports
- data residency settings
- custom retention
- advanced audit reporting
- dedicated customer success metrics

Scale triggers:

- tenant has more than 50,000 employees
- tenant produces disproportionate event volume
- tenant requires strict data residency
- tenant requires dedicated encryption or network isolation
- tenant requires custom retention/compliance commitments

## Build Order Recommendation

Recommended order for the engineering team:

1. Monorepo and CI.
2. Auth, organization, employees, RBAC.
3. Tenant-safe Prisma repositories.
4. Attendance and time tracking.
5. Basic activity ingestion.
6. S3 screenshots metadata, not heavy screenshot UI first.
7. Productivity daily facts.
8. Dashboard read models.
9. Audit and notifications.
10. ClickHouse and analytics API.
11. Kafka and durable event consumers.
12. SSO and enterprise security.
13. AI scoring and recommendations.
14. Billing and metering.
15. Integrations and advanced reports.

## Architecture Review Checklist

Before approving a new feature, ask:

- Does every tenant-owned row include `org_id`?
- Is `org_id` derived from trusted context?
- Is the query bounded and indexed?
- Does the API use cursor pagination for large lists?
- Is the write idempotent if clients retry?
- Does the workflow emit audit events?
- Does it need async processing?
- Does it avoid raw event dashboard queries?
- Does it respect plan limits?
- Does it create unbounded logs, screenshots, AI calls, or reports?
- Does it have tenant-level metrics?

