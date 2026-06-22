# RetainIQ Microservices Communication

This document defines the service boundaries, communication patterns, and API contracts for the microservices architecture.

## Service Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Client Layer                             │
│          (Web, Desktop, Mobile, 3rd Party Webhooks)                │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                    ┌─────▼────────┐
                    │  API Gateway  │
                    │ (NGINX/Kong)  │
                    └─────┬────────┘
         ┌──────────────────┼──────────────────┐
         │                  │                  │
    ┌────▼────┐      ┌──────▼───────┐    ┌────▼────────┐
    │Core API │      │ Ingestion    │    │ Read APIs   │
    │(3001)   │      │ Service      │    │(Analytics)  │
    │         │      │ (3002)       │    │             │
    └────┬────┘      └──────┬───────┘    └─────────────┘
         │                  │
         │ Transactional    │ Stream
         │ Outbox           │ Events
         │                  │
    ┌────▼──────────────────▼────┐
    │   Redis Streams (Broker)   │
    │   Topic: retainiq.events   │
    └────┬──────────────────┬────┘
         │                  │
    ┌────▼────────┐    ┌────▼──────┐
    │event-processor│    │analytics- │
    │ (consumer)  │    │worker      │
    └────┬────────┘    └────┬──────┘
         │                  │
    ┌────▼────────┐    ┌────▼──────┐
    │ Postgres    │    │ClickHouse │
    │ (OLTP)      │    │ (OLAP)    │
    └─────────────┘    └────┬──────┘
                            │
                    ┌───────▼────────┐
                    │notifications-  │
                    │worker (consumer)
                    └────────────────┘
```

## Services & Responsibilities

### 1. **identity-service** (Port 3001)

**Responsibilities:**
- Identity & authentication (JWT, OAuth, SSO, MFA)
- Multi-tenant organization management
- RBAC & authorization policies
- Employee & department lifecycle
- User profiles & preferences
- Integration configurations
- Billing & subscription management
- Audit trail (immutable logs)

**Database:** PostgreSQL (OLTP)

**API Endpoints:**
```
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/tenants/:id
POST   /api/v1/tenants
GET    /api/v1/employees
POST   /api/v1/employees
GET    /api/v1/projects
POST   /api/v1/projects
POST   /api/v1/billing/subscriptions
GET    /api/v1/audit/logs
GET    /health
```

**Service-to-Service Auth:**
- Uses JWT (shared `JWT_ACCESS_SECRET`)
- Validates token in Authorization header
- Trusts activity-ingestion as internal service

**Emits Events:**
```typescript
interface DomainEvent {
  eventId: string;           // UUID
  eventType: string;         // "user.created" | "employee.hired" | ...
  aggregateId: string;       // org_id or user_id
  orgId: string;
  payload: Record<string, any>;
  timestamp: ISO8601;
  version: number;
}
```

Published to `retainiq.events` Redis Stream via **Transactional Outbox**.

---

### 2. **activity-ingestion** (Port 3002)

**Responsibilities:**
- High-volume activity intake from agents
- Event validation & stamping (idempotency keys, timestamps)
- Request rate limiting & backpressure
- Authentication via shared JWT
- Publishes activity events to Redis

**Database:** None (stateless)

**API Endpoints:**
```
POST   /ingest/activity          # Batch activity events
POST   /api/v1/activity/log      # Single event ingestion
POST   /api/v1/screenshots/upload
GET    /health
GET    /metrics
```

**Rate Limiting:**
- Per-tenant rate limit: 10,000 events/min
- Per-org rate limit: 100,000 events/min
- Backpressure: Return 429 when exceeded

**Authentication:**
- Validates JWT from Authorization header
- Uses shared `JWT_ACCESS_SECRET` from identity-service
- Verifies tenant membership in JWT claims

**Event Schema:**
```typescript
interface ActivityEvent {
  eventId: string;           // Client-provided or generated
  orgId: string;
  employeeId: string;
  eventType: "app.usage" | "website.visit" | "idle" | "screenshot" | ...;
  timestamp: ISO8601;
  data: Record<string, any>;
}
```

Published to `retainiq.activity` Redis Stream.

---

### 3. **event-processor** (Background Worker)

**Responsibilities:**
- Consumes events from Redis Streams (durable consumer group)
- Idempotent inbox pattern (deduplication)
- Domain event processing & projections
- Triggers downstream workflows (notifications, analytics)

**Database:** PostgreSQL (writes to `ConsumedEvent` inbox)

**Streams Consumed:**
```
retainiq.events      # From identity-service (domain events)
retainiq.activity    # From activity-ingestion (activity events)
```

**Consumer Group:**
```
Group: "event-processor-group"
Consumer: "event-processor-1", "event-processor-2", ...
```

**Processing:**
1. Read from stream via `XREADGROUP`
2. Check `ConsumedEvent` table for idempotency
3. Process event if not seen before
4. Insert into `ConsumedEvent` (unique constraint prevents duplicates)
5. ACK with `XACK` on success
6. Dead-letter queue on failure

**Example Processing:**
```typescript
// When user.created event received:
// 1. Create audit entry
// 2. Queue welcome email notification
// 3. Initialize user preferences
// 4. Log to ClickHouse
```

---

### 4. **analytics-service** (Background Worker)

**Responsibilities:**
- Consume activity events
- Time-series projections & aggregations
- Dashboard data preparation
- ClickHouse insertions

**Database:** PostgreSQL (reads), ClickHouse (writes)

**Streams Consumed:**
```
retainiq.activity    # Activity events for analytics
```

**Processing:**
1. Consume activity events
2. Aggregate by tenant, employee, hour
3. Batch insert into ClickHouse
4. Update materialized views for dashboards

---

### 5. **notifications-service** (Background Worker)

**Responsibilities:**
- Consume domain events & activity events
- Send email, push, SMS notifications
- Rate limiting per notification type
- Retry with exponential backoff

**Database:** PostgreSQL (reads notification preferences)

**Streams Consumed:**
```
retainiq.events      # Domain events (user.created, etc.)
```

**Notification Types:**
- Email (via SMTP)
- Push notifications (Firebase Cloud Messaging)
- SMS (Twilio)
- In-app inbox

---

## Communication Patterns

### 1. **Service-to-Service (Synchronous)**

**When identity-service needs to call another service:**

❌ **NOT USED in this architecture** — Services don't call each other.

All inter-service communication is **asynchronous via Redis Streams**.

---

### 2. **Transactional Outbox (identity-service → Redis Streams)**

**Pattern:**
```typescript
// In identity-service transaction:
await db.user.create({ ... });
await db.outboxEvent.create({
  eventType: "user.created",
  aggregateId: user.id,
  orgId: user.orgId,
  payload: user,
  status: "PENDING"
});
// Commit transaction

