import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateEmployeeInput } from "@retainiq/contracts";
import { AuditService } from "../../common/audit/audit.service.js";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { IdempotencyService } from "../../common/idempotency/idempotency.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { EmployeeRepository } from "./employee.repository.js";

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeeRepository: EmployeeRepository,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly outbox: OutboxService,
  ) {}

  listEmployees(query: { limit: number; cursor?: string }) {
    const context = requireTenantContext();
    return this.employeeRepository.list(context, query);
  }

  async getEmployee(employeeId: string) {
    const context = requireTenantContext();
    const employee = await this.employeeRepository.findById(context, employeeId);

    if (!employee) {
      throw new NotFoundException("Employee not found.");
    }

    return employee;
  }

  async createEmployee(input: CreateEmployeeInput, idempotencyKey?: string) {
    const context = requireTenantContext();

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
