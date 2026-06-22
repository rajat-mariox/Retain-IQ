# Events, ClickHouse, and Analytics Design

RetainIQ will generate far more event data than transactional data. This design keeps ingestion cheap, dashboards fast, and AI features reliable.

## 1. Data Flow

```text
Desktop Agent / Web App / Mobile / Integrations
        |
Ingestion API
        |
Validate, authenticate, rate-limit, dedupe
        |
Kafka
        |
Consumers
        +--> ClickHouse raw event writer
        +--> Real-time Redis status updater
        +--> Attendance correlator
        +--> Productivity aggregator
        +--> Screenshot metadata processor
        +--> AI feature builder
        +--> Audit writer
        |
ClickHouse facts + PostgreSQL snapshots + S3 files
```

The UI should read from:

- PostgreSQL for operational data.
- ClickHouse aggregate/fact tables for dashboards.
- Redis for live presence and very hot counters.
- S3 for generated exports and screenshots.

## 2. Base Event Contract

All Kafka events must share this envelope:

```json
{
  "event_id": "uuid",
  "event_type": "activity.app.used",
  "schema_version": 1,
  "org_id": "uuid",
  "employee_id": "uuid",
  "actor_user_id": "uuid",
  "source": "desktop-agent",
  "source_event_id": "agent-local-id",
  "occurred_at": "2026-06-19T09:15:00.000Z",
  "ingested_at": "2026-06-19T09:15:02.100Z",
  "request_id": "uuid",
  "trace_id": "uuid",
  "payload": {}
}
```

Required fields:

- `event_id`
- `event_type`
- `schema_version`
- `org_id`
- `occurred_at`
- `ingested_at`
- `source`

For employee-specific activity, `employee_id` is required.

## 3. Kafka Topics

| Topic | Purpose | Partition Key |
| --- | --- | --- |
| `activity.events.v1` | app, website, idle, focus, screenshot metadata | `org_id:employee_id` |
| `attendance.events.v1` | check-in, checkout, leave, shift events | `org_id:employee_id` |
| `project.events.v1` | task/project changes | `org_id:project_id` |
| `timesheet.events.v1` | timesheet submit/approve/reject | `org_id:employee_id` |
| `integration.events.v1` | normalized provider sync/webhook data | `org_id:provider:connection_id` |
| `billing.events.v1` | subscription, invoice, usage meter events | `org_id` |
| `notification.events.v1` | notification intents | `org_id:user_id` |
| `audit.events.v1` | audit events | `org_id` |
| `ai.features.v1` | computed feature updates | `org_id:employee_id` |
| `ai.recommendations.v1` | recommendation outputs | `org_id:employee_id` |

Do not partition activity topics by `org_id` alone. A single enterprise tenant can overload one partition.

## 4. Event Types

Activity:

```text
activity.session.started
activity.session.ended
activity.app.used
activity.website.visited
activity.idle.started
activity.idle.ended
activity.break.started
activity.break.ended
activity.screenshot.captured
activity.focus.block.completed
activity.context_switch.recorded
```

Attendance:

```text
attendance.checked_in
attendance.checked_out
attendance.auto_checked_out
attendance.regularization.requested
attendance.regularization.approved
attendance.leave.requested
attendance.leave.approved
attendance.leave.rejected
attendance.shift.assigned
```

Productivity and AI:

```text
productivity.score.updated
productivity.anomaly.detected
ai.feature.updated
ai.burnout_risk.updated
ai.attrition_risk.updated
ai.recommendation.created
ai.summary.generated
```

System:

```text
audit.event.created
notification.intent.created
billing.subscription.updated
integration.sync.completed
integration.sync.failed
```

## 5. Ingestion API

Use a dedicated ingestion service before scale becomes painful.

Endpoint:

```text
POST /v1/ingest/events
```

Request:

```json
{
  "device_id": "uuid",
  "agent_version": "1.4.2",
  "events": [
    {
      "source_event_id": "local-123",
      "event_type": "activity.app.used",
      "occurred_at": "2026-06-19T09:15:00Z",
      "payload": {
        "app_name": "VS Code",
        "window_title_hash": "sha256",
        "duration_seconds": 60
      }
    }
  ]
}
```

Rules:

- Accept batches, not only single events.
- Limit payload size.
- Validate schema by `event_type` and `schema_version`.
- Deduplicate by `(org_id, employee_id, device_id, source_event_id)`.
- Return per-event acceptance status.
- Compress requests from agents.
- Queue accepted events quickly; do not perform analytics in request time.

Response:

```json
{
  "accepted": 98,
  "duplicate": 2,
  "rejected": [],
  "server_time": "2026-06-19T09:15:03Z"
}
```

## 6. ClickHouse Raw Tables

Raw activity table:

```sql
CREATE TABLE activity_events_raw
(
  event_id UUID,
  org_id UUID,
  employee_id UUID,
  device_id UUID,
  event_type LowCardinality(String),
  source LowCardinality(String),
  source_event_id String,
  occurred_at DateTime64(3, 'UTC'),
  ingested_at DateTime64(3, 'UTC'),
  event_date Date MATERIALIZED toDate(occurred_at),
  app_name LowCardinality(String),
  domain String,
  duration_seconds UInt32,
  payload_json String,
  schema_version UInt16
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (org_id, employee_id, occurred_at, event_type)
TTL event_date + INTERVAL 180 DAY
SETTINGS index_granularity = 8192;
```

