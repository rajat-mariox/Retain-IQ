# Projects & Time Tracking

Two feature-gated modules covering delivery work and the hours logged against it.
`projects` owns projects/tasks/milestones/goals with department/team-scoped
management; `timetracking` owns per-day time entries rolled into weekly
timesheets that feed payroll. Both filter through `AccessScopeService`.

Files: `src/modules/projects/*` (`@RequireFeature("projects")`),
`src/modules/timetracking/*` (`@RequireFeature("timeTracking")`).

## Projects (`src/modules/projects`)

Models: `Project` (+ `ProjectStatus`, `ownerEmployeeId`, `teamId`), `Task`
(`TaskStatus`, `TaskPriority`, `assigneeEmployeeId`), `TaskComment`, `Milestone`
(`MilestoneStatus`), `Goal` (`GoalStatus`), `ProjectSetting`.

### Department/team-scoped project.write

The permission gate (`project.write`) is scope-blind; the module applies the
scope via `AccessScopeService.projectWhere(orgId, scope)` (see `RBAC-ABAC.md`):

- **org** → no filter;
- **scoped** → projects whose team is in the caller's departments/teams, or that
  they/a reachable employee own;
- **self** → only projects the caller personally owns.

So a department manager with a `DEPARTMENT`-scoped `project.write` grant manages
their own department's projects and nobody else's.

### Task self-move — assignees move their own tasks

`updateTask` (`projects.service.ts:722`) carries a bespoke authorization rule so
an assignee can drag their own task across the board without full
`project.write`:

```ts
const canManage = await this.canManageProject(task.projectId);
if (!canManage) {
  const isAssignee = employeeId !== null && task.assigneeEmployeeId === employeeId;
  const ownFieldsOnly = keys.length > 0 && keys.every((k) => k === "status" || k === "description");
  if (!isAssignee || !ownFieldsOnly) throw new ForbiddenException(…);
}
```

An assignee may change **`status` and `description` only** — move it between
statuses and note what they're doing — but not rename, reprioritise, or reassign
it, and never touch another department's work. Full edit still needs
`project.write` for the project's scope. The 403 message names the actual rule
(an Owner is read-only where the project already has a manager). A genuine
reassignment (`assigneeEmployeeId` actually changed) publishes a `task.assigned`
event.

### Read surfaces

`projects/dashboard`, `projects/people`, `projects/teams-overview`,
`projects/departments-overview`, `projects/manager-overview`, `projects/reports`
— rollups gated by `project.read` and reach-scoped. `Goal` supports org-level
targets (e.g. a `metric='productivity'` goal with no project) consumed by
`InsightsService`.

## Time Tracking (`src/modules/timetracking`)

Models: `TimeEntry` (per-day minutes, `billable`, project link), `Timesheet`
(weekly, `TimesheetStatus`, `weekStart`, `totalMinutes`).

### Entries → weekly timesheet → decision

`TimeTrackingService` (`timetracking.service.ts`):

- `createEntry` / `updateEntry` / `deleteEntry` — a person logs their own daily
  time (minutes, project, billable flag).
- `syncAutoEntries` / `syncAutoEntriesForOrg` — auto-populate entries from tracked
  activity (`POST time/auto-sync`, `attendance.approve`).
- `submit` — upserts the week's `Timesheet` to `SUBMITTED` and emits
  `timesheet.submitted` **in the same transaction**:

  ```ts
  const ts = await tx.timesheet.upsert({ where: { orgId_employeeId_weekStart: {…} },
    create: { …, status: "SUBMITTED", totalMinutes, submittedAt: new Date() },
    update: { status: "SUBMITTED", totalMinutes, submittedAt: new Date(), decidedAt: null, decidedBy: null } });
  await this.outbox.enqueue(tx, { eventType: "timesheet.submitted", aggregateType: "timesheet",
    aggregateId: ts.id, orgId, payload: { timesheetId, employeeId, weekStart, totalMinutes } });
  ```

- `pending` / `review` / `decide` — an approver (with `attendance.approve` reach)
  approves or rejects; `decide` writes the decision and emits `timesheet.decided`
  with the requester's userId (so notifications reach the submitter) and status.
- `billableSummary` — billable vs non-billable rollup.

Weeks are Monday-anchored in UTC (`weekStartOf`), matching `PayrollService`.

### Feeds payroll

Approved timesheet hours are the input to `PayrollService.run` — regular vs
overtime minutes, billable minutes, priced by the cost rate in effect on each
entry's own date. Only `APPROVED` timesheets are consumed (unless the org turns
`requireApproval` off). See `Payroll-Timesheets.md`. Downstream, payroll-service
also projects `timesheet.decided` (APPROVED only) into its own read model.

## Route map (selected)

| Route | Permission |
|---|---|
| `GET time/timesheet`, `POST time/entries`, `PATCH/DELETE time/entries/:id`, `POST time/timesheet/submit`, `GET time/timesheets/mine` | self |
| `GET time/timesheets/pending|:id`, `POST time/timesheets/:id/decision`, `POST time/auto-sync` | `attendance.approve` |
| `GET time/billable-summary` | `attendance.read` |
| `GET org/projects`, `POST org/projects`, `PATCH org/projects/:id` | `project.write` (scoped) |
| `PATCH org/tasks/:id` | `project.write`, **or** assignee (status/description only) |
| `GET org/projects/dashboard|people|teams|reports` | `project.read` |
| `POST/PATCH/DELETE org/goals[/:id]` | `project.write` |