// OutboxRelayService (background process):
// 1. Polls PENDING rows every 5s
// 2. Publishes to Redis Stream
// 3. Marks as PUBLISHED
// 4. Retries FAILED entries with backoff
```

**Guarantees:** At-least-once delivery (duplicates handled by idempotent inbox).

---

### 3. **Durable Consumer Groups (Redis Streams → Workers)**

**Pattern:**
```typescript
// event-processor reads with consumer group:
const results = await redis.xreadgroup(
  "GROUP", "event-processor-group", "event-processor-1",
  "BLOCK", "1000",
  "STREAMS", "retainiq.events", ">"
);

// Process event
// On success: await redis.xack("retainiq.events", "event-processor-group", messageId);
// On failure: message stays pending for redelivery
```

**Guarantees:** 
- Durable: Survives service crashes (messages remain in stream)
- Replayable: Can restart consumer and catch up
- Load-balanced: Multiple consumers process different messages

---

### 4. **Idempotent Inbox (Deduplication)**

**Pattern:**
```typescript
// Before processing event:
const existing = await db.consumedEvent.findUnique({
  where: { eventId_consumerId: { eventId, consumerId: "event-processor" } }
});

if (existing) return; // Already processed

// Process event
await processEvent(event);

// Record consumption
await db.consumedEvent.create({
  eventId,
  consumerId: "event-processor",
  processedAt: now()
});
// Unique constraint (eventId, consumerId) ensures only once
```

**Guarantees:** Exactly-once processing semantics.

---

## API Contracts

### Authentication

All HTTP APIs (identity-service, activity-ingestion) require JWT in Authorization header:

```
Authorization: Bearer <JWT_TOKEN>
```

**JWT Payload (issued by identity-service):**
```json
{
  "sub": "user-123",
  "orgId": "org-456",
  "tenantId": "tenant-456",
  "roles": ["employee", "manager"],
  "iat": 1234567890,
  "exp": 1234571490
}
```

---

### Event Contracts

#### Domain Event (identity-service → Redis Streams)

```typescript
interface OutboxEvent {
  id: string;                      // UUID
  eventType: string;               // e.g., "user.created"
  aggregateId: string;             // Aggregate root ID
  orgId: string;                   // For tenant isolation
  payload: Record<string, any>;    // Event data
  version: number;                 // Aggregate version
  timestamp: ISO8601;
  status: "PENDING" | "PUBLISHED" | "FAILED";
}
```

**Example Events:**
```typescript
{
  eventType: "user.created",
  aggregateId: "user-123",
  payload: { email: "user@company.com", orgId: "org-456" }
}

