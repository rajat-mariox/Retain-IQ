# Database, Events & Plan API

billing-service owns `billing-db` (`prisma/billing/schema.prisma`, generated client
`@retainiq/database/billing`). This doc is the reference for the data model, the
events billing consumes and emits, and the platform-admin HTTP API (`plan-api.ts`).

## Ownership boundary

`billing-db` holds **no `Organization` table** and **no cross-database FK**
(schema header, lines 1-5): `orgId` is a bare `@db.Uuid`. billing-service is the
sole **writer**. identity-service holds a **read-only** Prisma binding onto the same
database (`identity-service/.../common/database/billing-prisma.service.ts`) and uses
it for org billing pages, seat-limit checks, entitlements, and platform admin
rollups — but never writes.

## Models

### `Plan` (catalog / reference data)

String `@id` (`free` | `basic` | `professional` | `enterprise` for the built-ins).
Key fields (`schema.prisma` lines 33-67):

| Group | Fields | Notes |
|---|---|---|
| Pricing | `pricePerSeat`, `basePrice`, `includedSeats`, `additionalSeatPrice` | USD cents. `total = basePrice + max(0, seats − includedSeats) × additionalSeatPrice`. Legacy flat plans set `basePrice=0, includedSeats=0, additionalSeatPrice=pricePerSeat` |
| Period | `billingPeriod` | `"monthly"` \| `"yearly"` |
| Seat capacity | `seatLimit` (legacy), `minSeats`, `maxSeats`, `allowCustomSeats` | `maxSeats` supersedes `seatLimit`; `null` cap = unlimited |
| Trial policy | `trialEnabled`, `trialDays` | per-plan; drive provisioning trial decision |
| Other | `storageLimitMb` (null=unlimited), `features String[]`, `color`, `sortOrder`, `isActive` | `features` codes back the entitlement layer |

Indexed on `isActive`. Related: `subscriptions`, `planFeatures`.

### `Subscription` (one per org)

`orgId @unique @db.Uuid` — the uniqueness is what makes provisioning idempotent.
(`schema.prisma` lines 69-103.)

- **State**: `status` (`SubscriptionStatus`), `seats` (licensed), `activeSeats`
  (live headcount, ≤ seats — drives MRR).
- **Rate lock**: `lockedBasePrice`, `lockedIncludedSeats`,
  `lockedAdditionalSeatPrice`, `lockedTotalPrice` (nullable; null = pre-migration,
  fall back to live plan). See `Billing-Lifecycle.md` § Rate lock.
- **Period**: `currentPeriodStart`, `currentPeriodEnd`.
- **Trial timestamps**: `trialStartedAt`, `trialEndsAt`, `trialConvertedAt`,
  `trialExpiredAt`, plus `canceledAt`.
- **Other**: `autoRenew` (default true), `billingEmail`.
- Indexes: `status`, `[planId, status]`.