Notes:

- Keep raw payload as JSON only for replay/debug windows.
- Extract common dimensions into typed columns.
- Use TTL according to plan and compliance policy.

## 7. Fact Tables

Employee daily fact:

```sql
CREATE TABLE employee_day_fact
(
  org_id UUID,
  employee_id UUID,
  fact_date Date,
  department_id UUID,
  team_id UUID,
  active_seconds UInt32,
  idle_seconds UInt32,
  break_seconds UInt32,
  meeting_seconds UInt32,
  productive_seconds UInt32,
  unproductive_seconds UInt32,
  focus_seconds UInt32,
  app_switch_count UInt32,
  website_switch_count UInt32,
  screenshot_count UInt32,
  productivity_score Float32,
  focus_score Float32,
  utilization_score Float32,
  consistency_score Float32,
  burnout_score Float32,
  updated_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(fact_date)
ORDER BY (org_id, employee_id, fact_date);
```

Team daily fact:

```sql
CREATE TABLE team_day_fact
(
  org_id UUID,
  team_id UUID,
  fact_date Date,
  employee_count UInt32,
  active_employee_count UInt32,
  active_seconds UInt64,
  productive_seconds UInt64,
  idle_seconds UInt64,
  focus_seconds UInt64,
  avg_productivity_score Float32,
  avg_focus_score Float32,
  avg_utilization_score Float32,
  burnout_risk_count UInt32,
  attrition_risk_count UInt32,
  updated_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(fact_date)
ORDER BY (org_id, team_id, fact_date);
```

Organization daily fact:

```sql
CREATE TABLE org_day_fact
(
  org_id UUID,
  fact_date Date,
  employee_count UInt32,
  active_employee_count UInt32,
  attendance_rate Float32,
  avg_productivity_score Float32,
  avg_attendance_score Float32,
  avg_focus_score Float32,
  workforce_health_score Float32,
  burnout_risk_count UInt32,
  attrition_risk_count UInt32,
  updated_at DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(fact_date)
ORDER BY (org_id, fact_date);
```

## 8. Materialized Views

Use materialized views for simple aggregates. Use workers for complex score calculations.

Example app usage aggregate:

```sql
CREATE MATERIALIZED VIEW app_usage_hourly_mv
TO app_usage_hour_fact
AS
SELECT
  org_id,
  employee_id,
  toStartOfHour(occurred_at) AS hour,
  app_name,
  sum(duration_seconds) AS usage_seconds,
  count() AS event_count
FROM activity_events_raw
WHERE event_type = 'activity.app.used'
GROUP BY org_id, employee_id, hour, app_name;
```

Use workers when logic requires:

- org-specific app classification
- permission-aware calculations
- AI feature generation
- complex state transitions

## 9. Dashboard Query Rules

Dashboard APIs should query:

- `org_day_fact`
- `department_day_fact`
- `team_day_fact`
- `employee_day_fact`
- score snapshots
- Redis live status

They should not query:

- raw activity events
- screenshot object listings
- PostgreSQL employee rows in a loop

Example:

```sql
SELECT
  fact_date,
  avg_productivity_score,
  avg_focus_score,
  workforce_health_score
FROM org_day_fact
WHERE org_id = {org_id:UUID}
  AND fact_date >= today() - 30
ORDER BY fact_date;
```

## 10. Data Retention

Suggested defaults:

| Data | Default Retention |
| --- | --- |
| Raw activity events | 90-180 days |
| Hourly facts | 13 months |
| Daily facts | 3-7 years depending plan |
| Screenshots | 30-180 days depending plan |
| Audit logs | 3-7 years |
| Report exports | 30-90 days |
| AI explanations | 13-36 months |

Retention must be configurable per organization for enterprise plans.

## 11. Replay and Backfill

Design for replay:

- Kafka retention handles short replay windows.
- S3 archive can hold compressed raw events for enterprise replay if required.
- Workers should support date-range backfills by `org_id`.
- Backfills must run with rate limits to avoid hurting live traffic.

Backfill job input:

```json
{
  "org_id": "uuid",
  "job_type": "recompute_employee_day_fact",
  "from_date": "2026-06-01",
  "to_date": "2026-06-19",
  "employee_ids": []
}
```

## 12. Analytics API

Create an `analytics-api` when ClickHouse queries become important enough to isolate.

Responsibilities:

- enforce tenant permissions
- validate query windows
- query facts only
- cache common dashboards
- expose stable dashboard DTOs
- protect ClickHouse from unbounded scans

Endpoint examples:

```text
GET /v1/analytics/org/overview?from=2026-06-01&to=2026-06-19
GET /v1/analytics/teams/:teamId/productivity
GET /v1/analytics/employees/:employeeId/timeline
GET /v1/analytics/risks/burnout
```

Every endpoint must have:

- max date range
- max result size
- permission check
- query timeout
- cache policy

