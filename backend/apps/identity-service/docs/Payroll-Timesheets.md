# Payroll module (in-identity) & the payroll-service boundary

identity-service contains an **in-service payroll module** that turns approved
timesheet hours into pay cycles, employee/bill rates, client invoices, and
comp-off conversion. A separate, newer `payroll-service` is the enterprise
policy-driven payroll engine (its own bounded context and DB). This doc describes
the in-identity module and where the boundary sits.

Files: `src/modules/payroll/*` (`@RequireFeature("payroll")`).

## Module layout

| File | Owns | Routes |
|---|---|---|
| `payroll.service.ts` / `payroll.controller.ts` | pay cycles + lines | `/payroll/cycles` |
| `rates.service.ts` / `rates.controller.ts` | employee cost rates + client bill rates + settings | `/payroll/rates` |
| `invoices.service.ts` / `invoices.controller.ts` | client invoices | `/payroll/invoices` |
| `reports.service.ts` / `reports.controller.ts` | payroll dashboard/reports/export (bare `/payroll`) | `/payroll` |

Models (identity-db): `PayrollCycle` (`PayrollCycleStatus`, `PayrollCycleFrequency`),
`PayrollLine`, `EmployeeRate`, `BillRate`, `PayrollSetting`, `ClientInvoice`
(`ClientInvoiceStatus`), `ClientInvoiceLine`, `CompOffLedger`.

`PayrollModule` imports `LeaveModule` so it can call `CompOffService` to convert
approved overtime into comp-off at `lock()`.

## Cycle lifecycle

```
create ──run──▶ (DRAFT lines) ──lock──▶ (frozen) ──paid──▶
```

- **`createCycle`** — validates `end >= start` and **rejects overlapping
  periods** (an overlap would double-pay the same hours). Stamps the org's
  currency from `PayrollSetting`.
- **`run` / `preview`** — `preview` computes what each employee is owed for a
  period *without persisting*; `run` reuses the exact same computation so preview
  and run can never disagree. **Running is idempotent**: it recomputes `DRAFT`
  lines from scratch each time.
- **`lock`** — freezes the lines; a locked cycle can never be re-run, so the
  numbers signed off are the numbers that stay. This is where comp-off conversion
  fires.
- **`markPaid`** — records payment.

Reading is `payroll.read` (Owner + HR Manager); running/locking/marking-paid are
`payroll.approve` (Owner) — "each moves or freezes money"
(`payroll.controller.ts`).

## How pay is computed

Inputs are **approved timesheet hours** (or all tracked hours if the org turns
`requireApproval` off) priced at **the cost rate in effect on each entry's own
date** (`EmployeeRate`, effective-dated). Key rules from the code:

- **Overtime is computed per ISO week** against `PayrollSetting.overtimeAfterMins`
  — "a weekly threshold is what OT rules are actually written against; summing a
  month and dividing would silently under-report it." Weeks are Monday-anchored
  in UTC (`weekStartOf`), matching `TimeTrackingService`.
- **Money never leaves as a float** — `cents()` rounds half-up to whole cents; a
  `LineDraft` carries `regular/overtime/gross` pay in cents.
- An employee with hours **but no rate** is flagged (`problem`) and excluded from
  the run rather than silently zero-paid.

## Rates & invoices

- `RatesService` — `setEmployeeRate` / `setBillRate` (effective-dated),
  `resolveCostRate` / `resolveBillRate` for a date, and org `PayrollSetting`
  (currency, OT threshold, approval requirement).
- `InvoicesService` — client-facing `ClientInvoice` lifecycle:
  `preview → generate → send → markPaid` (or `voidInvoice`), built from billable
  hours × `BillRate`.

## Boundary with the new payroll-service

The two coexist deliberately:

| | in-identity `payroll` module | `payroll-service` |
|---|---|---|
| Scope | timesheet-hours → simple pay cycles, cost/bill rates, client invoices, comp-off conversion | enterprise policy-driven payroll: compensation, overtime, tax, deductions, bonuses, settlements, payslips, payment |
| Data | `identity-db` (`PayrollCycle`, `PayrollLine`, `EmployeeRate`, `ClientInvoice`, …) | `payroll-db` (own 39-table model) |
| Engine | inline computation in `PayrollService` | versioned, effective-dated **policy engine** (`engine/*`) |
| Inputs | reads approved timesheets/rates directly in-process | consumes **projected facts** from identity events (`timesheet.decided`, `attendance.overtime_approved`, `leave.decided`, `employee.*`) via `STREAMS.domainEvents` |
| Permissions | coarse `payroll.read` / `payroll.approve` | granular maker-checker set (`payroll.calculate/review/finalize/pay`, `salary.*`, `tax.*`, …) — all still defined in `@retainiq/authz` and resolved from identity-db bundles |

The granular payroll permissions already live in `@retainiq/authz` and are
carried by the `HR Manager`/`Owner` seed roles (see `RBAC-ABAC.md`), so the RBAC
substrate for payroll-service is served by identity-service. The domain events
payroll-service projects are emitted by identity-service's outbox (see
`Events-Outbox.md`). No cross-database FKs — `orgId`/`employeeId` are plain UUIDs
on both sides.
