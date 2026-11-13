import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@retainiq/database/identity";
import type { CreateEmployeeInput } from "@retainiq/contracts";
import { AuditService } from "../../common/audit/audit.service.js";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { SeatLimitService } from "../../common/seat-limit/seat-limit.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { permissions } from "@retainiq/authz";
import { hashPassword } from "../../common/crypto/password.util.js";
import { generateTempPassword } from "../../common/crypto/temp-password.util.js";
import { EmployeeRepository } from "./employee.repository.js";
import { ExitService } from "./exit.service.js";

export type EmployeeUpdateInput = {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  personalEmail?: string | null;
  employeeCode?: string | null;
  title?: string | null;
  designationId?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  shiftId?: string | null;
  rotationId?: string | null;
  managerId?: string | null;
  status?: string;
  joinedAt?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  location?: string | null;
  employmentType?: string | null;
  workModel?: string | null;
  officeDays?: number[];
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
};

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeeRepository: EmployeeRepository,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly outbox: OutboxService,
    private readonly seatLimit: SeatLimitService,
    private readonly accessScope: AccessScopeService,
    private readonly exitService: ExitService,
  ) {}

  /**
   * ABAC gate for by-ID access. listEmployees filters at the query, but the
   * single-record paths look an employee up by id and would otherwise see any
   * employee in the org. A department/team-scoped manager may only touch people
   * inside their scope (their unit + their own record + direct reports); org-tier
   * callers pass through. Throws NotFound (not Forbidden) to avoid leaking that
   * an out-of-scope employee exists, matching the existing not-found contract.
   */
  private async assertEmployeeInScope(employeeId: string, permission: string): Promise<void> {
    const context = requireTenantContext();
    const scope = await this.accessScope.resolveScope(context.orgId, context.userId, permission);
    if (scope.tier === "org") return;
    const visible = await this.accessScope.visibleEmployeeIds(context.orgId, scope);
    if (visible !== null && !visible.includes(employeeId)) throw new NotFoundException("Employee not found.");
  }

  async listEmployees(query: { page: number; pageSize: number; q?: string; lifecycleStage?: string; departmentId?: string; teamId?: string; managerId?: string; designationId?: string; status?: string }) {
    const context = requireTenantContext();
    // ABAC: a department/team-scoped manager sees only their unit; org tier sees all.
    const scope = await this.accessScope.resolveScope(context.orgId, context.userId, permissions.employeeRead);
    return this.employeeRepository.list(context, query, this.accessScope.employeeWhere(scope));
  }

  /** Headcount per lifecycle stage (Onboarding / Probation / Confirmed / Exit), scope-aware. */
  async lifecycleSummary() {
    const context = requireTenantContext();
    const scope = await this.accessScope.resolveScope(context.orgId, context.userId, permissions.employeeRead);
    return this.employeeRepository.lifecycleCounts(context, this.accessScope.employeeWhere(scope));
  }

  async getEmployee(employeeId: string) {
    const context = requireTenantContext();
    await this.assertEmployeeInScope(employeeId, permissions.employeeRead);
    const employee = await this.employeeRepository.findById(context, employeeId);
    if (!employee) throw new NotFoundException("Employee not found.");

    const [manager, directReports, teamName] = await Promise.all([
      employee.managerId
        ? this.prisma.employee.findFirst({ where: { id: employee.managerId, orgId: context.orgId }, select: { id: true, firstName: true, lastName: true, title: true } })
        : Promise.resolve(null),
      this.prisma.employee.findMany({ where: { orgId: context.orgId, managerId: employeeId }, select: { id: true, firstName: true, lastName: true, title: true, status: true }, orderBy: { firstName: "asc" } }),
      employee.teamId ? this.prisma.team.findFirst({ where: { id: employee.teamId, orgId: context.orgId }, select: { name: true } }) : Promise.resolve(null),
    ]);

    return {
      ...employee,
      teamName: teamName?.name ?? null,
      manager: manager ? { id: manager.id, name: `${manager.firstName} ${manager.lastName}`.trim(), title: manager.title } : null,
      directReports: directReports.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}`.trim(), title: r.title, status: r.status })),
    };
  }

  /** Employment history timeline (newest first). */
  async history(employeeId: string) {
    const context = requireTenantContext();
    await this.assertEmployeeInScope(employeeId, permissions.employeeRead);
    const rows = await this.prisma.employmentEvent.findMany({
      where: { orgId: context.orgId, employeeId },
      orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    return rows.map((e) => ({ id: e.id, type: e.type, title: e.title, detail: e.detail, effectiveDate: e.effectiveDate.toISOString(), createdAt: e.createdAt.toISOString() }));
  }

  /** Add a manual note to an employee's history. */
  async addEvent(employeeId: string, input: { type?: string; title: string; detail?: string; effectiveDate?: string }) {
    const context = requireTenantContext();
    await this.assertEmployeeInScope(employeeId, permissions.employeeWrite);
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId: context.orgId }, select: { id: true } });
    if (!emp) throw new NotFoundException("Employee not found.");
    await this.prisma.employmentEvent.create({
      data: { orgId: context.orgId, employeeId, type: input.type ?? "NOTE", title: input.title, detail: input.detail ?? null, effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : new Date(), createdBy: context.userId },
    });
    return this.history(employeeId);
  }

  /** Reporting tree from managerId (roots = employees with no manager or an out-of-set manager). */
  async orgChart() {
    const context = requireTenantContext();
    const rows = await this.prisma.employee.findMany({
      where: { orgId: context.orgId, status: { not: "EXITED" } },
      select: { id: true, firstName: true, lastName: true, title: true, managerId: true, departmentRef: { select: { name: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, { id: r.id, name: `${r.firstName} ${r.lastName}`.trim(), title: r.title, department: r.departmentRef?.name ?? null, managerId: r.managerId, reports: [] as unknown[] }]));
    const roots: unknown[] = [];
    for (const node of byId.values()) {
      const parent = node.managerId ? byId.get(node.managerId) : undefined;
      if (parent && parent.id !== node.id) parent.reports.push(node);
      else roots.push(node);
    }
    return { roots, total: rows.length };
  }

  private recordEvent(client: Prisma.TransactionClient, orgId: string, employeeId: string, userId: string | undefined, type: string, title: string, detail?: string) {
    return client.employmentEvent.create({ data: { orgId, employeeId, type, title, detail: detail ?? null, effectiveDate: new Date(), createdBy: userId ?? null } });
  }

  /**
   * Append to the PLATFORM activity feed (what the super-admin watches) — distinct
   * from EmploymentEvent above, which is that one employee's HR timeline.
   * Best-effort: a feed write must never fail the action it describes.
   */
  private recordPlatformEvent(orgId: string, type: string, summary: string): void {
    void this.prisma.platformEvent.create({ data: { type, orgId, summary } }).catch(() => undefined);
  }

  /** Update an employee's job + personal profile; records history for job changes. */
  async updateEmployee(employeeId: string, input: EmployeeUpdateInput) {
    const context = requireTenantContext();
    await this.assertEmployeeInScope(employeeId, permissions.employeeWrite);
    const existing = await this.employeeRepository.findById(context, employeeId);
    if (!existing) throw new NotFoundException("Employee not found.");

    if (input.designationId) await this.assertOwned("designation", input.designationId, context.orgId);
    if (input.departmentId) await this.assertOwned("department", input.departmentId, context.orgId);
    if (input.teamId) await this.assertOwned("team", input.teamId, context.orgId);
    if (input.shiftId) await this.assertOwned("shift", input.shiftId, context.orgId);
    if (input.managerId) {
      if (input.managerId === employeeId) throw new ConflictException("An employee cannot be their own manager.");
      const m = await this.prisma.employee.findFirst({ where: { id: input.managerId, orgId: context.orgId }, select: { id: true } });
      if (!m) throw new NotFoundException("Manager not found.");
    }

    // The work email is the sign-in address (mirrored on the linked User), so it
    // is NOT a plain scalar edit — changing it re-issues login credentials. The
    // personal email is ordinary HR profile data. Everything else is a scalar.
    const scalarKeys = [
      "firstName", "lastName", "personalEmail", "employeeCode", "title", "designationId", "departmentId", "teamId", "shiftId", "rotationId", "managerId",
      "status", "phone", "gender", "location", "employmentType", "workModel", "address", "emergencyContactName", "emergencyContactPhone",
    ] as const;
    const data: Record<string, unknown> = {};
    for (const k of scalarKeys) if (input[k] !== undefined) data[k] = input[k];
    if (input.dateOfBirth !== undefined) data.dateOfBirth = input.dateOfBirth ? new Date(input.dateOfBirth) : null;
    if (input.joinedAt !== undefined) data.joinedAt = input.joinedAt ? new Date(input.joinedAt) : null;
    // officeDays only applies to HYBRID; clear it otherwise so stale days can't linger.
    if (input.officeDays !== undefined) data.officeDays = input.workModel === "HYBRID" ? [...new Set(input.officeDays)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b) : [];
    else if (input.workModel !== undefined && input.workModel !== "HYBRID") data.officeDays = [];

    // Work-email change: sync the login account and re-issue a temporary password
    // so the person signs in with the new address. Returns the temp password to
    // the caller (an admin with employee.write) to hand over — same shape as an
    // invite. Skipped when the email is unchanged.
    let issuedTempPassword: string | null = null;
    const nextWorkEmail = input.email !== undefined ? input.email?.toLowerCase().trim() || null : undefined;
    const workEmailChanged = nextWorkEmail !== undefined && nextWorkEmail !== (existing.email ?? null);
    if (workEmailChanged) {
      if (!nextWorkEmail) throw new BadRequestException("A work email is required to sign in — it can't be cleared.");
      // Persists Employee.email + the linked User.email together in one tx, so
      // the login and the profile can never drift apart again.
      issuedTempPassword = await this.changeWorkEmail(employeeId, context.orgId, nextWorkEmail);
    }

    const updated = await this.employeeRepository.update(context, employeeId, data);

    // Record job-change history (personal-field edits don't produce events).
    const events: { type: string; title: string }[] = [];
    if (input.designationId !== undefined && input.designationId !== existing.designationId) events.push({ type: "PROMOTION", title: `Designation changed to ${updated.designationRef?.title ?? "—"}` });
    if (input.title !== undefined && input.title !== existing.title) events.push({ type: "TITLE_CHANGE", title: `Title changed to ${updated.title ?? "—"}` });
    if (input.departmentId !== undefined && input.departmentId !== existing.departmentId) events.push({ type: "TRANSFER", title: `Moved to ${updated.departmentRef?.name ?? "no department"}` });
    if (input.status !== undefined && input.status !== existing.status) events.push({ type: "STATUS_CHANGE", title: `Status changed to ${(updated.status ?? "").toLowerCase().replace("_", " ")}` });
    for (const e of events) await this.recordEvent(this.prisma, context.orgId, employeeId, context.userId, e.type, e.title);

    await this.audit.record({ orgId: context.orgId, action: "employee.updated", resourceType: "employee", resourceId: employeeId, before: existing, after: updated });
    // Surface the temp password only on a work-email change, so the admin can
    // pass the new sign-in credentials along. null on every other update.
    return issuedTempPassword ? { ...updated, issuedTempPassword } : updated;
  }

  /**
   * Point the employee's login (their linked User) at a new work email and force
   * a fresh temporary password. Returns that password for hand-off. Fails if the
   * employee has no login account, or the address already belongs to someone.
   */
  private async changeWorkEmail(employeeId: string, orgId: string, newEmail: string): Promise<string> {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { employeeId, orgId },
      select: { userId: true },
    });
    if (!membership?.userId) {
      throw new BadRequestException("This employee has no sign-in account, so there's no work email to change.");
    }

    const clash = await this.prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } });
    if (clash && clash.id !== membership.userId) {
      throw new ConflictException("Another account already uses this email.");
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: membership.userId },
        data: {
          email: newEmail,
          passwordHash,
          mustChangePassword: true, // force a reset on next sign-in with the new address
          // Any pending reset for the old address is void now.
          passwordResetTokenHash: null,
          passwordResetTokenExpiresAt: null,
        },
      }),
      this.prisma.employee.update({ where: { id: employeeId }, data: { email: newEmail } }),
    ]);
    return tempPassword;
  }

  /**
   * Move an employee along the lifecycle: start_probation → confirm → exit.
   * ONBOARDING → PROBATION → CONFIRMED; exit is terminal (also sets status EXITED).
   */
  async transition(employeeId: string, input: { action: "start_probation" | "confirm" | "exit"; probationEndsAt?: string; exitedAt?: string }) {
    const context = requireTenantContext();
    await this.assertEmployeeInScope(employeeId, permissions.employeeWrite);
    const existing = await this.employeeRepository.findById(context, employeeId);
    if (!existing) throw new NotFoundException("Employee not found.");
    if (existing.lifecycleStage === "EXITED") throw new ConflictException("This employee has already exited.");

    let data: Record<string, unknown>;
    switch (input.action) {
      case "start_probation":
        if (existing.lifecycleStage !== "ONBOARDING") throw new ConflictException("Only onboarding employees can be moved to probation.");
        data = { lifecycleStage: "PROBATION", probationEndsAt: input.probationEndsAt ? new Date(input.probationEndsAt) : null };
        break;
      case "confirm":
        if (existing.lifecycleStage === "CONFIRMED") throw new ConflictException("This employee is already confirmed.");
        data = { lifecycleStage: "CONFIRMED", confirmedAt: new Date(), status: existing.status === "SUSPENDED" ? existing.status : "ACTIVE" };
        break;
      case "exit":
        data = { lifecycleStage: "EXITED", status: "EXITED", exitedAt: input.exitedAt ? new Date(input.exitedAt) : new Date() };
        break;
    }

    const updated = await this.employeeRepository.update(context, employeeId, data);
    const label = input.action === "start_probation" ? "Moved to probation" : input.action === "confirm" ? "Confirmed as permanent" : "Exited the organization";
    await this.recordEvent(this.prisma, context.orgId, employeeId, context.userId, input.action === "exit" ? "EXIT" : "LIFECYCLE", label);
    await this.audit.record({ orgId: context.orgId, action: `employee.${input.action}`, resourceType: "employee", resourceId: employeeId, before: existing, after: updated });
    // Only exits reach the platform feed — probation/confirmation are the org's
    // internal HR business, not something a super-admin needs to watch.
    if (input.action === "exit") {
      // A quick exit still leaves a searchable alumni record (rehire-eligible by
      // default), so it stays consistent with the structured exit process.
      await this.prisma.$transaction((tx) =>
        this.exitService.upsertAlumni(tx, context.orgId, employeeId, "OTHER", true, null, data.exitedAt instanceof Date ? data.exitedAt : new Date()),
      );
      this.recordPlatformEvent(context.orgId, "user.removed", `${updated.firstName} ${updated.lastName} left the organization`);
    }
    return updated;
  }

  private async assertOwned(kind: "designation" | "department" | "team" | "shift", id: string, orgId: string) {
    const found =
      kind === "designation"
        ? await this.prisma.designation.findFirst({ where: { id, orgId }, select: { id: true } })
        : kind === "department"
          ? await this.prisma.department.findFirst({ where: { id, orgId }, select: { id: true } })
          : kind === "team"
            ? await this.prisma.team.findFirst({ where: { id, orgId }, select: { id: true } })
            : await this.prisma.shift.findFirst({ where: { id, orgId }, select: { id: true } });
    if (!found) throw new NotFoundException(`${kind.charAt(0).toUpperCase() + kind.slice(1)} not found.`);
  }

  async createEmployee(input: CreateEmployeeInput, idempotencyKey?: string) {
    const context = requireTenantContext();

    const run = async () => {
      try {
        // Persist the employee and its domain event atomically (transactional outbox).
        const employee = await this.prisma.$transaction(async (tx) => {
          // Seat check inside the tx (advisory-locked) so concurrent creates can't
          // both pass and overshoot the cap. 409 if at the licensed seat count.
          await this.seatLimit.assertCanAddEmployeeTx(tx, context.orgId);
          const created = await this.employeeRepository.create(tx, context, input);
          await this.recordEvent(tx, context.orgId, created.id, context.userId, "JOINED", "Joined the organization", created.title ?? undefined);
          await this.outbox.enqueue(tx, {
            eventType: "employee.created",
            aggregateType: "employee",
            aggregateId: created.id,
            orgId: context.orgId,
            payload: {
              employeeId: created.id,
              employeeCode: created.employeeCode,
              firstName: created.firstName,
              lastName: created.lastName,
            },
          });
          return created;
        });

        await this.audit.record({
          orgId: context.orgId,
          action: "employee.created",
          resourceType: "employee",
          resourceId: employee.id,
          after: employee,
        });
        this.recordPlatformEvent(
          context.orgId,
          "user.invited",
          `${employee.firstName} ${employee.lastName} was added${employee.title ? ` as ${employee.title}` : ""}`,
        );
        return employee;
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new ConflictException("An employee with this code already exists.");
        }
        throw error;
      }
    };

    if (!idempotencyKey) {
      return run();
    }

    return this.idempotency.execute({
      orgId: context.orgId,
      key: idempotencyKey,
      requestHash: IdempotencyService.hashRequest(input),
      run,
    });
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
