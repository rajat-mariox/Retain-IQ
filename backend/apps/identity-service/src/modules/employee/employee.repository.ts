import { Injectable } from "@nestjs/common";
import type { Prisma } from "@retainiq/database/identity";
import type { CreateEmployeeInput, RequestContext } from "@retainiq/contracts";
import { PrismaService } from "../../common/database/prisma.service.js";

const LIST_SELECT = {
  id: true,
  employeeCode: true,
  email: true,
  firstName: true,
  lastName: true,
  status: true,
  createdAt: true,
} as const;

@Injectable()
export class EmployeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Offset-paginated list scoped to the tenant, with a total for page-number UIs. */
  async list(context: RequestContext, options: { page: number; pageSize: number }) {
    const where = { orgId: context.orgId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
        select: LIST_SELECT,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { items, total, page: options.page, pageSize: options.pageSize };
  }

  findById(context: RequestContext, employeeId: string) {
    return this.prisma.employee.findFirst({
      where: { id: employeeId, orgId: context.orgId },
      select: { ...LIST_SELECT, updatedAt: true },
    });
  }

  create(tx: Prisma.TransactionClient, context: RequestContext, input: CreateEmployeeInput) {
    return tx.employee.create({
      data: {
        orgId: context.orgId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        employeeCode: input.employeeCode,
        createdBy: context.userId,
        updatedBy: context.userId,
      },
      select: { ...LIST_SELECT, updatedAt: true },
    });
  }
}
