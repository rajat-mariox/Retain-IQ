import { Injectable, NotFoundException } from "@nestjs/common";
import type { RequestContext } from "@retainiq/contracts";
import { PrismaService } from "../../common/database/prisma.service.js";

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the profile of the caller's current organization. */
  async getCurrentOrg(context: RequestContext) {
    const org = await this.prisma.organization.findFirst({
      where: { id: context.orgId, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        region: true,
        timezone: true,
        createdAt: true,
      },
    });

    if (!org) {
      throw new NotFoundException("Organization not found.");
    }

    return org;
  }

  /** Members of the caller's org (user + role + employee), for the Settings screen. */
  async listMembers(context: RequestContext, query: { page: number; pageSize: number }) {
    const where = { orgId: context.orgId };
    const [members, total] = await this.prisma.$transaction([
      this.prisma.organizationMembership.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          status: true,
          createdAt: true,
          role: { select: { name: true } },
          user: { select: { email: true } },
          employee: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.organizationMembership.count({ where }),
    ]);

    return {
      items: members.map((m) => ({
        id: m.id,
        email: m.user.email,
        role: m.role.name,
        status: m.status,
        name: m.employee ? `${m.employee.firstName} ${m.employee.lastName}`.trim() : null,
        joinedAt: m.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
