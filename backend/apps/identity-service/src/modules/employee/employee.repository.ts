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
  title: true,
  status: true,
  lifecycleStage: true,
  departmentId: true,
  teamId: true,
  designationId: true,
  shiftId: true,
  managerId: true,
  joinedAt: true,
  probationEndsAt: true,
  confirmedAt: true,
  exitedAt: true,
  createdAt: true,
  departmentRef: { select: { id: true, name: true } },
  designationRef: { select: { id: true, title: true, level: true } },
  shiftRef: { select: { id: true, name: true } },
} as const;

// Full profile fields (single-employee view).
const PROFILE_SELECT = {
  ...LIST_SELECT,
  updatedAt: true,
  rotationId: true,
  personalEmail: true,
  phone: true,
  dateOfBirth: true,
  gender: true,
  location: true,
  employmentType: true,
  workModel: true,
  officeDays: true,
  address: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
} as const;

export interface EmployeeListFilters {
  page: number;
  pageSize: number;
  q?: string;
  lifecycleStage?: string;
  departmentId?: string;
  teamId?: string;
  managerId?: string;
  designationId?: string;
  status?: string;
}

@Injectable()
export class EmployeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(context: RequestContext, filters: Partial<EmployeeListFilters>, scopeWhere: Prisma.EmployeeWhereInput): Prisma.EmployeeWhereInput {
    const q = filters.q?.trim();
    return {
      orgId: context.orgId,
      ...scopeWhere,
      ...(filters.lifecycleStage ? { lifecycleStage: filters.lifecycleStage as Prisma.EmployeeWhereInput["lifecycleStage"] } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.teamId ? { teamId: filters.teamId } : {}),
      ...(filters.managerId ? { managerId: filters.managerId } : {}),
      ...(filters.designationId ? { designationId: filters.designationId } : {}),
      ...(filters.status ? { status: filters.status as Prisma.EmployeeWhereInput["status"] } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { employeeCode: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
  }

  /** Offset-paginated list scoped to the tenant + the caller's ABAC scope + filters. */
  async list(context: RequestContext, options: EmployeeListFilters, scopeWhere: Prisma.EmployeeWhereInput = {}) {
    const where = this.buildWhere(context, options, scopeWhere);
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

  /** Headcount per lifecycle stage, within the caller's scope. */
  async lifecycleCounts(context: RequestContext, scopeWhere: Prisma.EmployeeWhereInput = {}) {
    const groups = await this.prisma.employee.groupBy({
      by: ["lifecycleStage"],
      where: { orgId: context.orgId, ...scopeWhere },
      _count: { _all: true },
    });
    const get = (stage: string) => groups.find((g) => g.lifecycleStage === stage)?._count._all ?? 0;
    return {
      onboarding: get("ONBOARDING"),
      probation: get("PROBATION"),
      confirmed: get("CONFIRMED"),
      exited: get("EXITED"),
    };
  }

  findById(context: RequestContext, employeeId: string) {
    return this.prisma.employee.findFirst({
      where: { id: employeeId, orgId: context.orgId },
      select: PROFILE_SELECT,
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
        title: input.title ?? null,
        departmentId: input.departmentId ?? null,
        teamId: input.teamId ?? null,
        designationId: input.designationId ?? null,
        managerId: input.managerId ?? null,
        joinedAt: input.joinedAt ? new Date(input.joinedAt) : null,
        phone: input.phone ?? null,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
        gender: input.gender ?? null,
        location: input.location ?? null,
        employmentType: input.employmentType ?? null,
        address: input.address ?? null,
        emergencyContactName: input.emergencyContactName ?? null,
        emergencyContactPhone: input.emergencyContactPhone ?? null,
        createdBy: context.userId,
        updatedBy: context.userId,
      },
      select: PROFILE_SELECT,
    });
  }

  update(context: RequestContext, employeeId: string, data: Prisma.EmployeeUpdateInput) {
    return this.prisma.employee.update({
      where: { id: employeeId },
      data: { ...data, updatedBy: context.userId },
      select: PROFILE_SELECT,
    });
  }
}
