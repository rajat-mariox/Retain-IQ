# Observation → Escalation → Incident — Workflow Implementation Plan

## Goal
Build the missing "action spine" of RetainIQ: today the AI only detects an issue
and fires a notification. This plan turns that into a tracked, accountable flow:

```
AI/Manager detects  →  Observation  →  (escalate)  →  Escalation  →  (promote if serious)  →  Incident
                          │ acknowledge / resolve        │ resolve at level                     │ investigate → resolve → close
                          └──────────────── every step recorded on a timeline, audit-logged ────┘
```

Three linked entities (Observation, Escalation, Incident), each with its own
lifecycle, severity, assignee, comments, evidence and resolution notes. Sources:
**AI sweeps** (auto) **and Manager/HR** (manual). Built in 4 shippable phases.

## Design decisions (locked with the user)
- **3 linked entities**, not one unified case — clean audit trail, per-stage lifecycle.
- **AI + Manual** — AI sweeps auto-create Observations; managers/HR can also raise one.
- **Full chain, phased** — P1 Observation, P2 Escalation, P3 Incident, P4 rollup views.

## What we reuse (no reinvention)
- **Outbox events** (`OutboxService.enqueue`) — the exact mechanism `insight-alerts.service.ts`
  already uses to emit `productivity.drop` / `ai.recommendation`. We add new event
  types that fan out to notifications (in-app + email) AND (P1+) create records.
- **`ApprovalService.approvableEmployeeIds()` / `canApprove()`** — the reach engine that
  already answers "which employees does this manager own?". This is exactly how an
  Observation routes to the right manager, and how an Escalation finds the next level up.
- **`AccessScopeService`** — dept/team/self scoping for all list queries (RBAC/ABAC),
  same pattern as attendance reports.
- **Notifications rules** (`notifications-service/src/rules.ts`) — add `observation.*`,
  `escalation.*`, `incident.*` rules; the whole dispatch/SMTP/quiet-hours path is reused.
- **AuditEvent** — every state transition is audit-logged, same as employee lifecycle.
- **Attachment/presign pattern** (`employee-documents.service.ts`) — for Evidence uploads.
- **Migration workflow** — prisma generate → write SQL → apply to live DB → record in
  `_prisma_migrations` (as done all session for half-day/attachment/report-schedule/work-model).

## New RBAC permissions (add to `packages/authz/src/index.ts`)
```
observationRead:    "observation.read"    // see observations in your reach
observationManage:  "observation.manage"  // create/acknowledge/escalate/resolve
incidentManage:     "incident.manage"     // open/investigate/close incidents (HR/senior)
```
- `observationRead` + `observationManage` → added to `managerPermissions` (managers run this).
- `incidentManage` → Owner-only by default (seeded via `allPermissions`); an admin can
  grant it to an HR role. Escalation actions are gated by `observationManage` (the
  manager who owns the observation escalates it) + the reach engine.
- Owner gets everything via `allPermissions` automatically.

---

## PHASE 1 — Observation layer + AI hook + manual raise + manager UI

