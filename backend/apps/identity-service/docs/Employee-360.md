# Employee module & 360

The `employee` module owns the employee record and its entire lifecycle, plus the
**360 aggregation** — a single, server-authorized view that pulls an employee's
operational data from the services that own it. Every section is filtered on the
server by both permission and ABAC scope, and sensitive fields are field-masked.

Files: `src/modules/employee/*`, `src/common/security/field-mask.ts`.

## Module surface

| File | Responsibility |
|---|---|
| `employee.service.ts` / `employee.controller.ts` | CRUD, list, org-chart, lifecycle transitions, promotion/transfer entry points |
| `employee-360.service.ts` | the 360 aggregation (below) |
| `employee-documents.service.ts` | employee documents |
| `skills.service.ts` / `certifications.service.ts` | skills catalog + proficiency; certifications + expiry |
| `certification-reminders.service.ts` | cron → `certification.expiring` events |
| `probation.service.ts` / `probation-reminders.service.ts` | probation records/extensions; `probation.ending` reminders |
| `exit.service.ts` | offboarding: `employee.exit_started` → `employee.exited` (+ `employee.access_revoked`) |
| `alumni.service.ts` | `EmployeeAlumni` — `employee.alumni_created` |
| `remark.service.ts` | `EmployeeRemark` with `RemarkVisibility` |
| `recommendations.service.ts` | derived recommendations |
| `change-request.service.ts` / `change-request.cron.ts` | promotion/transfer approval chains (see `Workflow-Engine.md`) |

The corresponding data models (identity-db) include `Employee`,
`EmployeeDocument`, `EmploymentEvent`, `EmployeeCareerHistory`, `EmployeeExit`,
`OffboardingTask`, `EmployeeAlumni`, `ProbationRecord`, `ProbationExtension`,
`EmployeeRemark`, `SkillCatalog`, `EmployeeSkill`, `EmployeeCertification`,
`Achievement`, `WorkforceSetting`.

## The 360 aggregation

`Employee360Service.aggregate(employeeId, { from, to })`
(`employee-360.service.ts`) assembles a one-employee dossier by **reading from
the owners, never duplicating**: attendance/leave/timesheets/screenshots from
identity-db, productivity/activity from the analytics read model.

The tabs/sections surfaced (profile, attendance, productivity, monitoring,
timesheets, leave, compensation) map to a broader 360 UI covering skills, certs,
career, probation, exit, alumni, remarks, recognition, audit and recommendations
— each served by the sibling services above and gated the same way.

### Field-level authorization — every section is server-filtered

A section is included **only if the caller both holds its permission and the
target employee is within that permission's ABAC scope**. Sections the caller
can't see are **omitted entirely** — the response never carries data the actor
isn't allowed to read, so the frontend has nothing sensitive to hide.

```ts
private async canSee(orgId, userId, employeeId, permission, held): Promise<boolean> {
  if (!held.has(permission)) return false;                       // RBAC
  const scope = await this.accessScope.resolveScope(orgId, userId, permission);
  if (scope.tier === "org") return true;
  const visible = await this.accessScope.visibleEmployeeIds(orgId, scope); // ABAC
  return visible === null || visible.includes(employeeId);
}
```

The base gate is `employee.read` scoped to the target — fail it and the endpoint
returns `NotFoundException("Employee not found.")` (existence isn't leaked).
Then, per section:

| Section | Gate |
|---|---|
| `attendance`, `timesheets` | `attendance.read` in scope |
| `productivity` | derived from analytics; gated on `employee.read` (already true) |
| `monitoring` (screenshot counts) | `screenshots.read` in scope |
| `leave` | **approval reach**, not a static permission — `ApprovalService.approvableEmployeeIds()` (or own record) |
| `compensation` | always present, but **masked** unless `payroll.read`/`payroll.approve` |

The response lists `authorizedSections` so a client knows exactly what it was
allowed to see.

## Field masking — field-mask.ts

Sensitive scalars carry a `SensitivityLevel`
(`PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED | HIGHLY_RESTRICTED`) and render
to one of three outcomes:

- **VISIBLE** — the real value;
- **MASKED** — a redacted placeholder (`"••••"`, or `maskTail → "•••• 7821"`), so
  the field's *existence/shape* is known but not its content;
- **DENIED** — the field is omitted (for fields a viewer shouldn't know exist).

```ts
export function renderField<T>(value, sensitivity, authorized, redact): MaskedField<T> {
  if (value == null) return { masked: false, sensitivity, value: null };
  if (authorized)   return { masked: false, sensitivity, value };
  return { masked: true, sensitivity, value: redact(value) };
}
```

The 360 `compensation` section is the canonical use: the employee's current
hourly cost rate is `HIGHLY_RESTRICTED`. An unauthorized viewer still learns
compensation is *on file* and its currency, but the amount is `"••••"`; a
`payroll.read` holder gets the real cents value:

```ts
const field = renderField<number>(cents, "HIGHLY_RESTRICTED", authorized, () => maskAmount());
return { onFile: cents !== null, currency, unit: "per hour",
         costRate: field.value, masked: field.masked, effectiveFrom };
```

## Lifecycle & work vs personal email

Employee lifecycle transitions (`EmployeeStatus`: `ACTIVE`, `ON_LEAVE`,
`NOTICE_PERIOD`, exited, etc.) and career events are recorded immutably
(`EmployeeCareerHistory`, `EmploymentEvent`). Promotions/transfers never mutate
the `Employee` row directly — they go through the change-request approval chain
(`Workflow-Engine.md`). The `Employee` record separates the **work (sign-in)
email** from the **personal email** so login identity and contact identity are
distinct fields.
