# Rules Engine

The rules engine is a **code-based registry** mapping a domain event type to zero or
more notification specs. It is intentionally a plain object in `src/rules.ts`, not a
DB table — the header comment calls it "the seam for a future DB-backed,
org-configurable rules engine; the consumer doesn't care where rules come from."

Files: `src/rules.ts`.

## `rulesFor(eventType)`

The only entry point the worker calls (`main.ts` line 79):

```ts
export function rulesFor(eventType: string): NotificationSpec[] {
  return RULES[eventType] ?? [];
}
```

An unknown event type returns `[]`, and `handle()` acks and ignores it. A single event
type may map to an **array** of specs (the registry supports multiple notifications
per event, though today every entry has exactly one).

## `NotificationSpec`

Each spec is fully self-describing (`rules.ts`):

```ts
export type NotificationSpec = {
  type: string;                 // stable notification type slug (also part of the dedupeKey)
  audience: Audience;           // who resolveRecipients() should target
  category: Category;           // ATTENDANCE | PRODUCTIVITY | PROJECT | AI | SYSTEM
  priority: Priority;           // LOW | NORMAL | HIGH | CRITICAL
  channels: Channel[];          // the MAXIMUM fan-out set (IN_APP | EMAIL | PUSH)
  title: (payload) => string;
  body:  (payload) => string;
  link?: (payload) => string | null;   // optional deep link into the app
};
```

Key semantics:

- **`channels` is a ceiling, not a guarantee.** The worker intersects it with the
  recipient's per-category preferences (`prefs.allowed`) before dispatching
  (`main.ts` line 101: `if (!prefs.allowed.has(channel)) continue;`). A rule listing
  `["IN_APP","EMAIL","PUSH"]` still only emails a user who opted email in for that
  category.
- **`category`** drives both the default channel set (`preferences.ts` `DEFAULTS`) and
  which per-category preference row applies.
- **`title` / `body` / `link`** are pure functions of the event payload, evaluated in
  `handle()` (`main.ts` lines 108-113). They use the `str()` / `Number()` helpers to
  tolerate missing fields with sensible fallbacks — a malformed payload never throws,
  it degrades to generic copy (e.g. `"An employee"`, `"a task"`).

### The `Audience` vocabulary (`rules.ts`, resolved in `recipients.ts`)

| Audience | Resolved to |
|---|---|
| `owner` | `payload.ownerUserId` (single user) |
| `requester` | `payload.requesterUserId` (single user) |
| `approver` | `payload.approverUserId` (the one manager who signed off) |
| `assignee` | `payload.assigneeUserId` (single user) |
| `org-admins` | `OrgRecipient` rows with role in `["Owner","Admin","HR Admin"]`, status ACTIVE |
| `approvers` | `OrgRecipient` rows with role in `["Owner","Admin","HR Admin","Manager"]`, status ACTIVE |

The four singular audiences read a userId straight off the event; the two plural ones
query the local `OrgRecipient` projection. See `Preferences-QuietHours.md`.

## Full handled-event table

Every key in `RULES`. `Ch` uses **I**=IN_APP, **E**=EMAIL, **P**=PUSH — this is the
ceiling before preference narrowing.

### Onboarding / org

| Event type | `type` | Audience | Category | Priority | Ch | Link |
|---|---|---|---|---|---|---|
| `org.registered` | welcome | owner | SYSTEM | NORMAL | I·E | — |
| `employee.created` | employee.created | org-admins | SYSTEM | LOW | I | /employees |

### Attendance / leave

| Event type | `type` | Audience | Category | Priority | Ch | Link |
|---|---|---|---|---|---|---|
| `leave.requested` | leave.requested | approvers | ATTENDANCE | HIGH | I·E·P | /leave |
| `leave.decided` | leave.decided | requester | ATTENDANCE | HIGH | I·E·P | /leave |
| `leave.cancelled` | leave.cancelled | approver | ATTENDANCE | NORMAL | I·E | /leave |
| `attendance.missed_checkin` | attendance.missed_checkin | requester | ATTENDANCE | NORMAL | I·P | /attendance |
| `attendance.missed_checkout` | attendance.missed_checkout | requester | ATTENDANCE | NORMAL | I·P | /attendance |
| `attendance.correction_requested` | attendance.correction_requested | approver | ATTENDANCE | HIGH | I·E | /attendance |
| `attendance.correction_decided` | attendance.correction_decided | requester | ATTENDANCE | HIGH | I·E | /attendance |
| `attendance.auto_checked_out` | attendance.auto_checked_out | requester | ATTENDANCE | NORMAL | I·E | /attendance |
| `attendance.late_arrival` | attendance.late_arrival | approvers | ATTENDANCE | LOW | I | /attendance |

### Observations / escalations / incidents

