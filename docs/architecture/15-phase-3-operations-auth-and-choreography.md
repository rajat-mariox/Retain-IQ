# Phase 3 — Operations Auth & Registration Choreography

> **Status: planned.** Completes [Phase 2](./14-phase-2-operations-service.md). This is the hard
> part: `operations-service` must authorize requests and the founding employee must be created
> without a cross-database transaction.

## Problem 1 — authorization across services

Authorization today is **deliberately not stateless**. `PermissionGuard` →
`PermissionBundleService.resolve()` loads the membership's role + permissions from the **identity
database** (Redis-cached), and access-token claims are explicitly *not* trusted — so a role change
or revocation takes effect on the next request, not at token expiry.

A standalone `operations-service` cannot read the identity database. Chosen approach:

### Shared Redis permission cache + identity internal fallback

```
operations-service  PermissionGuard
        │
        ▼
   read shared Redis cache key  "perm:{orgId}:{membershipId}"   ← written by identity-service
        │ hit → authorize
        │ miss
        ▼
   GET http://identity-service/internal/permission-bundle?orgId=&membershipId=
        │  (service-to-service auth: signed internal header / mTLS)
        ▼
   identity-service resolves from identity DB, writes the cache, returns the bundle
```

- **identity-service** is the single source of truth and the only writer of the permission cache;
  it exposes a new internal endpoint `GET /internal/permission-bundle`.
- **operations-service** authorizes from the shared cache (warm path, no network hop); on a miss it
  calls identity-service, which populates the cache. Revocation stays effective immediately
  (identity invalidates the cache key on role/membership change — same mechanism as today).
- The cache is shared infrastructure (Redis), **not** a shared database, so the
  database-per-service boundary holds.

Implementation: `@retainiq/nest-core` ships a `PermissionResolver` interface with two impls —
`DbPermissionResolver` (identity-service, reads DB) and `RemotePermissionResolver`
(operations-service, reads Redis + HTTP fallback). `PermissionGuard` depends on the interface.

## Problem 2 — the founding employee (registration choreography)

Today `identity-service.register()` creates org + role + user + **employee** + membership in one
transaction. With `Employee` in the operations DB this is no longer possible. Replace the
synchronous step with event choreography:

```
register() in identity-service  (one identity-DB transaction)
  ├ create Organization, Role(Owner), User, OrganizationMembership(employeeId = null)
  ├ enqueue org.registered           { orgId, ownerUserId, email, firstName, lastName }
  └ enqueue org.member.upserted      { orgId, userId, roleName, permissions, version, status }
        │
        ▼ (broker)
  operations-service consumes org.registered
  └ create founding Employee in operations DB  → enqueue employee.created { employeeId, userId, orgId }
        │
        ▼ (optional back-link)
  identity-service consumes employee.created
  └ set OrganizationMembership.employeeId = employeeId   (eventually consistent)
```

### Key design choice — move the person's name onto `User`

So that `GET /me` and login never depend on operations-service, the user's display name
(`firstName`, `lastName`) moves onto the **`User`** model in the identity DB (it is identity data).
`Employee` keeps its own HR copy. Result:

- `me` reads name from `User` (identity DB) — no cross-service read, immediately consistent.
- `OrganizationMembership.employeeId` becomes a non-critical back-link (or is dropped); membership
  no longer needs the employee relation for `me`.
- The founding employee is created asynchronously; it appears in the employee directory within the
  short propagation window. This is the one **eventually-consistent** behavior change to accept.

### New / changed events

| Event | Producer | Consumer(s) | Purpose |
|---|---|---|---|
| `org.registered` (+ founder name) | identity | operations | trigger founding-employee creation |
| `org.member.upserted` (+ permissions, version) | identity | notifications, (operations cache warm) | recipient + permission projections |
| `employee.created` | operations | identity (back-link), analytics | employee exists; link membership |

`org.member.upserted` is enriched with the permission list + version so downstream projections
(and any future local-read-model auth) have what they need.

## Failure & consistency notes

- **At-least-once + idempotent**: operations creates the founding employee idempotently keyed on
  `(orgId, userId)`; redelivery is a no-op.
- **Lost/delayed events**: the org and the owner login work immediately (name on `User`); only the
  employee directory row lags. A reconciliation job can re-emit `org.registered` for orgs with no
  founding employee after N minutes.
- **Permission cache miss storm**: the identity internal endpoint is cheap and cache-backed; set a
  short negative-cache TTL for unknown memberships to fail closed.

## Deliverables checklist

- [ ] `firstName`/`lastName` added to identity `User` (+ migration); `me`/register updated
- [ ] `org.registered` payload carries founder name; `org.member.upserted` carries permissions+version
- [ ] `operations-service` consumes `org.registered` → creates founding Employee → emits `employee.created`
- [ ] identity `/internal/permission-bundle` endpoint + `PermissionResolver` interface (DB vs remote impls)
- [ ] operations-service `PermissionGuard` via shared Redis cache + identity fallback
- [ ] (optional) identity consumes `employee.created` to back-link `membership.employeeId`
- [ ] Build/lint/typecheck/test green; end-to-end register → employee-appears verified
