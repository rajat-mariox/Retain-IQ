# Platform Admin (super-admin)

A parallel authentication stack and control surface for RetainIQ operators,
separate from tenant auth. Super-admins are **not** org members — they have their
own identities, sessions, JWT secret, and denylist, and their routes are gated by
`PlatformAuthGuard` rather than the tenant `AuthGuard`/`PermissionGuard`.

Files: `src/modules/platform-admin/*`.

## Module wiring

`PlatformAdminModule` (`platform-admin.module.ts`) registers three controllers
and a **platform-scoped denylist** kept apart from the org one:

```ts
provide: PLATFORM_DENYLIST,
useFactory: () => new TokenDenylist(redis, config.PLATFORM_ACCESS_TTL_SECONDS), // 8h
```

The org denylist (`SecurityModule`) uses `ACCESS_TOKEN_TTL_SECONDS` (15m); a
logged-out admin token stays revoked for its full 8h lifetime.

| Controller | Prefix | Guard |
|---|---|---|
| `PlatformAdminController` | `/v1/platform/auth` | none (auth endpoints) |
| `AdminController` | `/v1/platform/admin` | `PlatformAuthGuard` (class-level) |
| `PublicConfigController` | `/v1/config` | public (branding/maintenance state) |

## Auth — a separate JWT scope

`PlatformAuthGuard` (`platform-auth.guard.ts`) verifies a Bearer JWT signed with
the **platform secret** via `PlatformTokenService.verify`, and **rejects org
tokens** (wrong secret/scope) and revoked tokens. On success it attaches
`request.platformAdmin = { id, role, name }`, exposed to handlers via the
`@CurrentAdmin` param decorator.

`PlatformAdminService` (`platform-admin.service.ts`) owns the auth flow —
`login`, `refresh`, `logout`, `requestPasswordReset`, `resetPassword`, `me` —
backed by `PlatformAdmin` and `PlatformAdminSession` tables and `PlatformRole`.
`onModuleInit` seeds the initial super-admin (`admin@retainiq.com`).

`/v1/platform/auth`: `POST login | refresh | logout | forgot-password |
reset-password`, `GET me`.

## Control surface — AdminService

`AdminService` (`admin.service.ts`) is the live reporting/administration backend.
Routes under `/v1/platform/admin` (all `PlatformAuthGuard`):

| Route | Backing method | Purpose |
|---|---|---|
| `GET overview` | `overview` | platform KPIs |
| `GET organizations` / `POST organizations` | `organizations` / `createOrganization` | list / provision an org |
| `GET organizations/:id` | `organizationDetail` | per-org detail incl. effective pricing, headcount rollups (attendance/billing) |
| `PATCH organizations/:id` | `updateOrganization` | edit org |
| `POST organizations/:id/{suspend,activate}` | `setOrganizationStatus` | lifecycle — flips `OrgStatus`, invalidates the liveness cache so tenant tokens lock out within seconds |
| `GET/PATCH organizations/:id/attendance-policy` | `getAttendancePolicy` / `setAttendancePolicy` | per-org attendance policy |
| `GET/PATCH organizations/:id/features` | `orgFeatures` / `setOrgFeature` | per-org feature-flag overrides |
| `GET features/:feature/organizations` | `featureMatrix` | which orgs have a feature |
| `GET growth | usage | usage-analytics` | `usage` | adoption/DAU/MAU trends |
| `GET billing | subscriptions | plans/:planId/usage` | `getBilling` / `subscriptions` / `planUsage` | revenue & plan usage (reads `billing-db`) |
| `GET activity | activity/filters` | `activity` / `activityFilters` | cross-org activity feed (`PlatformEvent`) |
| `GET audit` | `auditLogs` | compliance log (merges login sessions + org + billing events) |
| `GET health` | | live service/db/queue probes |
| `GET customer-success` | | account-health surface |
| `GET/PATCH settings` | `updateSettings` | branding, global notification, feature flags, maintenance mode (`PlatformSetting`) |

## Platform settings & feature flags

`PlatformSettingsService` (`src/common/settings`) is the store behind the tenant
guards described in `Multi-Tenancy.md`:

- **Feature flags** — global on/off plus per-org `OrgFeatureFlag` overrides,
  enforced by `FeatureFlagGuard` on `@RequireFeature` routes. A flag flip is
  pushed live to org clients over SSE (see `Realtime.md`).
- **Maintenance mode** — `MaintenanceGuard` returns 503 platform-wide (except
  `/platform`, `/health`, `/config`).
- **Branding & global notifications** — read by tenants via the public
  `/v1/config` endpoint (`PublicConfigController`), so apps can render the banner
  and branding without authenticating.

Editing settings publishes realtime updates (`RealtimePublisher`, provided in
this module) so live banners/branding/nav-gating update without a reload.
