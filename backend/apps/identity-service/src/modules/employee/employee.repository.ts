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

  /** Keyset-paginated list scoped to the tenant. Fetches one extra row to detect more pages. */
  async list(context: RequestContext, options: { limit: number; cursor?: string }) {
    const rows = await this.prisma.employee.findMany({
      where: { orgId: context.orgId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      select: LIST_SELECT,
    });

    const items = rows.slice(0, options.limit);
    const nextCursor = rows.length > options.limit ? (items.at(-1)?.id ?? null) : null;
    return { items, nextCursor };
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