{
  eventType: "employee.hired",
  aggregateId: "emp-789",
  payload: { name: "John Doe", department: "Engineering" }
}

{
  eventType: "employee.left",
  aggregateId: "emp-789",
  payload: { reason: "resignation" }
}
```

---

#### Activity Event (activity-ingestion → Redis Streams)

```typescript
interface ActivityEvent {
  eventId: string;                 // UUID or client-provided ID (for idempotency)
  orgId: string;
  employeeId: string;
  eventType: "app.usage" | "website.visit" | "idle" | "screenshot.metadata" | ...;
  timestamp: ISO8601;              // Event time
  receivedAt: ISO8601;             // Server receive time
  data: {
    duration?: number;             // milliseconds
    app?: string;                  // App name (for app.usage)
    website?: string;              // URL (for website.visit)
    idle?: boolean;
    metadata?: Record<string, any>;
  };
}
```

---

## Error Handling

### Service Unavailability

**Pattern:** Exponential backoff with jitter

```typescript
// OutboxRelayService:
for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    await publishToRedis(event);
    await markPublished(event);
    return;
  } catch (error) {
    await sleep(backoffMs(attempt));
  }
}
await markFailed(event);
```

---

### Dead Letter Queue

Events that fail after max retries are moved to a dead-letter queue:

```
redis: "retainiq.dlq"
```

Monitored by operations team for manual intervention.

---

## Health Checks

Each service exposes `/health` endpoint:

```
GET /health
{
  "status": "ok",
  "uptime": 3600,
  "checks": {
    "database": "ok",
    "redis": "ok",
    "readiness": "ok"
  }
}
```

---

## Observability

### Logging

Structured JSON logs with fields:
```json
{
  "timestamp": "2025-01-15T10:30:00Z",
  "level": "INFO",
  "service": "identity-service",
  "traceId": "xyz-abc-123",
  "orgId": "org-456",
  "userId": "user-123",
  "message": "User created",
  "duration_ms": 150
}
```

**Aggregated by:** Loki (logs), ELK (audit logs only)

---

### Metrics

Prometheus metrics per service:
```
http_requests_total{service="identity-service", method="POST", status="200"}
http_request_duration_seconds{service="identity-service", endpoint="/api/v1/auth/login"}
redis_stream_lag{consumer_group="event-processor-group"}
event_processing_duration_seconds{event_type="user.created"}
```

Scraped by Prometheus, visualized in Grafana.

---

### Distributed Tracing

OpenTelemetry traces with TraceID propagation:

```
Header: traceparent: 00-trace-id-span-id-01
```

Traces include:
- HTTP requests (identity-service, activity-ingestion)
- Event publishing (Outbox → Redis)
- Event consumption (Redis → workers)
- Database queries

Exported to Jaeger or Honeycomb.

---

## Deployment & Versioning

### Docker Images

Each service has independent image:
```
retainiq/identity-service:v1.2.3
retainiq/activity-ingestion:v1.2.3
retainiq/event-processor:v1.2.3
retainiq/analytics-service:v1.2.3
retainiq/notifications-service:v1.2.3
```

### Kubernetes Rollout

Rolling updates per service:
```bash
kubectl set image deployment/identity-service identity-service=retainiq/identity-service:v1.2.3
```

Zero-downtime deployments with health checks & graceful shutdown.

---

## Roadmap: Future Evolution

1. **gRPC** instead of Redis Streams for sync calls (if needed)
2. **Kafka/MSK** instead of Redis Streams (when replay scale demands it)
3. **Service Mesh** (Istio) for traffic management, security, observability
4. **Schema Registry** (Confluent or custom) for event versioning
5. **CQRS** pattern if query complexity grows
6. **Event Sourcing** for audit-critical domains
