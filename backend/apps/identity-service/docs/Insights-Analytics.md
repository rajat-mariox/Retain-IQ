# Insights & Analytics

Four read-heavy surfaces derive workforce intelligence from the **analytics read
model** (productivity/activity facts owned by the monitoring pipeline) combined
with identity-db operational data. Classification is **org-configurable and
applied at read time**, so a rule change takes effect everywhere at once — nothing
is baked into stored aggregates.

Files: `src/modules/insights/*` (`aiInsights` / `timeTracking` features),
`src/modules/hr-analytics/*`, `src/modules/monitoring/*`,
`src/common/productivity/{classify,productivity-settings.service}.ts`,
`src/common/database/analytics-prisma.service.ts`.

## The analytics read model

`AnalyticsReadPrismaService` (`analytics-prisma.service.ts`) is a **read-only**
Prisma client against the analytics database, wired as a singleton in
`DatabaseModule`. Tables consumed here:

- `EmployeeDayFact` — per-employee-per-day `activeSeconds`, `idleSeconds`,
  `productivityScore`, `focusScore`.
- `appUsageDaily` / `websiteUsageDaily` — per-app / per-domain seconds per day.

identity-service never writes these — the monitoring/productivity pipeline does.
Insights only reads and aggregates.

## Productivity classification — classify.ts

`classifyApp(name, rules)` / `classifyDomain(domain, rules)` map usage to
`PRODUCTIVE | NEUTRAL | DISTRACTING` by **substring match** against the org's
lists. Defaults ship in `classify.ts` (`DEFAULT_PRODUCTIVE_APPS` — IDEs,
terminals, design/office/PM tools, local dev tooling; `DEFAULT_DISTRACTING_APPS`
— streaming, games, social). `ProductivitySettingsService.getRules(orgId)`
returns the org's `ProductivitySetting` lists (seeded from the defaults, edited in
the org portal). Because classification runs at read time, "My Time", team
insights, the executive overview, and monitoring all reflect an edit immediately.

## Insights (`src/modules/insights`)

`InsightsService` (`insights.service.ts`) — a 30-day window (`WINDOW_DAYS`):

| Route | Method | Gate |
|---|---|---|
| `GET insights/me` | `me()` | `timeTracking` — the caller's own series, totals, and **momentum** (2nd-half vs 1st-half avg productivity → up/down/stable) |
| `GET insights/team` | `team()` | `aiInsights` + `employee.read` — org-wide per-employee focus/active/productivity (derived heuristics, **not an LLM**) |
| `GET insights/by-group` | | `aiInsights` + `employee.read` — department/team rollup |
| `GET insights/executive` | `executiveOverview` | `aiInsights` + `employee.read` — the exec dashboard |
| `GET/POST insights/productivity-target` | | read `employee.read` / write `employee.write` — org productivity `Goal` |

`productiveSecondsByEmployee` sums only seconds whose app/domain classifies as
`PRODUCTIVE` under the org rules, then productivity % = productive ÷ active
(capped at active). The org-level target is an optional `Goal` with
`metric='productivity'` and no project.

## HR Analytics (`src/modules/hr-analytics`)

`HrAnalyticsService` exposes:

- `overview()` — headcount/composition/lifecycle rollups from identity-db
  (`Employee`, departments, teams, lifecycle stages).
- `talentRisk()` — attrition/burnout risk signals blending attendance, tenure,
  and productivity facts (`GET hr-analytics/…`).

These read the HR domain directly (org-scoped) and are the people-ops counterpart
to the productivity-centric `insights` surfaces.

## Monitoring (`src/modules/monitoring`)

`MonitoringService` governs the surveillance/activity surfaces and the org's
`MonitoringPolicy` (screenshot cadence, retention window):

| Method | Surface |
|---|---|
| `getPolicy` / `updatePolicy` | the org `MonitoringPolicy` |
| `summary` / `presence` | live/aggregate activity presence |
| `apps` / `websites` | per-app / per-domain breakdowns (classified) |
| `sessions` / `timeline` | activity sessions & a per-employee timeline |

`MonitoringPolicy.screenshotRetentionDays` drives the storage auto-purge cron
(see `Storage.md`). Screenshot *reads* are ABAC-scoped by `screenshots.read`.

## Design note: read-time, config-driven, no LLM

Two principles run through this cluster and are worth stating plainly, because the
code is explicit about them:

1. **No LLM.** `insights/team` is labelled "derived heuristics, not an LLM" — the
   "AI" surfaces are deterministic aggregations over facts.
2. **Read-time classification.** Productivity category is never stored on the
   aggregates; it is computed on each read from the org's editable rules, so
   changing a rule reclassifies all history instantly and consistently across
   every surface.
