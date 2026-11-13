# Multi-Tenancy

Every tenant-scoped row in `identity-db` carries an `orgId`, and every query
filters on it. Isolation is enforced at three points: the request context
(`orgId` from the JWT), the `TenantGuard` (the org must still be live), and the
`where: { orgId }` discipline in every service. A suspended or soft-deleted org's
still-valid access tokens are locked out within seconds, not at token expiry.

Files: `src/common/context/request-context.store.ts`,
`src/common/guards/tenant.guard.ts`, `src/common/security/org-status.service.ts`,
`src/common/settings/{maintenance.guard,feature-flag.guard}.ts`.

## Request context — where orgId comes from

The tenant identity flows through an `AsyncLocalStorage` store, seeded by
`RequestContextMiddleware` (requestId/traceId/ip/ua) and completed by `AuthGuard`
(userId/orgId/membershipId/role). Any service reads it via helpers:

```ts
export function requireTenantContext(): RequestContext {
  const context = requestContextStorage.getStore();
  if (!context?.orgId || !context.userId || !context.requestId)
    throw new Error("Tenant context is required for this operation.");
  return context as RequestContext;
}
```

`requireTenantContext()` is the standard first line of a tenant-scoped service
method — it hands back a guaranteed `{ orgId, userId, membershipId, role, … }`.

## TenantGuard — liveness on every request

`AuthGuard` proves *who* you are; `TenantGuard` (`tenant.guard.ts`) proves your
tenant is still *allowed*:

```ts
const liveness = await this.orgStatus.resolve(context.orgId, context.membershipId);
if (!liveness.ok) {
  if (liveness.orgStatus === "SUSPENDED") throw new ForbiddenException("This organization is suspended.");
  throw new ForbiddenException("This account is no longer active.");
}
```

Tenant routes carry `@UseGuards(AuthGuard, TenantGuard, PermissionGuard)`.

### OrgStatusService — the liveness cache

`OrgStatusService` (`org-status.service.ts`) resolves whether the **org,
membership, and user are all ACTIVE right now**, cached in-memory with a **10s
TTL** to keep it off the hot path while bounding how long a just-suspended
session survives:

```ts
export interface OrgLiveness { ok; orgStatus; membershipStatus; userStatus; }
private readonly ttlMs = 10_000;
```

Platform-admin lifecycle actions (suspend/reactivate) call `invalidate()` so the
effect is immediate rather than waiting out the TTL. (In-memory is correct
single-instance; the same seam backs onto Redis for multi-instance — mirroring
the permission cache.)

## The `where: { orgId }` discipline

Tenant isolation is data-level, not schema-level: one `identity-db` holds every
org's rows. Services **always** scope by the caller's `orgId`. Representative
patterns:

```ts
// tenant.service.ts — current org
this.prisma.organization.findFirst({ where: { id: context.orgId, status: "ACTIVE" }, … });

// employee-360.service.ts — target row must be in the caller's org
this.prisma.employee.findFirst({ where: { id: employeeId, orgId: ctx.orgId }, … });

// storage.service.ts — screenshots always org-scoped
const where: Prisma.ScreenshotObjectWhereInput = { orgId: input.orgId };
```

Lookups that take an id from the URL always pair it with `orgId` in the `where`
(e.g. `findFirst({ where: { id, orgId } })`), so a valid id from another tenant
returns *not found* rather than leaking a cross-tenant row.

## Maintenance mode — a hard gate on the API

`MaintenanceGuard` (`maintenance.guard.ts`) is a global guard: when maintenance
is enabled, **every tenant API request is rejected with 503** — a direct API
call is blocked, not just the UI. Super-admin, health, and public-config stay
open so the platform can be turned back on and apps can read the state:

```ts
const ALLOW_PREFIXES = ["/v1/platform", "/v1/health", "/v1/config"];
```

## Feature flags — per-org gating

`@RequireFeature(flag)` routes are gated by `FeatureFlagGuard`
(`feature-flag.guard.ts`), an APP_GUARD that resolves in two layers:

1. **global OFF** → 403 for everyone (emergency kill switch);
2. **global ON** → the caller's org override decides; no override inherits ON.

Because it runs *before* `AuthGuard`, the guard decodes the bearer token itself
purely to learn the asking org (not authentication — a bad token just means "no
org context", and `AuthGuard` rejects it moments later). Feature modules such as
`attendance`, `leave`, `projects`, `timeTracking`, and `payroll` carry
`@RequireFeature("…")` at the controller. See `Realtime.md` for live flag push.