### Schema (`prisma/identity/schema.prisma`)
```prisma
enum ObservationSource   { AI  MANUAL }
enum ObservationType     { PRODUCTIVITY_DROP  BURNOUT_RISK  LOW_ENGAGEMENT
                           ATTENDANCE_ANOMALY  LATE_PATTERN  BEHAVIOUR  OTHER }
enum Severity            { LOW  MEDIUM  HIGH  CRITICAL }
enum ObservationStatus   { OPEN  ACKNOWLEDGED  ESCALATED  RESOLVED  DISMISSED }

model Observation {
  id             String            @id @default(uuid()) @db.Uuid
  orgId          String            @db.Uuid
  employeeId     String            @db.Uuid          // who it's about
  source         ObservationSource
  type           ObservationType
  severity       Severity          @default(MEDIUM)
  status         ObservationStatus @default(OPEN)
  title          String
  detail         String?                             // human/AI description
  metricJson     Json?                               // the numbers behind it (current/previous/threshold)
  assignedTo     String?           @db.Uuid          // the manager it routed to (userId)
  createdBy      String?           @db.Uuid          // manual: raiser userId; AI: null
  dedupeKey      String            @unique           // AI stable key so a sweep can't double-create
  acknowledgedAt DateTime?
  resolvedAt     DateTime?
  resolutionNote String?
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  org      Organization           @relation(fields: [orgId], references: [id])
  events   ObservationEvent[]                        // the timeline
  comments ObservationComment[]
  evidence ObservationEvidence[]
  escalation Escalation?                             // set once escalated (P2)

  @@index([orgId, status])
  @@index([orgId, employeeId])
  @@index([orgId, assignedTo, status])
}

model ObservationEvent {                             // immutable timeline row
  id            String   @id @default(uuid()) @db.Uuid
  orgId         String   @db.Uuid
  observationId String   @db.Uuid
  kind          String                               // CREATED | ACKNOWLEDGED | COMMENTED | ESCALATED | RESOLVED | DISMISSED
  actorUserId   String?  @db.Uuid
  note          String?
  createdAt     DateTime @default(now())
  observation Observation @relation(fields: [observationId], references: [id], onDelete: Cascade)
  @@index([observationId])
}

model ObservationComment {
  id            String   @id @default(uuid()) @db.Uuid
  orgId         String   @db.Uuid
  observationId String   @db.Uuid
  authorUserId  String   @db.Uuid
  body          String
  createdAt     DateTime @default(now())
  observation Observation @relation(fields: [observationId], references: [id], onDelete: Cascade)
  @@index([observationId])
}

model ObservationEvidence {                          // S3/MinIO presign, like EmployeeDocument
  id            String   @id @default(uuid()) @db.Uuid
  orgId         String   @db.Uuid
  observationId String   @db.Uuid
  fileName      String
  key           String   @unique
  sizeBytes     BigInt
  contentType   String   @default("application/octet-stream")
  uploadedBy    String?  @db.Uuid
  createdAt     DateTime @default(now())
  observation Observation @relation(fields: [observationId], references: [id], onDelete: Cascade)
  @@index([orgId, observationId])
}
```
Migration additive; apply to live DB + record in `_prisma_migrations`.

### Backend (`modules/observation/`)
- `observation.service.ts`:
  - `createFromAi({orgId, employeeId, type, severity, title, detail, metric, dedupeKey})`
    — idempotent on `dedupeKey`; routes `assignedTo` = the owning manager via the
    reach engine (find who manages this employee); writes CREATED event; enqueues
    `observation.created` outbox event → notifies the assigned manager.
  - `createManual({employeeId, type, severity, title, detail})` — caller = createdBy;
    same routing + event.
  - `list({status?, severity?, employeeId?, mine?})` — scoped to caller reach
    (`approvableEmployeeIds()` / AccessScope); `mine` = assignedTo === caller.
  - `get(id)` — full detail + timeline + comments + evidence (access-checked).
  - `acknowledge(id, note?)`, `resolve(id, note)`, `dismiss(id, note)` — state
    transitions (guarded: only OPEN→ACKNOWLEDGED, →RESOLVED/DISMISSED), each writes
    a timeline event + audit log + a status notification.
  - `comment(id, body)` — append comment + COMMENTED event.
  - Evidence create-upload / list / delete — copy `employee-documents.service.ts` verbatim.
- `observation.controller.ts` — routes under `/observation`:
  `GET /` (list), `GET /:id`, `POST /` (manual raise), `POST /:id/acknowledge`,
  `POST /:id/resolve`, `POST /:id/dismiss`, `POST /:id/comments`,
  `POST /:id/evidence` + `GET /:id/evidence` + `POST /:id/evidence/:eid/delete`.
  Gated by `observationRead` (read) / `observationManage` (mutations) + reach checks.
- `observation.module.ts` — wire service+controller; import ApprovalModule (global), Outbox, S3.

