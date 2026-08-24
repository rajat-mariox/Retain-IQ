# API surface

Every route is under the global prefix **`/v1`** (`main.ts`). Tenant routes carry
`@UseGuards(AuthGuard, TenantGuard, PermissionGuard)`; feature clusters add
`@RequireFeature("…")` at the controller. Bodies/queries validate against
`@retainiq/contracts` via `ZodValidationPipe`. This is a per-module map skimmed
from the controllers; permissions are the `@RequirePermissions(...)` on each
route (see `RBAC-ABAC.md` for the catalog).

## Auth — `/v1/auth` (public / self)

`register` (throttle 5/min), `login`, `refresh`, `logout`, `logout-all`
(`AuthGuard`), `me` (`AuthGuard`), `change-password` (`AuthGuard`),
`forgot-password`, `reset-password`. See `Auth-Sessions.md`.

## Tenant & people

| Controller | Prefix | Feature | Representative routes → permission |
|---|---|---|---|
| tenant | `/v1/org` (+ current-org/members) | — | current org, member list |
| members | `/v1/members` | — | `POST` → `employee.write` |
| rbac | `/v1/rbac` | — | `GET/POST/PATCH/DELETE roles`, `GET permissions`, `GET access`, `POST/DELETE grants` → all `settings.security.manage` |
| employee | `/v1/employees` | — | `GET` list/`:id`/`:id/360`/`org-chart`/`career`/`history` → `employee.read`; `POST`/`PATCH`/`:id/promotion`/`transfer`/`lifecycle` → `employee.write`; `:id/audit` → `audit.read` |
| org-structure | `/v1/org` | — | departments/teams/designations/shifts/requisitions: `GET`→`employee.read`, mutations→`employee.write` |
| holidays | `/v1/holidays` | attendance | `GET` open; `POST/PATCH/DELETE` → `attendance.approve` |

## Time, attendance & leave

| Controller | Prefix | Feature | Notes |
|---|---|---|---|
| attendance | `/v1/attendance` | attendance | check-in/out & breaks & status/me/today (self); policy read/`manage`; corrections & overtime approve → `attendance.approve`; reports/roster/calendar/scores → `attendance.read` |
| leave | `/v1/leave` | leave | requests/balances/cancel (self); decisions & types & comp-off/grant → `attendance.approve`; balances/analytics/export → `attendance.read` |
| timetracking | `/v1/time` | timeTracking | entries/timesheet/submit/mine (self); pending/`:id`/decision/auto-sync → `attendance.approve`; billable-summary → `attendance.read` |

See `Attendance-Leave.md`, `Projects-Timetracking.md`.

## Delivery & payroll

| Controller | Prefix | Feature | Notes |
|---|---|---|---|
| projects | `/v1/org` (projects/tasks/goals) | projects | reads → `project.read`; writes → `project.write` (scoped); task status/description also by assignee |
| clients | `/v1/clients` | projects | `GET`→`project.read`; mutations→`project.write` |
| payroll (cycles) | `/v1/payroll/cycles` | payroll | `GET`→`payroll.read`; create/run/lock/paid→`payroll.approve` |
| payroll (rates) | `/v1/payroll/rates` | payroll | employee/bill rates + settings |
| payroll (invoices) | `/v1/payroll/invoices` | payroll | client invoice lifecycle |
| reports (payroll) | `/v1/payroll` | payroll | dashboard/reports/export |

See `Payroll-Timesheets.md`.

## Analytics & monitoring

| Controller | Prefix | Feature | Notes |
|---|---|---|---|
| insights | `/v1/insights` | timeTracking / aiInsights | `me` (self, timeTracking); `team`/`by-group`/`executive`/`productivity-target` (aiInsights) → `employee.read`, write target → `employee.write` |
| hr-analytics | `/v1/hr-analytics` | recruitment | `overview`, `talent-risk` → `employee.read` |
| monitoring | `/v1/monitoring` | monitoring | summary/presence/apps/websites/sessions/timeline → `employee.read`; `policy` PATCH → `settings.security.manage` |
| org-activity | `/v1/activity` | activityFeed | feed + types → `audit.read` |
| storage | `/v1/storage` | screenshots | usage/screenshots/mine (self); list/employees → `screenshots.read`; delete/purge → `screenshots.delete` |

See `Insights-Analytics.md`, `Storage.md`.

## Workforce-care chain

| Controller | Prefix | Notes |
|---|---|---|
| observation | `/v1/observations` | reads → `observation.read`; mutations & `:id/escalate` → `observation.manage` |
| escalation | `/v1/escalations` | list/rollup/`:id` → `observation.read`; acknowledge/bump/resolve → `observation.manage`; `:id/promote` → `incident.manage` |
| incident | `/v1/incidents` | all → `incident.manage` |

See `Workflow-Engine.md`.

## Hiring, joining & performance

| Controller | Prefix | Feature | Notes |
|---|---|---|---|
| recruitment | `/v1/recruitment` | recruitment | requisitions/pipeline/candidates/applications/interviews/offers/hire: reads `employee.read`, mutations `employee.write` |
| onboarding | `/v1/onboarding` | recruitment | templates/items/journeys/tasks: reads `employee.read`, mutations `employee.write` |
| performance | `/v1/performance` | recruitment | cycles/reviews/ratings/achievements: reads `employee.read`, mutations `employee.write` |

## Platform, billing & ops

| Controller | Prefix | Guard/Feature | Notes |
|---|---|---|---|
| platform-admin (auth) | `/v1/platform/auth` | — | super-admin login/refresh/logout/me |
| admin | `/v1/platform/admin` | `PlatformAuthGuard` | overview/organizations/billing/subscriptions/activity/audit/health/settings |
| public-config | `/v1/config` | public | branding + maintenance state |
| billing | `/v1/billing` | billing | `GET` + `PATCH subscription` → `billing.manage` |
| entitlements | `/v1/entitlements` | — | current plan entitlements (`GET`) |
| reports (jobs) | `/v1/reports/jobs` | — | list/create/download → `attendance.read` |
| health | `/v1/health` | public | `GET` + `GET ready` liveness/readiness probes |

See `Platform-Admin.md`.

## Conventions

- **Feature gates** run before auth (`FeatureFlagGuard`); a gated route returns
  403 with an opaque message when off. **Maintenance mode** returns 503 for all
  tenant routes except `/platform`, `/health`, `/config`.
- **Scoping**: a `@RequirePermissions` gate answers *whether*; the service then
  applies ABAC scope (`AccessScopeService`) to answer *on whose data* — so
  e.g. `attendance.read` on `/attendance/roster` returns a scoped manager only
  their departments' people.
- **Timestamps** are UTC in requests/responses; the client renders viewer-local.
- **Idempotency**: mutating flows that must not double-apply use
  `IdempotencyService` / `IdempotencyRecord`.
