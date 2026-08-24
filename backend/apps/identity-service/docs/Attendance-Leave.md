# Attendance & Leave

Two feature-gated modules (`@RequireFeature("attendance")`,
`@RequireFeature("leave")`) that together cover the day-to-day time record:
check-in/out with breaks and overtime, corrections, autoclose/recompute, alerts,
and leave requests drawing on quotas, half-days, and an earned comp-off ledger.

Files: `src/modules/attendance/*`, `src/modules/leave/*`.

## Attendance state machine — attendance-state.ts

The heart of attendance is a **pure, DB-free state machine**
(`attendance-state.ts`): the service loads a `DaySnapshot`, asks this module what
is allowed, then writes. Every rule is directly testable and the API and UI never
disagree about what's offered.

States: `NOT_CHECKED_IN | WORKING | ON_BREAK | CHECKED_OUT | COMPLETED | ABSENT |
ON_LEAVE | HOLIDAY | WEEKEND`. Actions: `CHECK_IN | CHECK_OUT | BREAK_START |
BREAK_END`.

`deriveState(snap, policy)` — non-working classifications win (a holiday is a
holiday even if someone punched in); an open break → `ON_BREAK`, an open session
→ `WORKING`; after a closed session, `CHECKED_OUT` vs `COMPLETED` depends on
whether re-entry is allowed. `can(action, snap, policy)` returns
`{ allowed, reason? }` with employee-facing messages; `availableActions` filters
the ordered action list to what's currently permitted.

### Policy-driven behavior — AttendancePolicy

The `AttendancePolicy` interface mirrors the `AttendancePolicy` row: it gates
multiple sessions/re-entry, session/break caps, `minMinutesBeforeBreak/CheckOut`,
grace, auto-checkout, idle-checkout, overtime threshold, work model, location
requirements, and manual correction. `DEFAULT_POLICY` is conservative — one
session/day, 10-min grace, matching classic check-in/out.

Derived totals (`computeTotals`) split breaks into paid vs unpaid
(`splitBreakMinutes`: first `paidBreakMinutesPerDay` are paid), net worked time
deducts only unpaid breaks, and overtime is measured past
`overtimeAfterMinutes` (else the shift length). `deriveStatus` maps a day to
`PRESENT | LATE | ABSENT`.

## Attendance services

| Service | Role |
|---|---|
| `attendance.service.ts` | check-in/out, break start/end, status, roster, reports (daily/monthly/department), calendar, scores |
| `attendance-policy.service.ts` | read/update the org `AttendancePolicy` (`attendance.manage`) |
| `attendance-correction.service.ts` | correction requests + decisions (`attendance.correction_requested` / `_decided`) |
| `attendance-autoclose.service.ts` | cron closing sessions the employee never closed |
| `attendance-recompute.service.ts` | recompute day facts after policy/data changes |
| `attendance-alerts.service.ts` | anomaly/late alerts |
| `attendance-insights.service.ts` | overtime trends, scores |
| `report-schedule.service.ts` | scheduled report jobs (`report.scheduled`) |

### Autoclose — the anti-gaming clamp

`attendance-autoclose.service.ts` closes sessions left open. It does **not** stamp
the moment the sweeper runs (that would reward *not* checking out — leave a
session open till midnight and bill extra hours). The end time is the earliest
defensible instant:

```
endedAt = min(last observed activity, shift end + grace)
```

Last-activity credits someone who genuinely worked late to their last keystroke;
the shift bound covers browser-only users and caps an agent left idle. Overtime
is **zeroed** on auto-closed days — overtime is a *claim* requiring the
deliberate act of checking out — so leaving a session open can only ever lose you
time, never gain it.

### Overtime approval

Overtime accrues from the totals but is not credited until approved:
`GET attendance/overtime/pending` and `POST attendance/overtime/:attendanceId/
approve` (`attendance.approve`) move OT from claimed to `approvedOvertimeMinutes`
— which is what payroll and comp-off draw on. `attendance.overtime_approved`
flows out to payroll-service.

## Leave — leave.service.ts

`LeaveService` covers types, balances, requests, decisions, cancel, calendar, and
analytics. Leave types (`LeaveType`) are per-org; balances are computed against
the type's quota.

### Request rules (`createRequest`)

Grounded rules from the code:

- **Owner cannot file leave** — `orgRoles.isOwnerEmployee` → 403. "As the owner,
  you approve requests rather than filing your own." (A quota for the Owner would
  count against a limit nobody sets.)
- **No past dates**; `end >= start`.
- **Half-day** (`FIRST_HALF`/`SECOND_HALF`) applies to a *single* date only and
  deducts exactly `0.5`; anything else is `FULL`.
- **No overlaps** with an existing `PENDING`/`APPROVED` request → 409.
- **Working days** are computed (`computeLeaveDays`) so weekends/holidays in the
  range don't consume quota.
- **Comp-off leave** (`type.code === "COMP_OFF"`) draws on the earned comp-off
  ledger, not an annual quota — the balance is checked up-front and the spend is
  written on approve.

Persist + notify are **atomic** via the transactional outbox:

```ts
return this.prisma.$transaction(async (tx) => {
  const req = await tx.leaveRequest.create({ … });
  await this.outbox.enqueue(tx, { eventType: "leave.requested", aggregateType: "leave_request",
    aggregateId: req.id, orgId, payload: { leaveRequestId, employeeId, leaveTypeCode, days, dayPart, … } });
  return req;
});
```

### Decisions & events

`decide(...)` applies approval reach (`ApprovalService` — a manager approves only
their people; see `RBAC-ABAC.md`) and emits `leave.decided`;
cancellation of an approved leave emits `leave.cancelled` and notifies the
assigned manager. Only `APPROVED` leaves become facts downstream (payroll-service
ignores `REJECTED`).

### Comp-off ledger

`comp-off.service.ts` maintains `CompOffLedger` — approved overtime is converted
to comp-off credit (the payroll module calls `CompOffService` at cycle `lock()`,
which is why `PayrollModule` imports `LeaveModule`). `balanceOf(orgId, employeeId)`
is the spendable balance a `COMP_OFF` leave request must fit within.

## Holidays

`holidays` module (`Holiday` model) supplies the holiday calendar
`computeLeaveDays` and the attendance state machine consult so non-working days
are neither charged as leave nor counted as absence.

## Route map (selected)

| Route | Permission |
|---|---|
| `POST attendance/check-in|check-out|break/start|break/end` | self (linked employee) |
| `GET attendance/status|me|today` | self / `attendance.read` |
| `GET/PATCH attendance/policy` | `attendance.read` / `attendance.manage` |
| `POST attendance/corrections` | self; `corrections/pending`, `:id/decision` → `attendance.approve` |
| `GET attendance/overtime/pending`, `POST overtime/:id/approve` | `attendance.approve` |
| `GET attendance/report/{daily,monthly,department}`, `roster`, `calendar`, `scores` | `attendance.read` |
| `POST leave/requests`, `me/balances`, `requests/:id/cancel` | self |
| `POST leave/requests/:id/decision` | `attendance.approve` |
| `POST leave/types`, `PATCH leave/types/:id`, `comp-off/grant` | `attendance.approve` |
| `GET leave/balances|analytics|export|org-calendar` | `attendance.read` |