### AI hook (extend `insights/insight-alerts.service.ts`)
The existing cron already computes drops/burnout/low-engagement and emits notification
events. Change each detection to **also** call `observationService.createFromAi(...)`
with a stable `dedupeKey` (`prod-drop:<empId>:<isoWeek>` etc.). The notification still
fires (via the observation.created rule), but now there's a tracked record behind it.
Attendance anomalies: same hook from `attendance-alerts.service.ts` (missed-checkin
pattern → `ATTENDANCE_ANOMALY` observation, thresholded so it's a *pattern*, not one day).

### Notifications (`notifications-service/src/rules.ts`)
- `observation.created` → audience `requester` (the assigned manager via `requesterUserId`),
  category ATTENDANCE/SYSTEM, IN_APP+EMAIL, "New observation: <title> for <employee>".
- `observation.resolved` / `observation.dismissed` → notify the raiser/manager.

### Frontend (org-web)
- New page `/observations` + `ObservationsWorkspace.tsx`:
  - Summary tiles: Open · Acknowledged · High/Critical · Mine.
  - Filterable table (status/severity/employee), most-severe-first, Risk/Severity pill,
    source badge (AI/Manual), assigned-to.
  - Row → detail drawer/page: header (employee, type, severity, status), the metric
    behind it, **timeline** (ObservationEvent list), **comments** thread, **evidence**
    chips (presigned view links, like leave attachments), and action buttons —
    **Acknowledge / Add comment / Attach evidence / Resolve / Dismiss / Escalate (P2)**.
  - "Raise observation" button → modal (pick employee within reach, type, severity, note).
- BFF routes under `app/api/observations/*` (proxy pattern, like attendance).
- Nav entry (role-gated on `observation.read`).

**P1 verify:** trigger an AI sweep (or manual raise) → observation appears in the
assigned manager's queue + notification in Mailpit; acknowledge/comment/resolve move
it through states with timeline entries; evidence uploads land in MinIO.

---

## PHASE 2 — Escalation flow (matrix + timeline + severity-based)

### Schema
```prisma
enum EscalationStatus { PENDING  ACKNOWLEDGED  RESOLVED  PROMOTED }  // PROMOTED = became an Incident

model Escalation {
  id             String           @id @default(uuid()) @db.Uuid
  orgId          String           @db.Uuid
  observationId  String           @unique @db.Uuid   // 1 observation → its escalation
  employeeId     String           @db.Uuid
  severity       Severity
  level          Int              @default(1)         // 1 = manager, 2 = dept head, 3 = HR/Owner
  status         EscalationStatus @default(PENDING)
  escalatedBy    String?          @db.Uuid            // who escalated (null = auto/time-based)
  assignedTo     String?          @db.Uuid            // the level-N authority (userId)
  reason         String?
  dueAt          DateTime?                            // SLA for this level (severity-based)
  resolvedAt     DateTime?
  resolutionNote String?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  observation Observation        @relation(fields: [observationId], references: [id])
  events      EscalationEvent[]
  incident    Incident?                               // set if promoted (P3)
  @@index([orgId, status])
  @@index([orgId, assignedTo, status])
}
model EscalationEvent { … }   // CREATED | REASSIGNED | ACKNOWLEDGED | RESOLVED | PROMOTED, actor, note, level
```

### Escalation matrix (severity → level path + SLA)
A small config (code-default, later DB-backed `EscalationPolicy` per org):
- LOW → level 1 only, no auto-escalate.
- MEDIUM → L1 (manager), auto-bump to L2 after 3 days unacknowledged.
- HIGH → L1→L2 after 1 day; L2→L3 after 1 day.
- CRITICAL → starts at L2, →L3 after 4h; notifies Owner immediately.
Level→authority resolution reuses the reach engine: L1 = the observation's assigned
manager; L2 = that manager's manager / dept-head; L3 = Owner or an `incident.manage` holder.

### Backend (`modules/escalation/` or fold into observation module)
- `escalation.service.ts`: `escalate(observationId, {reason, severityOverride?})` — creates
  Escalation at the severity's starting level, sets `assignedTo`, `dueAt`; flips the
  observation to ESCALATED; writes timeline + audit; enqueues `escalation.created`.
  `acknowledge`, `reassign(level±)`, `resolve(note)`, `promoteToIncident()` (P3 link).
- A `@Cron` **SLA sweep** — finds PENDING escalations past `dueAt`, bumps to next level,
  re-notifies (severity-based auto-escalation). Copy the `report-schedule` cron pattern.
- Routes: `POST /observation/:id/escalate`, `GET /escalations` (pending/history, scoped),
  `GET /escalations/:id`, `POST /escalations/:id/acknowledge|reassign|resolve`.

### Notifications
`escalation.created` (→ assigned authority), `escalation.reassigned` (→ new level),
`escalation.resolved`. CRITICAL also notifies the Owner.

### Frontend
- `/observations` detail gets an **Escalate** action (reason modal).
- New **Escalations** view (tab on the workspace): Pending escalations (my queue),
  Escalation history, each row shows level, SLA countdown (`dueAt`), severity.
- Detail: the escalation **timeline** (level changes over time), acknowledge/reassign/
  resolve/**promote to incident** actions.

**P2 verify:** escalate an observation → lands in the next authority's Pending queue +
notification; let an SLA lapse (or invoke the sweep) → auto-bumps a level and re-notifies;
resolve closes it and updates the parent observation.

---

## PHASE 3 — Incident module (formal case + investigation)

### Schema
```prisma
enum IncidentCategory { ATTENDANCE  PRODUCTIVITY  BEHAVIOUR  SECURITY  COMPLIANCE }
enum IncidentStatus   { OPEN  INVESTIGATING  RESOLVED  CLOSED }

model Incident {
  id             String           @id @default(uuid()) @db.Uuid
  orgId          String           @db.Uuid
  reference      String           @unique             // human ref e.g. INC-2026-0001
  employeeId     String?          @db.Uuid            // may be org-level, not person-specific
  escalationId   String?          @unique @db.Uuid    // set when promoted from an escalation
  category       IncidentCategory
  severity       Severity
  status         IncidentStatus   @default(OPEN)
  title          String
  summary        String?
  assignedTo     String?          @db.Uuid            // investigator (HR/senior)
  openedBy       String?          @db.Uuid
  investigationNote String?
  resolutionNote String?
  resolvedAt     DateTime?
  closedAt       DateTime?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  escalation Escalation?          @relation(fields: [escalationId], references: [id])
  events     IncidentEvent[]
  comments   IncidentComment[]
  evidence   IncidentEvidence[]   // reuse the presign pattern
  @@index([orgId, status])
  @@index([orgId, category, status])
}
model IncidentEvent { … }   // OPENED | INVESTIGATING | COMMENTED | EVIDENCE_ADDED | RESOLVED | CLOSED
```
`reference` generated per-org sequential (INC-YYYY-NNNN).

### Backend (`modules/incident/`)
- `incident.service.ts`: `openFromEscalation(escalationId, {category})` (links back, flips
  escalation to PROMOTED); `openManual({...})`; `startInvestigation`, `comment`,
  evidence upload, `resolve(note)`, `close(note)`. Gated by `incidentManage`.
- Routes under `/incidents`: list (by category/status, scoped), detail, open (from
  escalation or manual), investigate/resolve/close, comments, evidence.

### Notifications
`incident.opened` (→ investigator + Owner), `incident.resolved`, `incident.closed`.

### Frontend
- New page `/incidents` + `IncidentsWorkspace.tsx`: category-filtered list, status pills,
  reference numbers; detail with investigation timeline, comments, evidence, and
  Investigate/Resolve/Close actions.
- Escalation detail's **Promote to incident** wires here.

**P3 verify:** promote an escalation → incident opens with a reference, linked back to
the escalation (now PROMOTED); investigate → resolve → close moves it through states with
timeline; manual incident open works; evidence in MinIO.

---

## PHASE 4 — Rollup views (this is where many other "NOT STARTED" items get filled)

Once the chain exists, these become **views over the same data** (little new backend):
- **Employee profile** → Escalation history + Observation history tabs (fills two profile gaps).
- **Team Management** → Team observations + Team escalations (scoped list, reuse reach).
- **Department Management** → Department escalations.
- **HR Workspace** → Employee cases (observations+incidents for a person), Policy
  violations (BEHAVIOUR/COMPLIANCE observations), Escalation handling queue — a
  consolidated HR panel over the new tables.
- **Executive Dashboard** → Critical alerts (open CRITICAL observations/incidents count),
  a workflow funnel (Observations→Escalations→Incidents→Resolved).
- **Audit & Timeline** → Escalation history + Resolution history (query the *Event tables).
- **Reports** → Observation/Incident report (counts by type/severity/status, reuse the
  configurable-report + CSV pattern).

Each is a thin read + UI surface; no new workflow logic. Ship the highest-value ones
(HR Workspace, Exec critical-alerts, profile tabs) first; the rest as follow-ups.

---

## Sequencing & rationale
P1 first — the whole chain hangs off Observation; it's independently useful (tracked
AI/manual issues with a manager queue) even before escalation exists. P2 adds the
accountability (SLA-driven escalation). P3 adds the formal case layer. P4 harvests the
data into the many dashboards that are currently NOT STARTED. Each phase: schema+migration
→ backend → typecheck → notifications rule → frontend → rebuild+recreate identity (and
notifications) → verify on the running stack → next.

## Verification per phase (running stack)
- Migrations applied drift-aware to live DB + recorded in `_prisma_migrations`.
- Each new route mapped (log check) + 401 smoke-test.
- End-to-end: create → notify (Mailpit) → act → state moves → timeline + audit recorded.
- Image-content verified before recreate (the stale-cache guard used all session).

## Not doing (out of scope for now)
- DB-backed per-org escalation-matrix editor (code-default matrix first; DB config later).
- ML anomaly models (AI stays heuristic — same thresholds, now they create records).
- Cross-service move (all three modules live in identity-service; they read identity data).
