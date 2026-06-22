# RetainIQ Architecture Docs

Reading order: **overview → foundations → microservices design → phases**. The *Phase* docs track
the actual build sequence; Phase 1 is implemented, Phases 2–3 are planned.

## Overview
- [00 — Scalable SaaS Architecture](./00-overview.md) — vision, planes, scale targets, stack.

## Foundations (design)
- [01 — Implementation Structure](./01-implementation-structure.md)
- [02 — PostgreSQL & Prisma Tenancy](./02-postgres-prisma-tenancy.md)
- [03 — Events, ClickHouse & Analytics](./03-events-clickhouse-analytics.md)
- [04 — Auth, Security, API & Compliance](./04-auth-security-api.md)
- [05 — Infrastructure, CI/CD & Operations](./05-infra-cicd-operations.md)
- [06 — Implementation Roadmap](./06-implementation-roadmap.md)

## Microservices design
- [07 — Microservices Topology](./07-microservices-topology.md)
- [08 — Production Operations & Reliability](./08-production-operations.md)
- [09 — Service Clustering & Concurrency](./09-service-clustering-and-concurrency.md)
- [10 — Microservices Communication](./10-microservices-communication.md)
- [11 — Shared Packages Strategy](./11-shared-packages-strategy.md)
- [12 — Microservices Migration Guide](./12-microservices-migration-guide.md)

## Phases (build sequence)
- [13 — Phase 1: Database-Per-Service & Domain Microservices](./13-phase-1-database-per-service.md) — **implemented** ✅
- [14 — Phase 2: Carve out `operations-service`](./14-phase-2-operations-service.md) — planned
- [15 — Phase 3: Operations Auth & Registration Choreography](./15-phase-3-operations-auth-and-choreography.md) — planned

## Current system at a glance

Five domain-named microservices, each its own image and database (Phase 1):

| Service | Database | Role |
|---|---|---|
| `identity-service` | `retainiq-identity` | auth, org/RBAC, tenant, employee\*, billing |
| `activity-ingestion` | — | high-volume agent telemetry intake |
| `event-processor` | `retainiq-inbox` | idempotent inbox / event dedup |
| `analytics-service` | `retainiq-analytics` | productivity scoring + day-facts |
| `notifications-service` | `retainiq-notifications` | deliveries + recipient read-model |

\* `employee`/`attendance` move to a dedicated `operations-service` + `retainiq-operations` DB in Phase 2.