`SubscriptionStatus` enum: `TRIALING`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`,
`CANCELED`, `EXPIRED` (a trial that ended without converting).

### `Invoice`

One per billing period per subscription (`schema.prisma` lines 139-162).
`invoiceNumber @unique` is the idempotency key — its format is
`INV-YYYYMM-<first 8 hex of orgId>` (`main.ts` line 142, `lifecycle.ts` line 90), so
two attempts to bill the same org for the same month collide and the second is
swallowed. Money fields (`subtotal`, `totalAmount`, `amountDue`) are USD cents;
`currency` defaults `"USD"`. `InvoiceStatus`: `DRAFT`, `OPEN`, `PAID`, `VOID`.
Indexes: `[orgId, issuedAt]`, `[status, paidAt]`, `subscriptionId`.

### `PlanFeature` (per-plan quotas)

`@@unique([planId, featureCode])`, `onDelete: Cascade` from `Plan` (lines 110-123).
A row sets a **numeric ceiling** on a feature the plan already grants via
`Plan.features[]` — it does **not** grant the feature (schema comment lines
105-109). `limitValue` null = unmetered; `limitType` is free-form
(`"monthly"|"daily"|"total"|"concurrent"`, app-interpreted). Absence = unlimited.

### `BillingEvent` (append-only activity feed)

`{ id, orgId, type, summary, planId?, amountCents?, createdAt }`, indexed on
`createdAt` (lines 127-137). This is the **durable source of truth** for billing
activity; identity's platform activity feed and audit log read it via the read
binding (e.g. `admin.service.ts` splits `type === "subscription.plan_changed"` into
the "plan" audit category, everything else into "subscription"). Every provisioning,
renewal, dunning, payment-failure, plan/seat change, and trial action writes one.

## Events consumed (from identity, via `STREAMS.domainEvents`)

Dispatched by `handler` in `main.ts` on the shared stream `"retainiq.events"`,
consumer group `billing-service`. See `Architecture.md` for the handler table; the
payloads:

| Event | Payload read | Handler effect |
|---|---|---|
| `organization.created` | `orgId`, `payload.{planId, seats?, billingEmail?}` | provision Subscription (+ first Invoice + `subscription.created` BillingEvent) |
| `organization.headcount` | `orgId`, `payload.activeEmployees` | `activeSeats = min(activeEmployees, seats)` |
| `organization.deleted` | `orgId` (+ `occurredAt`) | → `CANCELED` |
| `organization.suspended` | `orgId` | → `SUSPENDED` |
| `organization.reactivated` | `orgId` (+ `occurredAt`) | `SUSPENDED` → `ACTIVE` if `currentPeriodEnd > now` |

Identity emits `organization.created` from its outbox inside the create-org
transaction (`admin.service.ts` line 465) and `organization.headcount` from its
seat-sync service.

## Events emitted (`BillingEvent` row + optional stream publish)

Every lifecycle action writes a `BillingEvent` (always durable). A **subset** is
also published onto `STREAMS.domainEvents` via `publishDomainEvent` for identity's
`PlanCacheSyncService` to react to (best-effort). `BillingEvent.type` values:

| `type` | Emitted by | Also published to stream? |
|---|---|---|
| `subscription.created` | provisioning (`main.ts` 165) | — (identity picks it up on plan-cache list) |
| `subscription.renewed` | lifecycle renew (`lifecycle.ts` 120) | no |
| `subscription.canceled` | lifecycle (auto-renew off) / org.deleted | no |
| `subscription.suspended` | dunning escalation / org.suspended | no |
| `subscription.reactivated` | org.reactivated (`main.ts` 274) | no |
| `payment.failed` | lifecycle failed charge (`lifecycle.ts` 123) | no |
| `subscription.plan_changed` | admin plan change; trial convert/cancel; trial-expiry sweep | **yes** |
| `subscription.seats_changed` | admin seat change (`plan-api.ts` 246) | **yes** (via plan_changed publish) |
| `subscription.renewal_changed` | admin auto-renew toggle (`plan-api.ts` 257) | no |
| `trial.expired` | trial sweep (`trial.ts` 67) | yes (main.ts republishes plan_changed) |
| `trial.converted` | `convertTrial` | yes |
| `trial.extended` | `extendTrial` | no |
| `trial.canceled` | `cancelTrial` | yes |

Published envelope (`main.ts` line 54): `{ eventId, eventType, schemaVersion:1,
orgId, source:"billing-service", occurredAt, ingestedAt, payload }`. Publishing is
best-effort — a broker failure never fails the DB write (`plan-api.ts` lines 79-84,
270-276).

## Plan-admin HTTP API (`plan-api.ts`)

Fastify on `API_PORT` (3007). **Every** route is behind the `preHandler` hook that
verifies `Authorization: Bearer <token>` with `PLATFORM_JWT_SECRET` and requires
`scope === "platform"` (401 on missing/invalid, 403 on wrong scope). All bodies are
Zod-validated; the first issue message is returned on 400.

### Plans

| Method + path | Behaviour |
|---|---|
| `GET /v1/admin/plans` | list all plans, `orderBy sortOrder asc` |
| `POST /v1/admin/plans` | create; slug-validated `id`; 409 if id exists; 201 on success |
| `PATCH /v1/admin/plans/:id` | partial update (id immutable); 404 if missing |
| `DELETE /v1/admin/plans/:id` | delete; **409 for system plans** (`free/basic/professional/enterprise` — deactivate instead); 409 if any subscription references it; 404 if missing |

`free`, `basic`, `professional`, `enterprise` are load-bearing
(`SYSTEM_PLAN_IDS`, `plan-api.ts` line 12) — `free` is the fallback plan for orgs
without a subscription — and can be edited/deactivated but **never deleted**.

### Per-plan feature limits

| Method + path | Behaviour |
|---|---|
| `GET /v1/admin/plans/:id/features` | list `PlanFeature` rows (404 if plan missing) |
| `PUT /v1/admin/plans/:id/features` | upsert by `(planId, featureCode)`; body `{featureCode, limitValue?, limitType?}` |
| `DELETE /v1/admin/plans/:id/features/:code` | remove one limit; 404 if none |

### Subscription management

`PATCH /v1/admin/subscriptions/:orgId` — change `planId`, `seats`, and/or
`autoRenew` (at least one required). It:

1. Resolves the target plan (404 if unknown, 409 if `!isActive`).
2. Validates seats against the **effective plan's** policy — `allowCustomSeats`,
   `minSeats`, and the cap `maxSeats ?? seatLimit` (`plan-api.ts` lines 187-197).
3. Re-locks the rate from the target plan at the new seat count when plan or seats
   move (lines 216-221).
4. Writes **one `BillingEvent` per changed dimension** — `subscription.plan_changed`
   / `subscription.seats_changed` / `subscription.renewal_changed` — each with a
   targeted summary and the recomputed MRR.
5. Publishes `subscription.plan_changed` to the stream when plan or seats changed.
6. Returns the updated subscription plus an itemised `pricing` breakdown and `mrr`.

New rates take effect **at the next renewal** — no mid-cycle proration.

### Trial actions

| Method + path | Delegates to | On success also |
|---|---|---|
| `POST /v1/admin/subscriptions/:orgId/convert` | `convertTrial` | publish `subscription.plan_changed` |
| `POST /v1/admin/subscriptions/:orgId/extend-trial` | `extendTrial` (body `{days:1–365}`) | returns new `trialEndsAt` |
| `POST /v1/admin/subscriptions/:orgId/cancel-trial` | `cancelTrial` | publish `subscription.plan_changed` |

Each returns `409` with the helper's message when the sub isn't `TRIALING`. See
`Billing-Lifecycle.md` § Trial lifecycle for the underlying transitions.

## Related docs

- `Architecture.md` — service topology, bootstrap, event consumer, ownership boundary.
- `Billing-Lifecycle.md` — the workers that emit these events and the rate-lock/dunning mechanics.