| Event type | `type` | Audience | Category | Priority | Ch | Link |
|---|---|---|---|---|---|---|
| `observation.created` | observation.created | requester | ATTENDANCE | HIGH | I·E | /observations |
| `observation.resolved` | observation.resolved | requester | ATTENDANCE | NORMAL | I | /observations |
| `escalation.created` | escalation.created | requester | ATTENDANCE | HIGH | I·E | /observations |
| `incident.opened` | incident.opened | requester | SYSTEM | HIGH | I·E | /incidents |
| `incident.resolved` | incident.resolved | requester | SYSTEM | NORMAL | I | /incidents |

For `observation.created` / `escalation.created` / `incident.opened` the `requester`
audience is the routed authority carried on `requesterUserId` (the manager an
observation routed to, the level-N approver for an escalation, the assigned
investigator for an incident), per the inline comments in `rules.ts`.

### Reports

| Event type | `type` | Audience | Category | Priority | Ch | Link |
|---|---|---|---|---|---|---|
| `report.ready` | report.ready | requester | SYSTEM | NORMAL | I·E | `payload.link` ?? /reports |
| `report.scheduled` | report.scheduled | requester | ATTENDANCE | NORMAL | I·E | `payload.link` ?? /attendance |

`report.scheduled` is the one rule whose email carries a **CSV attachment**: its body
appends "The full report is attached as a CSV." and `handle()` surfaces
`payload.reportCsv` as an attachment (`extractAttachments`, EMAIL only).

### Employee lifecycle

| Event type | `type` | Audience | Category | Priority | Ch | Link |
|---|---|---|---|---|---|---|
| `certification.expiring` | certification.expiring | requester | SYSTEM | NORMAL | I·E | /employees/{id} |
| `employee.change_approval_pending` | employee.change_approval_pending | requester | SYSTEM | HIGH | I·E | /employees |
| `employee.change_decided` | employee.change_decided | requester | SYSTEM | NORMAL | I·E | /employees |
| `employee.promoted` | employee.promoted | requester | SYSTEM | NORMAL | I·E | /employees/{id} |
| `employee.transferred` | employee.transferred | requester | SYSTEM | NORMAL | I·E | /employees/{id} |
| `employee.exit_started` | employee.exit_started | org-admins | SYSTEM | HIGH | I·E | /employees/{id} |
| `employee.exited` | employee.exited | org-admins | SYSTEM | NORMAL | I | /employees |
| `probation.ending` | probation.ending | requester | SYSTEM | HIGH | I·E | /employees/{id} |
| `recognition.created` | recognition.created | requester | SYSTEM | NORMAL | I·E | /employees/{id} |
| `employee.confirmed` | employee.confirmed | requester | SYSTEM | NORMAL | I·E | /employees/{id} |

### Projects / tasks / timesheets

| Event type | `type` | Audience | Category | Priority | Ch | Link |
|---|---|---|---|---|---|---|
| `timesheet.submitted` | timesheet.submitted | approvers | PROJECT | NORMAL | I·E | /time |
| `timesheet.decided` | timesheet.decided | requester | PROJECT | NORMAL | I·E | /time |
| `task.assigned` | task.assigned | assignee | PROJECT | HIGH | I·E·P | /projects/{id} ?? /tasks |
| `task.due_soon` | task.due_soon | assignee | PROJECT | NORMAL | I·P | /projects/{id} ?? /tasks |
| `task.overdue` | task.overdue | assignee | PROJECT | HIGH | I·E·P | /projects/{id} ?? /tasks |
| `milestone.completed` | milestone.completed | org-admins | PROJECT | NORMAL | I | /projects/{id} ?? /projects |

### Productivity / AI

| Event type | `type` | Audience | Category | Priority | Ch | Link |
|---|---|---|---|---|---|---|
| `productivity.drop` | productivity.drop | approvers | PRODUCTIVITY | NORMAL | I·E | /insights |
| `ai.recommendation` | ai.recommendation | approvers | AI | NORMAL | I | /insights |

**36 event types** are handled in total. Note that `org.member.upserted` is **not** in
`RULES` — it is intercepted earlier in `handle()` to maintain the `OrgRecipient`
projection and never produces a notification (see `Preferences-QuietHours.md` /
`Database-Events.md`).

## Title/body rendering helpers

`rules.ts` ships small pure helpers the specs use so a thin/partial payload never
throws:

- `str(value, fallback)` — returns the string if non-empty, else the fallback.
- `cap(word)` — title-cases a single word (`"PROMOTION"` → `"Promotion"`).
- `hoursOf(minutes)` — renders a minute count as `"7h 30m"` (timesheet totals).
- `linesOf(v)` — joins a `string[]` of summary lines with newlines (scheduled reports),
  falling back to a generic sentence.

Status-dependent titles (e.g. `leave.decided`, `timesheet.decided`,
`attendance.correction_decided`) branch on `payload.status === "APPROVED"` to pick
"approved" vs "rejected" copy inside the `title`/`body` functions.
