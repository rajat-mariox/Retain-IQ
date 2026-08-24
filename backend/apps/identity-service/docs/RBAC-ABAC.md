# RBAC & ABAC

Authorization is two-layered. **RBAC** answers *"may this user perform this
action at all?"* from a union of role grants. **ABAC** answers *"on whose data?"*
by resolving the widest data scope those grants confer. The two are enforced by
different components and composed per-module.

Files: `src/common/guards/permission.guard.ts`, `src/common/security/
permission-bundle.service.ts`, `src/common/access-scope/access-scope.service.ts`,
`src/common/approval/approval.service.ts`, `@retainiq/authz`.

## The permission catalog (`@retainiq/authz`)

Permissions are stable `resource.action` strings exported as a typed map
(`packages/authz/src/index.ts`). Route code references the symbol
(`permissions.attendanceApprove`), never the literal.

```ts
export const permissions = {
  employeeRead: "employee.read",       employeeWrite: "employee.write",
  attendanceRead: "attendance.read",   attendanceApprove: "attendance.approve",
  attendanceManage: "attendance.manage",
  projectRead: "project.read",         projectWrite: "project.write",
  screenshotsRead/Download/Delete, payrollRead, payrollApprove,
  // granular payroll (maker-checker): payroll.calculate/review/finalize/pay/export,
  //   salary.*, tax.*, bonus.*, overtime.*, comp_off.*, reimbursement.*, payroll_policy.*
  aiRiskRead, observationRead, observationManage, incidentManage,
  billingManage, securityManage: "settings.security.manage", auditRead,
} as const;
```

`allPermissions` seeds the Owner role. Four **system roles** are seeded into
every org (`SYSTEM_ROLES`, highest first):

| Role | Permissions |
|---|---|
| **Owner** | `allPermissions` — full administrative access |
| **Manager** | employee r/w, attendance read+approve, project r/w, ai_risk, observation r/manage, screenshots r/download/delete. **Deliberately no payroll** — managing a team doesn't require seeing salaries |
| **HR Manager** | people-ops: employee r/w, attendance approve, payroll.read/approve/**review**, salary/bonus/overtime/reimbursement view+approve, comp_off, tax.view, payroll_policy.view, observation/incident manage, screenshots read/download (no delete). No `project.write`, no `payroll.finalize`/`payroll.pay` — separation of duties |
| **Employee** | `project.read` only — sees own productivity via `/insights/me`, never a screenshot gallery |

## RBAC — PermissionGuard + PermissionBundleService

`@RequirePermissions(...)` decorates a route; `PermissionGuard`
(`permission.guard.ts`) enforces it. It **fails closed**: no context, unknown
membership, or a missing permission all deny.

```ts
const bundle = await this.permissionBundleService.resolve(ctx.orgId, ctx.userId);
if (!bundle) throw new ForbiddenException("Membership is not active.");
const missing = missingPermissions(bundle.permissions, required);
if (missing.length) throw new ForbiddenException(`Missing required permission(s): …`);
```

Critically, **access-token claims are never trusted for authorization** — the
guard loads the *authoritative* bundle from the database. The JWT only says
*which* membership to load.

### The bundle is a UNION of grants (multi-grant RBAC)

`PermissionBundleService.resolve` (`permission-bundle.service.ts`) computes the
effective bundle as the **union across every ACTIVE `RoleAssignment`** the user
holds in the org:

```ts
for (const g of grants) for (const p of g.role.permissions) permissionSet.add(p);
// version = Σ role.version;  roleName = distinct granted role names joined
```

If a user has no grants yet, it falls back to the membership's primary
`role.permissions` (the migration backfills an ORG grant for every member). The
displayed `role` label reflects what actually governs access — the granted
role(s) when any exist, otherwise the base role — so the session's role stays in
step with its permissions.

**Caching**: bundles are cached (`PermissionCache` — in-memory or Redis per
`PERMISSION_CACHE_DRIVER`, `security.module.ts`). Editing a role calls
`invalidateRole(orgId, roleId)`, which drops the cached bundle of every user
holding it as a grant *or* as their membership's primary role, so a permission
change takes effect immediately rather than after the TTL.

## ABAC — AccessScopeService (org / scoped / self)

RBAC says *what*; `AccessScopeService` (`access-scope.service.ts`) says *on whose
records*. `resolveScope(orgId, userId, permission)` inspects the user's ACTIVE
grants that include the given permission and returns the **widest** tier:

| Tier | Meaning | Trigger |
|---|---|---|
| `org` | org-wide, no filter | any grant with `scopeType: "ORG"` for the permission |
| `scoped` | a set of departments + teams | `DEPARTMENT` / `TEAM` grants |
| `self` | just their own record | no scoped grant |

**Rule: the widest scope among matching grants wins. ORG > DEPARTMENT/TEAM > SELF.**

The service emits Prisma `where` fragments so filtering happens **at the query**,
never post-filtered in memory (scales to 100k+ employees/org):

- `employeeWhere(scope)` — `{}` for org; `{ id }` for self; for scoped an `OR`
  over `departmentId in`, `teamId in`, own `id`, and `managerId` (direct
  reports). A scoped manager therefore also sees their own record and reports.
- `visibleEmployeeIds(orgId, scope)` — the concrete id set (or `null` = org-wide)
  for resources keyed by `employeeId` (e.g. screenshots).
- `reachableTeamIds` / `projectWhere` — for team-hung resources: a project is in
  reach when its team is granted, or the caller/reachable employee owns it. This
  is the department-scoped `project.write` enforcement.

A permission gate is scope-blind; scoping is applied **per module** by calling
`AccessScopeService` — so `attendance.read` at the route plus `resolveScope`
inside the service together mean "an HR manager reads *their* departments".

## Approval reach — ApprovalService

`ApprovalService` (`approval.service.ts`) decides *who may approve whose*
leave/timesheet, combining the reporting line with granted scope:

- **Owner** → only people **nobody else manages** (the fallback approver). Where
  a manager or a scoped `attendance.approve` grant covers a person, the Owner
  steps back — otherwise their queue would show requests that `403` on decide.
- **Scoped `attendance.approve`** → everyone in those departments/teams (an HR
  manager signs off for all of HR), plus their own direct reports.
- **Otherwise** → their own direct reports (`Employee.managerId`).
- **Nobody approves their own request**, whatever their role.

`assertCanApprove(subjectEmployeeId)` throws a role-appropriate 403;
`approvableEmployeeIds()` returns the reach set (`null` = org-wide) and is reused
to scope the "pending approvals" queue so it only shows what the caller can act
on. `attendance.approve` is still required at the route — this narrows *whom*.

## Owner-is-not-staff principle

`OrgRolesService` (`src/common/org-roles`) encodes that the Owner runs the org
but is not day-to-day staff (excluded from payroll/attendance/timesheets/leave as
a subject). Governance is theirs; operations are the Manager's. `ApprovalService`
embodies the corollary: the Owner is the approver only for the unmanaged.
