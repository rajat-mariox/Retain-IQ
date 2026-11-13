# Workflow Engine

Two multi-stage approval/escalation workflows run inside identity-service, both
built on the same primitives: the ABAC reach engine (who owns a person), the
reporting line (`Employee.managerId`), role-grant lookups, immutable event
timelines, audit records, and the transactional outbox for notifications.

1. **Workforce-care chain**: Observation → Escalation → Incident.
2. **Employee change chain**: promotion/transfer approval steps.

## 1. Observation → Escalation → Incident

### Stage 1 — Observation (`src/modules/observation`)

An `Observation` is an AI-detected or manager-raised concern about a person
(`ObservationType`: `PRODUCTIVITY_DROP`, `BURNOUT_RISK`, `LOW_ENGAGEMENT`,
`ATTENDANCE_ANOMALY`, `LATE_PATTERN`, `BEHAVIOUR`, `OTHER`; `Severity`
`LOW..CRITICAL`). It routes to the manager who owns that employee **via the same
reach engine that powers leave/attendance approvals** and moves through
`OPEN → ACKNOWLEDGED → RESOLVED/DISMISSED`, or `ESCALATED`. Every transition is
recorded on an immutable `ObservationEvent` timeline and audit-logged.
`createFromAi` carries a `dedupeKey` so a repeated AI signal doesn't raise
duplicate cases.

Reach is enforced the same way everywhere: `observation.read` scope →
`AccessScopeService.employeeWhere`; a manager sees/acts only on people they own,
the Owner sees all.

### Stage 2 — Escalation (`src/modules/escalation`)

`EscalationService.escalate(observationId, reason?)` takes an observation up a
**severity-driven authority ladder** with per-level SLAs. The matrix
(`escalation.service.ts`) is code-as-config:

```ts
const MATRIX = {
  LOW:      { startLevel: 1, maxLevel: 2, slaHours: { 1: undefined, 2: undefined } },
  MEDIUM:   { startLevel: 1, maxLevel: 3, slaHours: { 1: 72, 2: 72, 3: undefined } },
  HIGH:     { startLevel: 1, maxLevel: 3, slaHours: { 1: 24, 2: 24, 3: undefined } },
  CRITICAL: { startLevel: 2, maxLevel: 3, slaHours: { 2: 4,  3: undefined } },
};
const LEVEL_LABEL = { 1: "Manager", 2: "Department head", 3: "HR / Owner" };
```

`LOW` never auto-escalates; `CRITICAL` starts at the department-head level and
**always also pings the Owner**.

**Level → a real person** (`authorityFor`), reusing the reporting line then
role grants:

- **L1** → the employee's reporting manager (`Employee.managerId` → membership userId).
- **L2** → that manager's own manager (dept head in the reporting line), else a
  `DEPARTMENT`/`TEAM`-scoped `observation.manage` grant holder for the
  employee's department/team.
- **L3** → an `incident.manage` holder (HR), else the org Owner.

Transitions (`acknowledge`, `resolve`, `bump`) are reach-checked
(`loadInReach`), append an `EscalationEvent`, and audit. Resolving an escalation
also closes the parent observation. Each notification is an
`escalation.created` outbox event addressed to `requesterUserId`.

**SLA cron** — `EscalationSlaService.sweep()` (`escalation-sla.service.ts`,
`@Cron(EVERY_HOUR)`, context-free/cross-org) finds every `PENDING` escalation
past its `dueAt` and auto-bumps it to the next level (or clears `dueAt` at the
top of the ladder so it isn't re-scanned), re-notifying the new authority with an
`auto: true` event. An unacknowledged escalation climbs the ladder until someone
owns it. The matrix is duplicated here and "kept in step" with the service copy.

### Stage 3 — Incident (`src/modules/incident`)

A standalone module (gated by `incident.manage`). An `Incident` is a formal,
investigable case with a human reference `INC-YYYY-NNNN` (per-org sequential
within the year, `nextReference`). Opened by **promoting a serious escalation**
or manually by HR. Own lifecycle: `OPEN → INVESTIGATING → RESOLVED → CLOSED`
(`IncidentStatus`), with `IncidentEvent`/`IncidentComment`/`IncidentEvidence`
sub-records and its own immutable timeline + audit trail.

```
Observation (OPEN)  ──escalate──▶  Escalation (L1→L2→L3, SLA cron)  ──promote──▶  Incident (INC-YYYY-NNNN)
   AI or manager                     severity ladder + reach                        formal case, incident.manage
```

## 2. Employee change chain (promotion / transfer)

`ChangeRequestService` (`src/modules/employee/change-request.service.ts`) is the
promotion/transfer approval engine. A request captures the **proposed change plus
a snapshot of what it replaces**, then walks a **configurable per-org chain of
approver roles**. The `Employee` row is **never mutated outside `apply()`** —
which runs only when every step approves.

```ts
const DEFAULT_PROMOTION_CHAIN = ["MANAGER", "HR", "FINANCE"];
const DEFAULT_TRANSFER_CHAIN  = ["MANAGER", "NEW_MANAGER", "HR"];
```

The chain is read from `WorkforceSetting.promotionChain` / `transferChain`
(falling back to the defaults). Each chain role resolves to a login userId
(`resolveApprover`):

- `MANAGER` → the employee's current manager; `NEW_MANAGER` → the proposed manager;
- `HR`/`DEPARTMENT_HEAD` → first member whose role carries `employee.write`;
  `FINANCE` → first member whose role carries `payroll.approve`.

Requests are persisted as `EmployeeChangeRequest` with ordered
`ChangeApprovalStep` rows (`ChangeStepStatus`). The pending queue is reach-scoped:
an org-tier viewer sees all `PENDING_APPROVAL`; otherwise only requests whose
*current* pending step is assigned to the caller. Notifications go out via the
outbox — `employee.change_approval_pending` to the next approver and
`employee.change_decided` to the requester.

On full approval, `apply()` writes atomically: updates the `Employee`, records an
immutable `EmployeeCareerHistory` row, an `EmploymentEvent`, an audit entry, and
a domain event. Future-dated approvals wait in `SCHEDULED` for
`change-request.cron.ts` to apply them on the effective date.
