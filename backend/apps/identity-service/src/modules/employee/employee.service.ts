import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateEmployeeInput } from "@retainiq/contracts";
import { AuditService } from "../../common/audit/audit.service.js";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { SeatLimitService } from "../../common/seat-limit/seat-limit.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { permissions } from "@retainiq/authz";
import { EmployeeRepository } from "./employee.repository.js";

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
  ) {}

  async listEmployees(query: { page: number; pageSize: number; q?: string; lifecycleStage?: string; departmentId?: string; status?: string }) {
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
    const employee = await this.employeeRepository.findById(context, employeeId);

    if (!employee) {
      throw new NotFoundException("Employee not found.");
    }

    return employee;
  }

  /** Assign structure to an employee: designation, department, team, manager, title, status. */
  async updateEmployee(
    employeeId: string,
    input: { designationId?: string | null; departmentId?: string | null; teamId?: string | null; shiftId?: string | null; managerId?: string | null; title?: string | null; status?: string },
  ) {
    const context = requireTenantContext();
    const existing = await this.employeeRepository.findById(context, employeeId);
    if (!existing) throw new NotFoundException("Employee not found.");

    if (input.designationId) await this.assertOwned("designation", input.designationId, context.orgId);
    if (input.departmentId) await this.assertOwned("department", input.departmentId, context.orgId);
    if (input.teamId) await this.assertOwned("team", input.teamId, context.orgId);
    if (input.shiftId) await this.assertOwned("shift", input.shiftId, context.orgId);

    const data: Record<string, unknown> = {};
    if (input.designationId !== undefined) data.designationId = input.designationId;
    if (input.departmentId !== undefined) data.departmentId = input.departmentId;
    if (input.teamId !== undefined) data.teamId = input.teamId;
    if (input.shiftId !== undefined) data.shiftId = input.shiftId;
    if (input.managerId !== undefined) data.managerId = input.managerId;
    if (input.title !== undefined) data.title = input.title;
    if (input.status !== undefined) data.status = input.status;

    const updated = await this.employeeRepository.update(context, employeeId, data);
    await this.audit.record({ orgId: context.orgId, action: "employee.updated", resourceType: "employee", resourceId: employeeId, before: existing, after: updated });
    return updated;
  }

  /**
   * Move an employee along the lifecycle: start_probation → confirm → exit.
   * ONBOARDING → PROBATION → CONFIRMED; exit is terminal (also sets status EXITED).
   */
  async transition(employeeId: string, input: { action: "start_probation" | "confirm" | "exit"; probationEndsAt?: string; exitedAt?: string }) {
    const context = requireTenantContext();
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
    await this.audit.record({ orgId: context.orgId, action: `employee.${input.action}`, resourceType: "employee", resourceId: employeeId, before: existing, after: updated });
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
    await this.seatLimit.assertCanAddEmployee(context.orgId); // 409 if at the licensed seat count

    const run = async () => {
      try {
        // Persist the employee and its domain event atomically (transactional outbox).
        const employee = await this.prisma.$transaction(async (tx) => {
          const created = await this.employeeRepository.create(tx, context, input);
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
